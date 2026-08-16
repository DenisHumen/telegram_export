"""End-to-end smoke test of the export pipeline against a fake Telegram client.

Runs against a throwaway database (``tgvault_test``) on the same MySQL server,
so it never touches the user's archive.

    cd backend
    .venv/Scripts/python -m tests.smoke        # Windows / Git Bash
    .venv/bin/python -m tests.smoke            # Linux / macOS

Exits non-zero on the first failed assertion.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

# Point at a scratch database and data directory BEFORE app.config is imported,
# because Settings is instantiated (and cached) at import time.
os.environ["TGV_MYSQL_DB"] = "tgvault_test"
os.environ["TGV_REDIS_ENABLED"] = "false"
_TMP_DATA = Path(tempfile.mkdtemp(prefix="tgvault_test_"))
os.environ["TGV_DATA_DIR"] = str(_TMP_DATA)
os.environ["TGV_LOG_LEVEL"] = "WARNING"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.bootstrap import init_db, reset_db  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.db.models import (  # noqa: E402
    Account,
    Chat,
    ExportJob,
    JobEvent,
    MediaFile,
    Message,
)
from app.db.session import dispose_engine, session_scope  # noqa: E402
from app.services.jobs import create_job  # noqa: E402
from app.services.layout import directory_for, render_filename  # noqa: E402
from app.services.options import ExportOptions  # noqa: E402
from app.tg.exporter import ExportEngine, JobControl  # noqa: E402
from app.tg.extract import detect_media_type, extract_file_info  # noqa: E402
from app.tg.manager import AuthState, ClientHandle, manager  # noqa: E402
from tests.fakes import FakeClient, FakeMessage, build_messages  # noqa: E402

PASSED = 0
FAILED: list[str] = []


def check(condition: bool, label: str) -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ✓ {label}")
    else:
        FAILED.append(label)
        print(f"  ✗ {label}")


# --------------------------------------------------------------------------
# unit-level checks (no database)
# --------------------------------------------------------------------------


def test_media_detection() -> None:
    print("\n[1] Определение типа медиа")
    from datetime import datetime, timezone

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    cases = {
        "none": "none",
        "photo": "photo",
        "video_note": "video_note",
        "video": "video",
        "voice": "voice",
        "document": "document",
        "sticker": "sticker",
        "animation": "animation",
    }
    for kind, expected in cases.items():
        message = FakeMessage(1, now, kind=kind)
        actual = detect_media_type(message)
        check(actual == expected, f"{kind or 'text'} -> {actual} (ожидалось {expected})")

    # The ordering traps: a round note and a video sticker both answer .video.
    note = FakeMessage(2, now, kind="video_note")
    check(note.video is not None, "кружочек действительно отвечает .video (ловушка порядка)")
    check(detect_media_type(note) == "video_note", "но определяется как video_note")

    info = extract_file_info(FakeMessage(3, now, kind="video_note", size=4096), "video_note")
    check(info is not None and info["ext"] == ".mp4", "расширение кружочка .mp4")
    check(info is not None and info["size"] == 4096, "размер кружочка прочитан")
    check(
        info is not None and info["file_unique"] == f"video_note:{2000 + 3}",
        "ключ дедупликации построен из id документа",
    )


def test_layout() -> None:
    print("\n[2] Стратегии раскладки файлов")
    from datetime import datetime

    date = datetime(2026, 3, 7, 14, 30, 5)
    expected = {
        "flat": "media",
        "by_type": "media/video_notes",
        "by_date": "media/2026/2026-03",
        "by_date_type": "media/2026/2026-03/video_notes",
        "by_type_date": "media/video_notes/2026-03",
        "by_sender": "media/Ivan",
        "by_album": "media/albums/77",
        "by_size": "media/small_lt10mb/video_notes",
    }
    for layout, want in expected.items():
        got = directory_for(
            layout, kind="video_note", date=date, sender="Ivan", grouped_id=77, size=1024
        )
        check(got == want, f"{layout}: {got}")

    name = render_filename(
        "{date}_{id}_{name}",
        message_id=42,
        date=date,
        original_name="Отчёт квартал.pdf",
        ext=".pdf",
        kind="document",
        sender="Ivan",
        chat_title="Канал",
        grouped_id=None,
    )
    check(name.startswith("2026-03-07_42_") and name.endswith(".pdf"), f"шаблон имени: {name}")

    broken = render_filename(
        "{nope}_{id}",
        message_id=7,
        date=date,
        original_name=None,
        ext=".jpg",
        kind="photo",
        sender=None,
        chat_title=None,
        grouped_id=None,
    )
    check(broken.endswith(".jpg"), f"битый шаблон не ломает экспорт: {broken}")

    unsafe = render_filename(
        "{name}",
        message_id=8,
        date=date,
        original_name='a/b\\c:d*e?"f<g>h|i.txt',
        ext=".txt",
        kind="document",
        sender=None,
        chat_title=None,
        grouped_id=None,
    )
    check(
        not any(ch in unsafe for ch in '/\\:*?"<>|'),
        f"опасные символы вычищены: {unsafe}",
    )


# --------------------------------------------------------------------------
# integration: a full export run
# --------------------------------------------------------------------------


async def _seed() -> tuple[int, int]:
    async with session_scope() as session:
        account = Account(
            label="Test account",
            api_id=12345,
            api_hash="0" * 32,
            status="authorized",
            tg_user_id=555,
        )
        session.add(account)
        await session.flush()
        chat = Chat(
            account_id=account.id,
            tg_chat_id=-1001234567890,
            kind="channel",
            title="Тестовый канал",
            username="test_channel",
        )
        session.add(chat)
        await session.flush()
        return account.id, chat.id


def _install_fake_client(account_id: int, client: FakeClient) -> None:
    """Inject the fake into the manager so the engine picks it up."""
    handle = ClientHandle(
        account_id=account_id, client=client, auth=AuthState(account_id=account_id)
    )
    manager._handles[account_id] = handle  # noqa: SLF001 - test seam

    async def _get_or_create(account):
        return manager._handles[account.id]  # noqa: SLF001

    manager.get_or_create = _get_or_create  # type: ignore[method-assign]


async def test_export() -> None:
    print("\n[3] Полный прогон экспорта (фейковый Telegram-клиент)")
    await init_db()
    await reset_db()

    account_id, chat_id = await _seed()
    messages = build_messages(12)
    client = FakeClient(messages, fail_first_download=True)
    _install_fake_client(account_id, client)

    output_dir = _TMP_DATA / "exports" / "run1"
    options = ExportOptions(
        layout="by_type_date",
        formats=["json", "jsonl", "csv", "txt", "html"],
        concurrency=3,
        output_dir=str(output_dir),
        incremental=False,
    )

    async with session_scope() as session:
        job = await create_job(
            session, account_id=account_id, chat_id=chat_id, options=options
        )
        job_id = job.id

    engine = ExportEngine(job_id, JobControl())
    await engine.run()

    async with session_scope() as session:
        job = await session.get(ExportJob, job_id)
        check(job.status == "completed", f"статус задачи: {job.status} ({job.error or 'без ошибок'})")
        check(job.processed_messages == 12, f"обработано сообщений: {job.processed_messages}")

        from sqlalchemy import func, select

        msg_count = await session.scalar(
            select(func.count(Message.id)).where(Message.chat_id == chat_id)
        )
        check(msg_count == 12, f"сообщений в БД: {msg_count}")

        note_count = await session.scalar(
            select(func.count(Message.id)).where(
                Message.chat_id == chat_id, Message.media_type == "video_note"
            )
        )
        check(note_count > 0, f"кружочков распознано: {note_count}")

        done_files = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id, MediaFile.status == "done"
            )
        )
        check(done_files == 10, f"скачано файлов: {done_files} из 10 медийных")
        check(
            job.downloaded_files == done_files,
            f"счётчик задачи совпадает с БД: {job.downloaded_files}",
        )

    check(
        client._failed_once,  # noqa: SLF001
        "сымитированный сбой сети произошёл и был пережит повтором",
    )

    print("\n[4] Выходные файлы")
    for name in ("manifest.json", "messages.json", "messages.jsonl", "messages.csv",
                 "messages.txt", "index.html"):
        check((output_dir / name).exists(), f"создан {name}")
    check((output_dir / "assets" / "data.js").exists(), "создан assets/data.js")
    check((output_dir / "assets" / "style.css").exists(), "создан assets/style.css")

    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    check(manifest["stats"]["messages"] == 12, "манифест: 12 сообщений")
    check(
        manifest["chat"]["title"] == "Тестовый канал", "манифест: заголовок чата в UTF-8 корректен"
    )

    data_js = (output_dir / "assets" / "data.js").read_text(encoding="utf-8")
    check(data_js.startswith("window.TGVAULT_DATA = "), "data.js — присваивание, а не JSON (file://)")

    print("\n[5] Раскладка медиа на диске")
    note_dir = output_dir / "media" / "video_notes"
    check(note_dir.is_dir(), "каталог media/video_notes создан")
    laid_out = list((output_dir / "media").rglob("*.*"))
    check(len(laid_out) == 10, f"файлов разложено: {len(laid_out)}")
    check(
        any(p.parent.name.startswith("2026-") for p in laid_out),
        "внутри типа файлы сгруппированы по месяцу (by_type_date)",
    )

    print("\n[6] Повторный запуск: инкрементальность и дедупликация")
    async with session_scope() as session:
        job2 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                layout="by_type_date",
                formats=["json"],
                output_dir=str(output_dir),
                incremental=True,
            ),
        )
        job2_id = job2.id

    engine2 = ExportEngine(job2_id, JobControl())
    await engine2.run()

    async with session_scope() as session:
        from sqlalchemy import func, select

        job2 = await session.get(ExportJob, job2_id)
        check(job2.status == "completed", f"вторая задача завершена: {job2.status}")
        check(
            job2.processed_messages == 0,
            f"инкрементальный прогон не тянул старое заново: {job2.processed_messages}",
        )
        total_msgs = await session.scalar(
            select(func.count(Message.id)).where(Message.chat_id == chat_id)
        )
        check(total_msgs == 12, f"дублей в БД не появилось: {total_msgs}")

    print("\n[7] Синхронизация списка чатов")
    from app.tg.dialogs import sync_dialogs

    async with session_scope() as session:
        account = await session.get(Account, account_id)
        result = await sync_dialogs(session, account, with_avatars=False)
    check(result["synced"] == 5, f"диалогов синхронизировано: {result['synced']}")
    check(result["created"] == 5, f"новых записей: {result['created']}")

    async with session_scope() as session:
        from sqlalchemy import select

        rows = (
            await session.execute(select(Chat).where(Chat.account_id == account_id))
        ).scalars().all()
        kinds = {row.title: row.kind for row in rows}
    check(kinds.get("Новостной канал") == "channel", f"broadcast -> channel ({kinds.get('Новостной канал')})")
    check(kinds.get("Чат сообщества") == "supergroup", f"megagroup -> supergroup ({kinds.get('Чат сообщества')})")
    check(kinds.get("Семейный чат") == "group", f"basic chat -> group ({kinds.get('Семейный чат')})")
    check(kinds.get("Пётр Иванов") == "user", f"user -> user ({kinds.get('Пётр Иванов')})")
    check(kinds.get("HelperBot") == "bot", f"bot -> bot ({kinds.get('HelperBot')})")

    async with session_scope() as session:
        account = await session.get(Account, account_id)
        again = await sync_dialogs(session, account, with_avatars=False)
    check(again["created"] == 0 and again["updated"] == 5, "повторный синк обновляет, а не дублирует")

    print("\n[8] Пересборка вывода из базы (без Telegram)")
    from app.services.jobs import rebuild_outputs

    async with session_scope() as session:
        job = await session.get(ExportJob, job_id)
        written = await rebuild_outputs(
            session, job, overrides={"formats": ["json", "csv"], "sort_field": "size",
                                     "sort_order": "desc"}
        )
    check("messages.csv" in written, f"пересобрано: {', '.join(written)}")
    rebuilt = json.loads((output_dir / "messages.json").read_text(encoding="utf-8"))
    check(len(rebuilt["messages"]) == 12, f"в пересобранном JSON {len(rebuilt['messages'])} сообщений")

    print("\n[9] Превью и аватары отправителей")
    thumbs_dir = _TMP_DATA / "exports" / "run_thumbs"
    async with session_scope() as session:
        job4 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                layout="by_type",
                formats=["json"],
                output_dir=str(thumbs_dir),
                incremental=False,
                skip_existing=False,
                download_thumbs=True,
                download_avatars=True,
            ),
        )
        job4_id = job4.id

    await ExportEngine(job4_id, JobControl()).run()

    async with session_scope() as session:
        from sqlalchemy import func, select

        job4 = await session.get(ExportJob, job4_id)
        check(job4.status == "completed", f"задача с превью завершена: {job4.status}")
        thumbs = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id, MediaFile.kind == "thumb",
                MediaFile.status == "done",
            )
        )
        avatars_done = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id, MediaFile.kind == "avatar",
                MediaFile.status == "done",
            )
        )
        avatars_skipped = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id, MediaFile.kind == "avatar",
                MediaFile.status == "skipped",
            )
        )
    check(thumbs > 0, f"скачано превью: {thumbs}")
    check(avatars_done > 0, f"скачано аватаров: {avatars_done}")
    check(
        avatars_skipped > 0,
        f"отправитель без аватара помечен skipped, а не failed: {avatars_skipped}",
    )
    check((thumbs_dir / "media" / "thumbnails").is_dir(), "каталог media/thumbnails создан")
    check((thumbs_dir / "media" / "avatars").is_dir(), "каталог media/avatars создан")

    print("\n[10] Telegram перестал отвечать на запрос истории")
    # Регрессия: раньше задача висела вечно со статусом «Выполняется»,
    # без ошибки в журнале и без возможности её снять.
    import app.tg.exporter as exporter_module

    original_fetch_timeout = exporter_module._FETCH_TIMEOUT
    exporter_module._FETCH_TIMEOUT = 2.0
    try:
        hang_client = FakeClient(build_messages(12), hang_iter_after=4)
        _install_fake_client(account_id, hang_client)
        async with session_scope() as session:
            job5 = await create_job(
                session,
                account_id=account_id,
                chat_id=chat_id,
                options=ExportOptions(
                    formats=["json"],
                    output_dir=str(_TMP_DATA / "exports" / "run_hang"),
                    incremental=False,
                    skip_existing=False,
                ),
            )
            job5_id = job5.id

        started = asyncio.get_event_loop().time()
        await asyncio.wait_for(ExportEngine(job5_id, JobControl()).run(), timeout=60)
        elapsed = asyncio.get_event_loop().time() - started
    finally:
        exporter_module._FETCH_TIMEOUT = original_fetch_timeout

    check(elapsed < 30, f"задача не зависла, завершилась за {elapsed:.1f} с")
    async with session_scope() as session:
        job5 = await session.get(ExportJob, job5_id)
        check(job5.status == "failed", f"статус: {job5.status} (ожидался failed)")
        check(
            bool(job5.error) and "не ответил" in (job5.error or ""),
            f"причина понятна пользователю: {job5.error}",
        )
        events = (
            await session.execute(
                select(JobEvent).where(JobEvent.job_id == job5_id, JobEvent.level == "error")
            )
        ).scalars().all()
        check(len(events) > 0, f"в журнале задачи есть запись об ошибке ({len(events)})")

    print("\n[11] Отмена задачи, зависшей на скачивании")
    # Регрессия: задача не реагировала на отмену, оставалась в реестре
    # выполняющихся и её нельзя было удалить («Сначала остановите задачу»).
    import app.services.jobs as jobs_module

    original_grace = jobs_module.CANCEL_GRACE_SECONDS
    jobs_module.CANCEL_GRACE_SECONDS = 1.0
    try:
        stuck_client = FakeClient(build_messages(12), hang_download=True)
        _install_fake_client(account_id, stuck_client)
        async with session_scope() as session:
            job6 = await create_job(
                session,
                account_id=account_id,
                chat_id=chat_id,
                options=ExportOptions(
                    formats=["json"],
                    output_dir=str(_TMP_DATA / "exports" / "run_stuck"),
                    incremental=False,
                    skip_existing=False,
                    concurrency=2,
                ),
            )
            job6_id = job6.id

        await jobs_module.launch(job6_id)
        for _ in range(40):
            await asyncio.sleep(0.25)
            if jobs_module.active_downloads.get(job6_id):
                break
        check(
            bool(jobs_module.active_downloads.get(job6_id)),
            "задача действительно начала качать (и зависла)",
        )

        async with session_scope() as session:
            job6 = await session.get(ExportJob, job6_id)
            await jobs_module.cancel_job(session, job6)

        for _ in range(60):
            await asyncio.sleep(0.25)
            if not jobs_module.is_running(job6_id):
                break
        check(
            not jobs_module.is_running(job6_id),
            "зависшая задача снята принудительно, реестр очищен",
        )
    finally:
        jobs_module.CANCEL_GRACE_SECONDS = original_grace

    async with session_scope() as session:
        job6 = await session.get(ExportJob, job6_id)
        check(job6.status == "cancelled", f"статус после отмены: {job6.status}")
        # Именно эта проверка стоит в DELETE /api/export/jobs/{id}
        blocked = job6.status in {"queued", "running", "paused"} and jobs_module.is_running(
            job6_id
        )
        check(not blocked, "удаление больше не блокируется")
        await jobs_module.force_stop(job6_id)
        await session.delete(job6)
    check(True, "задача удалена без ошибки")

    print("\n[12] Неограниченные повторы: ни один файл не теряется")
    flaky = FakeClient(build_messages(12))
    flaky.flaky_attempts = 3  # каждая загрузка падает трижды подряд
    _install_fake_client(account_id, flaky)
    async with session_scope() as session:
        job7 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                formats=["json"],
                output_dir=str(_TMP_DATA / "exports" / "run_flaky"),
                incremental=False,
                skip_existing=False,
                retry_forever=True,
            ),
        )
        job7_id = job7.id
    await ExportEngine(job7_id, JobControl()).run()

    async with session_scope() as session:
        job7 = await session.get(ExportJob, job7_id)
        outstanding = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id,
                MediaFile.status.in_(("failed", "pending", "downloading")),
            )
        )
    check(job7.status == "completed", f"задача завершена: {job7.status}")
    check(outstanding == 0, f"недокачанных файлов не осталось: {outstanding}")
    check(job7.downloaded_files == 10, f"скачано всё: {job7.downloaded_files}/10")

    print("\n[13] Докачка файла с места обрыва")
    # Файлы должны быть крупнее чанка (512 КБ), иначе докачивать нечего
    # и движок штатно качает заново — на мелочи это дешевле.
    from datetime import datetime as _dt
    from datetime import timedelta as _td
    from datetime import timezone as _tz

    big_messages = [
        FakeMessage(
            index + 1,
            _dt(2026, 2, 1, tzinfo=_tz.utc) + _td(hours=index),
            kind="video",
            text=None,
            size=4_000_000,
        )
        for index in range(3)
    ]
    resuming = FakeClient(big_messages)
    resuming.partial_fail_once = True  # обрыв на середине каждого файла
    _install_fake_client(account_id, resuming)
    resume_dir = _TMP_DATA / "exports" / "run_resume"
    async with session_scope() as session:
        job8 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                formats=["json"],
                output_dir=str(resume_dir),
                incremental=False,
                skip_existing=False,
                retry_forever=True,
                resume_partial=True,
                concurrency=1,
            ),
        )
        job8_id = job8.id
    await ExportEngine(job8_id, JobControl()).run()

    offsets = [int(entry.split("@")[1]) for entry in resuming.resumed]
    check(len(offsets) > 0, f"докачка была запрошена ({len(offsets)} раз)")
    check(
        bool(offsets) and all(value > 0 for value in offsets),
        f"смещения ненулевые — файл не качался заново с начала: {offsets[:3]}",
    )
    check(
        bool(offsets) and all(value % 4096 == 0 for value in offsets),
        "смещения выровнены по 4096, как требует Telegram",
    )
    async with session_scope() as session:
        files = (
            await session.execute(
                select(MediaFile).where(
                    MediaFile.chat_id == chat_id, MediaFile.status == "done"
                )
            )
        ).scalars().all()
        broken = [
            f for f in files
            if f.size and f.abs_path and Path(f.abs_path).exists()
            and Path(f.abs_path).stat().st_size != f.size
        ]
    check(not broken, f"размеры докачанных файлов совпадают с ожидаемыми ({len(broken)} расхождений)")

    print("\n[14] Финальный добор после исчерпания попыток")
    stubborn = FakeClient(build_messages(6))
    stubborn.flaky_attempts = 7  # больше, чем попыток в основном проходе
    _install_fake_client(account_id, stubborn)
    async with session_scope() as session:
        job9 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                formats=["json"],
                output_dir=str(_TMP_DATA / "exports" / "run_sweep"),
                incremental=False,
                skip_existing=False,
                retry_forever=False,  # основной проход сдастся через max_retries
                final_sweep=True,
                concurrency=2,
            ),
        )
        job9_id = job9.id
    await ExportEngine(job9_id, JobControl()).run()

    async with session_scope() as session:
        left = await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat_id,
                MediaFile.status.in_(("failed", "pending", "downloading")),
            )
        )
    check(left == 0, f"добор вытянул всё, что не осилил основной проход: осталось {left}")

    print("\n[15] Отмена задачи")
    async with session_scope() as session:
        job3 = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(formats=["json"], output_dir=str(output_dir), incremental=False),
        )
        job3_id = job3.id

    control = JobControl()
    engine3 = ExportEngine(job3_id, control)
    task = asyncio.create_task(engine3.run())
    await asyncio.sleep(0.05)
    control.cancel()
    await task

    async with session_scope() as session:
        job3 = await session.get(ExportJob, job3_id)
        check(job3.status == "cancelled", f"задача отменена корректно: {job3.status}")


async def main() -> int:
    print("=" * 64)
    print("TgVault — интеграционный smoke-тест")
    print("=" * 64)
    test_media_detection()
    test_layout()
    try:
        await test_export()
    finally:
        await dispose_engine()

    print("\n" + "=" * 64)
    if FAILED:
        print(f"ПРОВАЛЕНО: {len(FAILED)} из {PASSED + len(FAILED)}")
        for item in FAILED:
            print(f"  - {item}")
        return 1
    print(f"ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: {PASSED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
