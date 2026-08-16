"""Run TgVault against a fake Telegram, on a seeded demo database.

Used to produce the screenshots and the GIF for the README, and handy for
looking at the UI with realistic data without touching a real account.

    cd backend
    .venv/Scripts/python -m tests.demo_server            # serve on :8078
    .venv/Scripts/python -m tests.demo_server --seed-only

Everything lives in a separate database (``tgvault_demo``) and a separate data
directory (``data/demo``), so the real archive is never touched.

The export it runs is a *real* export through the real engine — only the
Telegram client is fake. That means progress, speeds, the live download list
and the event log all behave exactly as they do in production, which is the
whole point: the README should show the actual product, not a mock-up.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

os.environ.setdefault("TGV_MYSQL_DB", "tgvault_demo")
os.environ.setdefault("TGV_DATA_DIR", str(ROOT_DIR / "data" / "demo"))
os.environ.setdefault("TGV_PORT", "8078")
os.environ.setdefault("TGV_LOG_LEVEL", "INFO")

sys.path.insert(0, str(BACKEND_DIR))

from app.config import settings  # noqa: E402
from app.db.base import utcnow  # noqa: E402
from app.db.bootstrap import init_db, reset_db  # noqa: E402
from app.db.models import (  # noqa: E402
    Account,
    Chat,
    ExportJob,
    JobEvent,
    MediaFile,
    Message,
)
from app.db.session import dispose_engine, session_scope  # noqa: E402
from app.tg.manager import AuthState, ClientHandle, manager  # noqa: E402
from tests.fakes import FakeAttr, FakeMessage, FakeSender  # noqa: E402

# Deterministic output: the same seed produces the same screenshots.
RNG = random.Random(20260816)

CHATS = [
    ("Дизайн и разработка", "design_dev", "channel", 48_300, True),
    ("Rust Weekly", "rustweekly", "channel", 21_400, True),
    ("Команда · релизы", "team_releases", "supergroup", 42, False),
    ("Фотоархив 2024", "photo_archive_24", "channel", 3_120, False),
    ("Заметки и ссылки", None, "channel", 1, False),
    ("Курс: системный дизайн", "sysdesign_course", "channel", 9_870, False),
    ("Родительский чат", None, "supergroup", 118, False),
    ("Backup · документы", None, "channel", 1, False),
    ("Мария Соколова", "m_sokolova", "user", None, False),
    ("Артём Ковалёв", None, "user", None, False),
    ("Игорь", "igor_dev", "user", None, False),
    ("DeployBot", "deploy_bot", "bot", None, False),
]

KINDS = [
    ("photo", ".jpg", "image/jpeg", 180_000, 4_200_000),
    ("video", ".mp4", "video/mp4", 3_000_000, 120_000_000),
    ("video_note", ".mp4", "video/mp4", 400_000, 2_600_000),
    ("voice", ".ogg", "audio/ogg", 30_000, 900_000),
    ("audio", ".mp3", "audio/mpeg", 2_000_000, 14_000_000),
    ("document", ".pdf", "application/pdf", 90_000, 26_000_000),
    ("sticker", ".webp", "image/webp", 20_000, 90_000),
    ("animation", ".mp4", "video/mp4", 400_000, 5_000_000),
]

TEXTS = [
    "Собрал новую сборку, полетело заметно быстрее",
    "Скинул черновик — посмотрите, пожалуйста, вечером",
    "Вот кружок с демо интерфейса",
    "Отчёт за квартал во вложении",
    "Записал голосом, так короче объяснить",
    "Плюсую, давайте так и сделаем",
    "Обновил макеты, ссылка в закрепе",
    "Кто-нибудь смотрел этот доклад?",
    "Финальная версия, правок больше нет",
    "Небольшая заметка на будущее: не забыть про кеш",
]

SENDERS = [
    FakeSender(9001, "Мария Соколова", "m_sokolova"),
    FakeSender(9002, "Артём Ковалёв", None),
    FakeSender(9003, "Игорь Лебедев", "igor_dev"),
    FakeSender(9004, "Ольга Петрова", "olga_pm"),
]


class SlowFakeClient:
    """Fake Telegram that downloads at a believable speed.

    Sleeping in proportion to file size is what makes the recorded GIF look
    like a real export rather than a progress bar snapping to 100%.
    """

    def __init__(self, messages: list[FakeMessage], mbps: float = 6.0) -> None:
        self.messages = messages
        self.bytes_per_second = mbps * 1024 * 1024
        self.downloads: list[str] = []

    def is_connected(self) -> bool:
        return True

    async def is_user_authorized(self) -> bool:
        return True

    async def get_entity(self, value):
        return FakeAttr()

    async def get_input_entity(self, value):
        return FakeAttr()

    async def get_messages(self, entity, limit=None, ids=None):
        if ids is not None:
            return next((m for m in self.messages if m.id == ids), None)

        class _Total(list):
            total = len(self.messages)

        return _Total()

    def iter_messages(self, entity, **kwargs):
        reverse = kwargs.get("reverse", True)
        min_id = kwargs.get("min_id")
        limit = kwargs.get("limit")
        selected = [m for m in self.messages if not min_id or m.id > min_id]
        selected.sort(key=lambda m: m.id, reverse=not reverse)
        if limit:
            selected = selected[:limit]

        async def generator():
            for message in selected:
                await asyncio.sleep(0.004)  # imitate network latency
                yield message

        return generator()

    async def download_media(self, message, file=None, progress_callback=None, **_):
        size = getattr(getattr(message, "file", None), "size", 0) or 256_000
        path = Path(file)
        path.parent.mkdir(parents=True, exist_ok=True)
        chunk = max(64 * 1024, int(self.bytes_per_second / 20))
        written = 0
        with path.open("wb") as handle:
            while written < size:
                step = min(chunk, size - written)
                handle.write(b"\0" * step)
                written += step
                if progress_callback:
                    progress_callback(written, size)
                await asyncio.sleep(step / self.bytes_per_second)
        self.downloads.append(str(path))
        return str(path)

    async def download_profile_photo(self, entity, file=None, **_):
        return None

    def takeout(self, **_):
        raise RuntimeError("takeout is not available in the demo")

    def iter_dialogs(self, limit=None, archived=None, **_):
        async def generator():
            for _ in ():
                yield _

        return generator()


def build_demo_messages(count: int = 2400) -> list[FakeMessage]:
    base = datetime(2024, 3, 1, 9, 0, tzinfo=timezone.utc)
    messages: list[FakeMessage] = []
    for index in range(count):
        roll = RNG.random()
        if roll < 0.42:
            kind = "none"
        elif roll < 0.62:
            kind = "photo"
        elif roll < 0.72:
            kind = "video_note"
        elif roll < 0.80:
            kind = "video"
        elif roll < 0.87:
            kind = "voice"
        elif roll < 0.93:
            kind = "document"
        elif roll < 0.97:
            kind = "animation"
        else:
            kind = "audio"
        spec = next((k for k in KINDS if k[0] == kind), None)
        size = RNG.randint(spec[3], spec[4]) if spec else 0
        messages.append(
            FakeMessage(
                index + 1,
                base + timedelta(hours=index * 5, minutes=RNG.randint(0, 59)),
                kind=kind,
                text=RNG.choice(TEXTS),
                sender=RNG.choice(SENDERS),
                size=size,
                views=RNG.randint(400, 48_000),
            )
        )
    return messages


async def seed() -> tuple[int, int]:
    """Create the demo account, chats, archived history and past jobs."""
    await init_db()
    await reset_db()

    async with session_scope() as session:
        main = Account(
            label="main",
            phone="+49 176 •• •• 42",
            tg_user_id=770_155_204,
            username="DenisHumen",
            first_name="Denis",
            is_premium=True,
            api_id=2_040_311,
            api_hash="0" * 32,
            status="authorized",
            last_seen_at=utcnow(),
        )
        archive = Account(
            label="архив",
            phone="+49 176 •• •• 07",
            tg_user_id=770_155_991,
            username="denis_archive",
            first_name="Denis",
            api_id=2_040_311,
            api_hash="0" * 32,
            status="unauthorized",
            last_error="Сессия недействительна — требуется повторный вход.",
        )
        session.add_all([main, archive])
        await session.flush()

        chat_rows: list[Chat] = []
        for order, (title, username, kind, members, verified) in enumerate(CHATS):
            chat = Chat(
                account_id=main.id,
                tg_chat_id=-1_002_000_000_000 - order if kind != "user" else 900_000 + order,
                kind=kind,
                title=title,
                username=username,
                about="Демонстрационный чат для скриншотов TgVault." if order < 3 else None,
                participants_count=members,
                is_broadcast=kind == "channel",
                is_megagroup=kind == "supergroup",
                is_verified=verified,
                is_pinned=order < 2,
                unread_count=RNG.randint(0, 40) if order % 3 else 0,
                last_message_date=utcnow() - timedelta(hours=order * 7),
                last_synced_at=utcnow(),
            )
            session.add(chat)
            chat_rows.append(chat)
        await session.flush()

        # A second chat with a fully archived history, so the chat detail page
        # and the dashboard counters are not empty in the screenshots.
        history_chat = chat_rows[3]
        base = datetime(2024, 5, 1, 10, 0)
        total_bytes = 0
        media_count = 0
        for index in range(420):
            roll = RNG.random()
            kind = "none" if roll < 0.4 else RNG.choice([k[0] for k in KINDS])
            # The name must follow the id, otherwise "top senders" groups by id
            # and shows one arbitrary name for every row.
            sender = RNG.choice(SENDERS)
            message = Message(
                account_id=main.id,
                chat_id=history_chat.id,
                tg_message_id=index + 1,
                date=base + timedelta(hours=index * 4),
                sender_id=sender.id,
                sender_name=sender.first_name,
                text=RNG.choice(TEXTS),
                media_type=kind,
                has_media=kind != "none",
                views=RNG.randint(300, 20_000),
            )
            session.add(message)
            await session.flush()
            if kind != "none":
                spec = next(k for k in KINDS if k[0] == kind)
                size = RNG.randint(spec[3], spec[4])
                status = "done" if RNG.random() > 0.06 else "failed"
                if status == "done":
                    total_bytes += size
                    media_count += 1
                session.add(
                    MediaFile(
                        account_id=main.id,
                        chat_id=history_chat.id,
                        message_id=message.id,
                        tg_message_id=message.tg_message_id,
                        kind=kind,
                        file_name=f"{kind}_{index + 1}{spec[1]}",
                        ext=spec[1],
                        mime_type=spec[2],
                        size=size,
                        rel_path=f"media/{kind}s/2024-05/{kind}_{index + 1}{spec[1]}",
                        status=status,
                        error=None if status == "done" else "file reference expired",
                        downloaded_at=utcnow() if status == "done" else None,
                    )
                )
        history_chat.messages_cached = 420
        history_chat.media_cached = media_count
        history_chat.bytes_cached = total_bytes

        # Finished jobs give the jobs page and the dashboard some history.
        done = ExportJob(
            account_id=main.id,
            chat_id=history_chat.id,
            status="completed",
            phase="done",
            options={"layout": "by_type_date", "formats": ["json", "html"]},
            output_dir=str(settings.exports_path / "photo_archive_24"),
            total_messages=420,
            processed_messages=420,
            total_files=media_count,
            downloaded_files=media_count,
            bytes_total=total_bytes,
            bytes_downloaded=total_bytes,
            speed_bps=7_340_032,
            started_at=utcnow() - timedelta(minutes=52),
            finished_at=utcnow() - timedelta(minutes=9),
        )
        failed = ExportJob(
            account_id=main.id,
            chat_id=chat_rows[6].id,
            status="failed",
            phase="done",
            options={"layout": "by_sender", "formats": ["json"]},
            total_messages=1_200,
            processed_messages=143,
            total_files=61,
            downloaded_files=54,
            failed_files=7,
            bytes_total=402_653_184,
            bytes_downloaded=181_403_648,
            error="Telegram не ответил на запрос истории за 180 с",
            started_at=utcnow() - timedelta(hours=3),
            finished_at=utcnow() - timedelta(hours=2, minutes=48),
        )
        session.add_all([done, failed])
        await session.flush()
        session.add_all(
            [
                JobEvent(job_id=done.id, level="info", message="Задача создана и поставлена в очередь"),
                JobEvent(job_id=done.id, level="info", message="Старт экспорта «Фотоархив 2024»"),
                JobEvent(job_id=done.id, level="info", message="Получено сообщений: 420, файлов в очереди: 249"),
                JobEvent(job_id=done.id, level="info", message="Готово: manifest.json, messages.json, index.html"),
                JobEvent(job_id=failed.id, level="warning", message="Ограничение Telegram (FloodWait): пауза 78 с"),
                JobEvent(job_id=failed.id, level="error", message="Telegram не ответил на запрос истории за 180 с"),
            ]
        )
        result = (main.id, chat_rows[0].id)

    # Seeding runs in its own event loop; uvicorn will start another one, and
    # an async engine is bound to the loop that created it.
    await dispose_engine()
    return result


def install_fake_client(account_id: int, client: SlowFakeClient) -> None:
    handle = ClientHandle(
        account_id=account_id, client=client, auth=AuthState(account_id=account_id)
    )
    manager._handles[account_id] = handle  # noqa: SLF001 - demo seam

    async def _get_or_create(account):
        return manager._handles.get(account.id) or handle  # noqa: SLF001

    manager.get_or_create = _get_or_create  # type: ignore[method-assign]


async def start_live_export(account_id: int, chat_id: int, messages_count: int) -> int:
    """Queue a real export job driven by the fake client."""
    from app.services.jobs import create_job, launch
    from app.services.options import ExportOptions

    async with session_scope() as session:
        job = await create_job(
            session,
            account_id=account_id,
            chat_id=chat_id,
            options=ExportOptions(
                layout="by_type_date",
                formats=["json", "html"],
                concurrency=4,
                incremental=False,
                skip_existing=False,
                output_dir=str(settings.exports_path / "design_dev_live"),
            ),
        )
        job_id = job.id
    await launch(job_id)
    return job_id


def main() -> int:
    parser = argparse.ArgumentParser(description="TgVault demo server")
    parser.add_argument("--seed-only", action="store_true", help="только заполнить БД")
    parser.add_argument("--no-export", action="store_true", help="не запускать живой экспорт")
    parser.add_argument("--messages", type=int, default=2400)
    parser.add_argument("--port", type=int, default=int(os.environ.get("TGV_PORT", 8078)))
    args = parser.parse_args()

    account_id, chat_id = asyncio.run(seed())
    print(f"demo database seeded: account #{account_id}, chat #{chat_id}")
    if args.seed_only:
        return 0

    import uvicorn

    from app.main import app

    fake = SlowFakeClient(build_demo_messages(args.messages))

    # ``@app.on_event`` is ignored once a lifespan context is supplied (and
    # app.main supplies one), so wrap the existing lifespan instead.
    base_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def demo_lifespan(scoped_app):  # pragma: no cover - demo only
        async with base_lifespan(scoped_app):
            install_fake_client(account_id, fake)
            job_task: asyncio.Task | None = None
            if not args.no_export:

                async def _kickoff() -> None:
                    await asyncio.sleep(1.5)
                    job_id = await start_live_export(account_id, chat_id, args.messages)
                    print(f"live demo export started: job #{job_id}")

                job_task = asyncio.create_task(_kickoff())
            try:
                yield
            finally:
                if job_task is not None:
                    job_task.cancel()

    app.router.lifespan_context = demo_lifespan

    print(f"serving demo UI on http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
