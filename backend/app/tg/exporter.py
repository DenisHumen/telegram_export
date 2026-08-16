"""The export engine.

Design notes worth knowing before editing:

* **Producer/consumer with a bounded queue.** Messages are fetched by one
  producer and downloaded by N workers. The queue is small on purpose: it is
  the backpressure mechanism, and it keeps the Telethon ``Message`` objects
  alive only for the files still in flight. Holding every message of a 200k
  channel in RAM would not fit; re-fetching each message at download time
  would double the API calls. The bounded queue avoids both.
* **File references expire.** A ``file_reference`` obtained during the fetch is
  valid for tens of minutes. On a long export the download of a message
  fetched an hour ago fails with ``FileReferenceExpiredError``; the fix is to
  re-fetch that single message and retry with the fresh reference.
* **FloodWait is normal, not exceptional.** Telethon auto-sleeps below the
  threshold; above it we sleep explicitly and report it in the job timeline so
  the user sees "waiting 15 min" instead of a frozen progress bar.
* **Everything is resumable.** Each message and file is committed as it is
  processed, so a cancelled or crashed job can be re-run and will skip what is
  already on disk.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import (
    AuthKeyDuplicatedError,
    AuthKeyUnregisteredError,
    ChannelPrivateError,
    ChatAdminRequiredError,
    FileReferenceExpiredError,
    FloodWaitError,
    RPCError,
    UserDeactivatedError,
)

from app.bus import bus
from app.config import settings
from app.db.base import utcnow
from app.db.models import Account, Chat, ExportJob, JobEvent, MediaFile, Message
from app.db.session import session_scope
from app.services.layout import directory_for, render_filename, unique_path
from app.services.options import ExportOptions
from app.tg.extract import extract_file_info, extract_message, slugify
from app.tg.manager import manager

log = logging.getLogger("tgvault.export")

_QUEUE_SIZE = 64
_BATCH_SIZE = 60
_PROGRESS_INTERVAL = 0.7  # seconds between UI progress pushes
_MAX_FLOOD_WAIT = 3600  # refuse to sit on a >1h flood wait


class ExportCancelled(Exception):
    """Raised inside the engine when the user cancels a job."""


class JobControl:
    """Pause / resume / cancel signalling for a running job."""

    def __init__(self) -> None:
        self._resume = asyncio.Event()
        self._resume.set()
        self.cancelled = False
        self.paused = False

    def pause(self) -> None:
        self.paused = True
        self._resume.clear()

    def resume(self) -> None:
        self.paused = False
        self._resume.set()

    def cancel(self) -> None:
        self.cancelled = True
        self._resume.set()

    async def checkpoint(self) -> None:
        """Await here at every safe interruption point."""
        if self.cancelled:
            raise ExportCancelled()
        if not self._resume.is_set():
            await self._resume.wait()
        if self.cancelled:
            raise ExportCancelled()


#: Live controls for running jobs, keyed by job id.
controls: dict[int, JobControl] = {}


#: Media kinds that carry a separate thumbnail worth downloading.
_THUMBABLE = {"video", "video_note", "animation", "document"}


@dataclass
class DownloadItem:
    media_id: int
    tg_message_id: int
    message: Any
    abs_path: Path
    rel_path: str
    expected_size: int | None
    #: Download the message's thumbnail instead of the file itself.
    thumb: bool = False
    #: Download this entity's profile photo instead of message media.
    avatar_entity: Any = None


@dataclass
class Progress:
    total_messages: int = 0
    processed_messages: int = 0
    total_files: int = 0
    downloaded_files: int = 0
    failed_files: int = 0
    skipped_files: int = 0
    bytes_total: int = 0
    bytes_downloaded: int = 0
    last_processed_id: int | None = None
    started_monotonic: float = field(default_factory=time.monotonic)

    @property
    def speed_bps(self) -> int:
        elapsed = max(0.001, time.monotonic() - self.started_monotonic)
        return int(self.bytes_downloaded / elapsed)

    @property
    def eta_seconds(self) -> int | None:
        speed = self.speed_bps
        remaining = self.bytes_total - self.bytes_downloaded
        if speed <= 0 or remaining <= 0:
            return None
        return int(remaining / speed)


class ExportEngine:
    """Runs one :class:`ExportJob` end to end."""

    def __init__(self, job_id: int, control: JobControl) -> None:
        self.job_id = job_id
        self.control = control
        self.options = ExportOptions()
        self.progress = Progress()
        self.output_dir: Path = settings.exports_path
        self.chat_id = 0
        self.account_id = 0
        self.chat_title = ""
        self.entity: Any = None
        self.client: Any = None
        self.fetch_client: Any = None
        self._taken_paths: set[str] = set()
        self._avatar_senders: set[int] = set()
        self._last_publish = 0.0
        self._phase = "init"
        self._flood_until: float | None = None
        self._fatal_error: Exception | None = None

    # -- persistence helpers ---------------------------------------------

    async def _event(self, level: str, message: str, data: dict | None = None) -> None:
        async with session_scope() as session:
            event = JobEvent(job_id=self.job_id, level=level, message=message, data=data)
            session.add(event)
            await session.flush()
            payload = {
                "id": event.id,
                "job_id": self.job_id,
                "ts": event.ts.isoformat(timespec="milliseconds") + "Z",
                "level": level,
                "message": message,
                "data": data,
            }
        await bus.publish("job_event", payload)
        log.log(
            {"debug": logging.DEBUG, "info": logging.INFO, "warning": logging.WARNING}.get(
                level, logging.ERROR
            ),
            "[job %s] %s",
            self.job_id,
            message,
            extra={"job_id": self.job_id, "account_id": self.account_id},
        )

    async def _save_progress(self, *, force: bool = False, phase: str | None = None) -> None:
        if phase:
            self._phase = phase
        now = time.monotonic()
        if not force and (now - self._last_publish) < _PROGRESS_INTERVAL:
            return
        self._last_publish = now
        async with session_scope() as session:
            job = await session.get(ExportJob, self.job_id)
            if job is None:
                return
            job.phase = self._phase
            job.total_messages = self.progress.total_messages
            job.processed_messages = self.progress.processed_messages
            job.total_files = self.progress.total_files
            job.downloaded_files = self.progress.downloaded_files
            job.failed_files = self.progress.failed_files
            job.skipped_files = self.progress.skipped_files
            job.bytes_total = self.progress.bytes_total
            job.bytes_downloaded = self.progress.bytes_downloaded
            job.speed_bps = self.progress.speed_bps
            job.eta_seconds = self.progress.eta_seconds
            job.last_processed_id = self.progress.last_processed_id
            await session.flush()
            payload = await job_to_dict(session, job)
        await bus.publish("job_progress", payload)

    # -- main entry point -------------------------------------------------

    async def run(self) -> None:
        try:
            await self._prepare()
            async with contextlib.AsyncExitStack() as stack:
                self.fetch_client = await self._acquire_fetch_client(stack)
                await self._pipeline()
            if self._fatal_error is not None:
                raise self._fatal_error
            await self._render()
            await self._finish("completed")
        except ExportCancelled:
            if self._fatal_error is not None:
                await self._invalidate_account(self._fatal_error)
                await self._finish("failed", str(self._fatal_error))
            else:
                await self._event("warning", "Экспорт отменён пользователем")
                await self._finish("cancelled")
        except (ChannelPrivateError, ChatAdminRequiredError) as exc:
            await self._event("error", f"Нет доступа к чату: {exc}")
            await self._finish("failed", str(exc))
        except (AuthKeyDuplicatedError, AuthKeyUnregisteredError, UserDeactivatedError) as exc:
            # These kill the session itself — the account must log in again.
            await self._invalidate_account(exc)
            await self._finish("failed", str(exc))
        except Exception as exc:  # noqa: BLE001 - a job failure must not kill the app
            log.exception("Export job %s crashed", self.job_id)
            await self._event("error", f"Ошибка экспорта: {exc}")
            await self._finish("failed", f"{type(exc).__name__}: {exc}")
        finally:
            controls.pop(self.job_id, None)

    async def _prepare(self) -> None:
        async with session_scope() as session:
            job = await session.get(ExportJob, self.job_id)
            if job is None:
                raise RuntimeError(f"Задача #{self.job_id} не найдена")
            chat = await session.get(Chat, job.chat_id)
            account = await session.get(Account, job.account_id)
            if chat is None or account is None:
                raise RuntimeError("Чат или аккаунт удалён")

            self.options = ExportOptions.model_validate(job.options or {})
            self.chat_id = chat.id
            self.account_id = account.id
            self.chat_title = chat.title

            if self.options.output_dir:
                output = Path(self.options.output_dir).expanduser()
            else:
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                name = f"{slugify(chat.username or chat.title, 48)}_{chat.tg_chat_id}_{stamp}"
                output = settings.exports_path / name
            output.mkdir(parents=True, exist_ok=True)
            self.output_dir = output

            job.status = "running"
            job.phase = "init"
            job.started_at = utcnow()
            job.output_dir = str(output)
            job.error = None
            await session.flush()

            handle = await manager.get_or_create(account)
            self.client = handle.client

        if not await self.client.is_user_authorized():
            raise RuntimeError("Аккаунт не авторизован — войдите заново.")

        await self._event(
            "info",
            f"Старт экспорта «{self.chat_title}» → {self.output_dir}",
            {"layout": self.options.layout, "formats": self.options.formats},
        )

        async with session_scope() as session:
            chat = await session.get(Chat, self.chat_id)
            self.entity = await self._resolve_entity(chat)

        await self._save_progress(force=True, phase="counting")
        await self._count_messages()

    async def _resolve_entity(self, chat: Chat) -> Any:
        last_error: Exception | None = None
        candidates: list[Any] = [chat.tg_chat_id]
        if chat.username:
            candidates.append(chat.username)
        for resolver in (self.client.get_entity, self.client.get_input_entity):
            for candidate in candidates:
                try:
                    return await resolver(candidate)
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
        raise RuntimeError(
            f"Не удалось получить доступ к чату «{chat.title}»: {last_error}. "
            "Попробуйте пересинхронизировать список чатов."
        )

    async def _acquire_fetch_client(self, stack: contextlib.AsyncExitStack) -> Any:
        """Optionally switch to a takeout session for bulk reads."""
        if not self.options.use_takeout:
            return self.client
        try:
            takeout = await stack.enter_async_context(self.client.takeout(finalize=True))
            await self._event("info", "Включён режим takeout (официальный экспорт данных)")
            return takeout
        except Exception as exc:  # noqa: BLE001
            await self._event(
                "warning",
                f"Takeout недоступен ({type(exc).__name__}) — продолжаю в обычном режиме. "
                "Telegram иногда требует подтвердить экспорт в приложении и подождать.",
            )
            return self.client

    async def _count_messages(self) -> None:
        """Best-effort total for the progress bar."""
        try:
            result = await self.client.get_messages(self.entity, limit=1)
            total = getattr(result, "total", 0) or 0
        except Exception as exc:  # noqa: BLE001
            await self._event("warning", f"Не удалось посчитать сообщения: {exc}")
            total = 0
        if self.options.limit:
            total = min(total, self.options.limit) if total else self.options.limit
        self.progress.total_messages = int(total)
        await self._save_progress(force=True)

    # -- fetch + download pipeline ---------------------------------------

    async def _pipeline(self) -> None:
        queue: asyncio.Queue[DownloadItem | None] = asyncio.Queue(maxsize=_QUEUE_SIZE)
        workers = [
            asyncio.create_task(self._download_worker(queue, i), name=f"dl-{self.job_id}-{i}")
            for i in range(self.options.concurrency)
        ]
        try:
            await self._produce(queue)
        finally:
            for _ in workers:
                await queue.put(None)
            await asyncio.gather(*workers, return_exceptions=True)

    def _iter_kwargs(self, min_id: int | None) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"reverse": self.options.order == "asc"}
        if self.options.limit:
            kwargs["limit"] = self.options.limit
        else:
            kwargs["limit"] = None
        if min_id:
            kwargs["min_id"] = min_id
        if self.options.max_id:
            kwargs["max_id"] = self.options.max_id
        if self.options.search:
            kwargs["search"] = self.options.search
        # ``offset_date`` means "messages older than this", which lines up with
        # a descending walk only. For an ascending walk the equivalent bound is
        # resolved into ``min_id`` by _resolve_date_offset(); passing
        # offset_date there would silently return an empty result set.
        if self.options.order == "desc" and self.options.date_to:
            kwargs["offset_date"] = self.options.date_to
        return kwargs

    async def _resolve_date_offset(self, min_id: int | None) -> int | None:
        """Translate ``date_from`` into a message id for an ascending walk.

        Without this, an export starting at a recent date would still scan the
        whole channel from message #1 (the Python-side date filter would then
        discard almost everything).
        """
        if self.options.order != "asc" or not self.options.date_from:
            return min_id
        try:
            found = await self.client.get_messages(
                self.entity, limit=1, offset_date=self.options.date_from
            )
        except Exception as exc:  # noqa: BLE001 - fall back to a full scan
            log.debug("Could not resolve date_from to an offset: %s", exc)
            return min_id
        boundary = found[0].id if found else None
        if not boundary:
            return min_id
        resolved = max(min_id or 0, int(boundary))
        await self._event(
            "info",
            f"Начинаю с сообщения #{resolved} (граница даты {self.options.date_from:%Y-%m-%d})",
        )
        return resolved

    async def _resolve_min_id(self) -> int | None:
        """Where to resume from for an incremental export."""
        if self.options.min_id:
            return self.options.min_id
        if not self.options.incremental:
            return None
        async with session_scope() as session:
            highest = await session.scalar(
                select(func.max(Message.tg_message_id)).where(Message.chat_id == self.chat_id)
            )
        if highest:
            await self._event(
                "info", f"Инкрементальный режим: догружаю сообщения новее #{highest}"
            )
        return int(highest) if highest else None

    async def _produce(self, queue: asyncio.Queue) -> None:
        await self._save_progress(force=True, phase="fetching")
        min_id = await self._resolve_date_offset(await self._resolve_min_id())
        kwargs = self._iter_kwargs(min_id)

        batch: list[tuple[Any, dict[str, Any], dict[str, Any] | None]] = []
        fetched = 0

        iterator = self.fetch_client.iter_messages(self.entity, **kwargs)
        while True:
            await self.control.checkpoint()
            try:
                message = await self._next_message(iterator)
            except StopAsyncIteration:
                break
            if message is None:
                break

            row = extract_message(message)
            if row is None:
                continue

            # Date filters that iter_messages cannot express exactly.
            if self.options.date_from and row["date"] < self.options.date_from:
                continue
            if self.options.date_to and row["date"] > self.options.date_to:
                continue
            if row["is_service"] and not self.options.include_service_messages:
                continue
            if (
                not row["has_media"]
                and not self.options.include_text_only
                and not row["is_service"]
            ):
                continue

            file_info = None
            if self.options.download_media:
                info = extract_file_info(message, row["media_type"])
                if info and self.options.wants(info["kind"]):
                    max_bytes = self.options.max_file_size_bytes
                    if max_bytes and (info["size"] or 0) > max_bytes:
                        self.progress.skipped_files += 1
                    else:
                        file_info = info

            batch.append((message, row, file_info))
            fetched += 1
            self.progress.processed_messages = fetched
            self.progress.last_processed_id = row["tg_message_id"]

            if len(batch) >= _BATCH_SIZE:
                await self._flush_batch(batch, queue)
                batch = []
                await self._save_progress()

            if self.options.limit and fetched >= self.options.limit:
                break

        if batch:
            await self._flush_batch(batch, queue)
        await self._save_progress(force=True, phase="downloading")
        await self._event(
            "info",
            f"Получено сообщений: {self.progress.processed_messages}, "
            f"файлов в очереди: {self.progress.total_files}",
        )

    async def _next_message(self, iterator) -> Any | None:
        """One step of ``iter_messages`` with flood/retry handling."""
        for attempt in range(1, settings.max_retries + 1):
            try:
                return await iterator.__anext__()
            except StopAsyncIteration:
                raise
            except FloodWaitError as exc:
                await self._handle_flood(exc)
            except (asyncio.TimeoutError, TimeoutError, ConnectionError, OSError) as exc:
                delay = min(2**attempt, 30)
                await self._event("warning", f"Сеть недоступна ({exc}) — повтор через {delay} с")
                await asyncio.sleep(delay)
            except RPCError as exc:
                await self._event("error", f"Telegram отклонил запрос: {exc}")
                raise
        raise RuntimeError("Не удалось получить сообщения после нескольких попыток")

    async def _handle_flood(self, exc: FloodWaitError) -> None:
        seconds = int(getattr(exc, "seconds", 60) or 60)
        if seconds > _MAX_FLOOD_WAIT:
            raise RuntimeError(
                f"Telegram требует ждать {seconds} с — это слишком долго, задача остановлена."
            )
        await self._event(
            "warning",
            f"Ограничение Telegram (FloodWait): пауза {seconds} с",
            {"seconds": seconds},
        )
        self._flood_until = time.monotonic() + seconds
        remaining = seconds
        while remaining > 0:
            await self.control.checkpoint()
            step = min(5, remaining)
            await asyncio.sleep(step)
            remaining -= step
        self._flood_until = None

    async def _flush_batch(self, batch: list, queue: asyncio.Queue) -> None:
        """Persist a batch of messages, then enqueue their downloads."""
        pending: list[DownloadItem] = []
        async with session_scope() as session:
            tg_ids = [row["tg_message_id"] for _, row, _ in batch]
            existing_rows = (
                await session.execute(
                    select(Message).where(
                        Message.chat_id == self.chat_id, Message.tg_message_id.in_(tg_ids)
                    )
                )
            ).scalars().all()
            existing = {row.tg_message_id: row for row in existing_rows}

            created: list[tuple[Message, Any, dict | None]] = []
            for message, row, file_info in batch:
                db_row = existing.get(row["tg_message_id"])
                if db_row is None:
                    db_row = Message(
                        account_id=self.account_id, chat_id=self.chat_id, **row
                    )
                    session.add(db_row)
                else:
                    for key, value in row.items():
                        setattr(db_row, key, value)
                created.append((db_row, message, file_info))
            await session.flush()

            for db_row, message, file_info in created:
                if file_info:
                    item = await self._prepare_download(session, db_row, message, file_info)
                    if item is not None:
                        pending.append(item)
                    if self.options.download_thumbs and file_info["kind"] in _THUMBABLE:
                        thumb = await self._prepare_extra(
                            session, db_row, message, kind="thumb", thumb=True
                        )
                        if thumb is not None:
                            pending.append(thumb)
                if self.options.download_avatars:
                    avatar = await self._prepare_avatar(session, db_row, message)
                    if avatar is not None:
                        pending.append(avatar)
            await session.flush()

        for item in pending:
            await self.control.checkpoint()
            await queue.put(item)

    async def _prepare_download(
        self, session: AsyncSession, db_row: Message, message: Any, info: dict[str, Any]
    ) -> DownloadItem | None:
        """Create/reuse the ``media_files`` row and compute the target path."""
        existing = (
            await session.execute(
                select(MediaFile).where(
                    MediaFile.message_id == db_row.id, MediaFile.kind == info["kind"]
                )
            )
        ).scalars().first()

        if (
            existing is not None
            and existing.status == "done"
            and self.options.skip_existing
            and existing.abs_path
            and Path(existing.abs_path).exists()
        ):
            self.progress.skipped_files += 1
            self.progress.total_files += 1
            return None

        directory = directory_for(
            self.options.layout,
            kind=info["kind"],
            date=db_row.date,
            sender=db_row.sender_name or db_row.post_author,
            grouped_id=db_row.grouped_id,
            size=info["size"],
        )
        filename = render_filename(
            self.options.filename_template,
            message_id=db_row.tg_message_id,
            date=db_row.date,
            original_name=info["file_name"],
            ext=info["ext"],
            kind=info["kind"],
            sender=db_row.sender_name or db_row.post_author,
            chat_title=self.chat_title,
            grouped_id=db_row.grouped_id,
        )
        target_dir = self.output_dir / directory
        target_dir.mkdir(parents=True, exist_ok=True)
        abs_path = unique_path(target_dir, filename, self._taken_paths)
        rel_path = f"{directory}/{abs_path.name}"

        record = existing or MediaFile(
            account_id=self.account_id,
            chat_id=self.chat_id,
            message_id=db_row.id,
            tg_message_id=db_row.tg_message_id,
            kind=info["kind"],
        )
        record.tg_file_id = info["tg_file_id"]
        record.access_hash = info["access_hash"]
        record.file_unique = info["file_unique"]
        record.file_name = info["file_name"]
        record.ext = info["ext"]
        record.mime_type = info["mime_type"]
        record.size = info["size"]
        record.width = info["width"]
        record.height = info["height"]
        record.duration = info["duration"]
        record.rel_path = rel_path
        record.abs_path = str(abs_path)
        record.status = "pending"
        record.error = None
        if existing is None:
            session.add(record)
        await session.flush()

        self.progress.total_files += 1
        self.progress.bytes_total += info["size"] or 0
        return DownloadItem(
            media_id=record.id,
            tg_message_id=db_row.tg_message_id,
            message=message,
            abs_path=abs_path,
            rel_path=rel_path,
            expected_size=info["size"],
        )

    async def _prepare_extra(
        self,
        session: AsyncSession,
        db_row: Message,
        message: Any,
        *,
        kind: str,
        thumb: bool = False,
        avatar_entity: Any = None,
        file_unique: str | None = None,
    ) -> DownloadItem | None:
        """Queue a companion file (thumbnail or avatar) for a message."""
        existing = (
            await session.execute(
                select(MediaFile).where(
                    MediaFile.message_id == db_row.id, MediaFile.kind == kind
                )
            )
        ).scalars().first()
        if (
            existing is not None
            and existing.status == "done"
            and self.options.skip_existing
            and existing.abs_path
            and Path(existing.abs_path).exists()
        ):
            return None

        directory = directory_for(
            self.options.layout,
            kind=kind,
            date=db_row.date,
            sender=db_row.sender_name or db_row.post_author,
            grouped_id=db_row.grouped_id,
            size=None,
        )
        filename = render_filename(
            self.options.filename_template,
            message_id=db_row.tg_message_id,
            date=db_row.date,
            original_name=None,
            ext=".jpg",
            kind=kind,
            sender=db_row.sender_name or db_row.post_author,
            chat_title=self.chat_title,
            grouped_id=db_row.grouped_id,
        )
        target_dir = self.output_dir / directory
        target_dir.mkdir(parents=True, exist_ok=True)
        abs_path = unique_path(target_dir, filename, self._taken_paths)

        record = existing or MediaFile(
            account_id=self.account_id,
            chat_id=self.chat_id,
            message_id=db_row.id,
            tg_message_id=db_row.tg_message_id,
            kind=kind,
        )
        record.file_unique = file_unique
        record.file_name = filename
        record.ext = ".jpg"
        record.mime_type = "image/jpeg"
        record.rel_path = f"{directory}/{abs_path.name}"
        record.abs_path = str(abs_path)
        record.status = "pending"
        record.error = None
        if existing is None:
            session.add(record)
        await session.flush()

        self.progress.total_files += 1
        return DownloadItem(
            media_id=record.id,
            tg_message_id=db_row.tg_message_id,
            message=message,
            abs_path=abs_path,
            rel_path=record.rel_path,
            expected_size=None,
            thumb=thumb,
            avatar_entity=avatar_entity,
        )

    async def _prepare_avatar(
        self, session: AsyncSession, db_row: Message, message: Any
    ) -> DownloadItem | None:
        """Queue the sender's profile photo, once per sender per export."""
        sender_id = db_row.sender_id
        if not sender_id or sender_id in self._avatar_senders:
            return None
        try:
            sender = getattr(message, "sender", None)
        except Exception:  # noqa: BLE001
            sender = None
        if sender is None:
            return None
        self._avatar_senders.add(sender_id)
        return await self._prepare_extra(
            session,
            db_row,
            message,
            kind="avatar",
            avatar_entity=sender,
            file_unique=f"avatar:{sender_id}",
        )

    # -- download workers -------------------------------------------------

    async def _download_worker(self, queue: asyncio.Queue, worker_id: int) -> None:
        while True:
            item = await queue.get()
            try:
                if item is None:
                    return
                await self._download_one(item)
            except ExportCancelled:
                return
            except (
                AuthKeyDuplicatedError,
                AuthKeyUnregisteredError,
                UserDeactivatedError,
            ) as exc:
                # Cannot be raised out of a worker task, so signal the engine.
                self._fatal_error = exc
                self.control.cancel()
                return
            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the run
                log.warning("Download worker %s failed: %s", worker_id, exc)
            finally:
                queue.task_done()

    async def _mark_file(self, media_id: int, **fields: Any) -> None:
        async with session_scope() as session:
            record = await session.get(MediaFile, media_id)
            if record is None:
                return
            for key, value in fields.items():
                setattr(record, key, value)

    async def _download_one(self, item: DownloadItem) -> None:
        await self.control.checkpoint()
        item.abs_path.parent.mkdir(parents=True, exist_ok=True)
        await self._mark_file(item.media_id, status="downloading")

        message = item.message
        received_so_far = 0

        def on_progress(received: int, _total: int) -> None:
            nonlocal received_so_far
            delta = received - received_so_far
            if delta > 0:
                self.progress.bytes_downloaded += delta
                received_so_far = received

        last_error = ""
        for attempt in range(1, settings.max_retries + 1):
            await self.control.checkpoint()
            try:
                if item.avatar_entity is not None:
                    result = await self.client.download_profile_photo(
                        item.avatar_entity, file=str(item.abs_path)
                    )
                    if result is None:
                        # No avatar set — not an error, just nothing to save.
                        await self._mark_file(
                            item.media_id, status="skipped", error=None, attempts=attempt
                        )
                        self.progress.skipped_files += 1
                        return
                elif item.thumb:
                    result = await self.client.download_media(
                        message, file=str(item.abs_path), thumb=-1
                    )
                    if result is None:
                        await self._mark_file(
                            item.media_id, status="skipped", error=None, attempts=attempt
                        )
                        self.progress.skipped_files += 1
                        return
                else:
                    result = await self.client.download_media(
                        message, file=str(item.abs_path), progress_callback=on_progress
                    )
                if result is None:
                    raise RuntimeError("Telegram не вернул файл")
                path = Path(result)
                size = path.stat().st_size if path.exists() else 0
                # Reconcile the byte counter with reality (retries double-count).
                if item.expected_size:
                    self.progress.bytes_downloaded += size - received_so_far
                await self._mark_file(
                    item.media_id,
                    status="done",
                    size=size or item.expected_size,
                    abs_path=str(path),
                    downloaded_at=utcnow(),
                    error=None,
                    attempts=attempt,
                )
                self.progress.downloaded_files += 1
                await self._save_progress()
                return
            except FileReferenceExpiredError:
                # The reference we captured during the fetch went stale; a fresh
                # copy of the same message carries a valid one.
                last_error = "file reference expired"
                refreshed = await self._refetch_message(item.tg_message_id)
                if refreshed is None:
                    break
                message = refreshed
                received_so_far = 0
            except FloodWaitError as exc:
                last_error = f"FloodWait {exc.seconds}s"
                await self._handle_flood(exc)
                received_so_far = 0
            except ExportCancelled:
                raise
            except (AuthKeyDuplicatedError, AuthKeyUnregisteredError, UserDeactivatedError):
                # Session-fatal: stop the whole job instead of failing 10k files.
                raise
            except (asyncio.TimeoutError, TimeoutError, ConnectionError, OSError) as exc:
                last_error = str(exc)
                await asyncio.sleep(min(2**attempt, 30))
                received_so_far = 0
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
                break

        self.progress.failed_files += 1
        await self._mark_file(
            item.media_id, status="failed", error=last_error[:1000], attempts=settings.max_retries
        )
        await self._event(
            "warning", f"Не удалось скачать файл {item.rel_path}: {last_error}"
        )
        with contextlib.suppress(OSError):
            if item.abs_path.exists() and item.abs_path.stat().st_size == 0:
                item.abs_path.unlink()
        await self._save_progress()

    async def _invalidate_account(self, exc: Exception) -> None:
        """Mark the account as needing a fresh login and drop its client.

        ``AuthKeyDuplicatedError`` in particular means Telegram destroyed the
        auth key because the same session was used from two places at once —
        continuing to retry would be pointless and could compound the problem.
        """
        reason = f"{type(exc).__name__}: {exc}"
        await self._event(
            "error",
            f"Сессия Telegram больше не действительна ({reason}). Требуется повторный вход.",
        )
        async with session_scope() as session:
            account = await session.get(Account, self.account_id)
            if account is not None:
                account.status = "unauthorized"
                account.last_error = reason
                if isinstance(exc, AuthKeyDuplicatedError):
                    account.session_enc = None
        await manager.disconnect(self.account_id)

    async def _refetch_message(self, tg_message_id: int) -> Any | None:
        try:
            return await self.client.get_messages(self.entity, ids=tg_message_id)
        except Exception as exc:  # noqa: BLE001
            log.debug("Re-fetch of message %s failed: %s", tg_message_id, exc)
            return None

    # -- output -----------------------------------------------------------

    async def _render(self) -> None:
        from app.services.render import write_outputs

        await self.control.checkpoint()
        await self._save_progress(force=True, phase="rendering")
        await self._event("info", "Формирую выходные файлы…")
        async with session_scope() as session:
            written = await write_outputs(
                session,
                job_id=self.job_id,
                chat_id=self.chat_id,
                account_id=self.account_id,
                output_dir=self.output_dir,
                options=self.options,
                progress={
                    "messages": self.progress.processed_messages,
                    "media_files": self.progress.downloaded_files,
                    "bytes": self.progress.bytes_downloaded,
                },
            )
        await self._event("info", f"Готово: {', '.join(written)}", {"files": written})

    async def _finish(self, status: str, error: str | None = None) -> None:
        async with session_scope() as session:
            job = await session.get(ExportJob, self.job_id)
            if job is not None:
                job.status = status
                job.phase = "done"
                job.finished_at = utcnow()
                job.error = error
                job.total_messages = max(job.total_messages, self.progress.processed_messages)
                job.processed_messages = self.progress.processed_messages
                job.total_files = self.progress.total_files
                job.downloaded_files = self.progress.downloaded_files
                job.failed_files = self.progress.failed_files
                job.skipped_files = self.progress.skipped_files
                job.bytes_total = self.progress.bytes_total
                job.bytes_downloaded = self.progress.bytes_downloaded
                job.speed_bps = self.progress.speed_bps
                job.eta_seconds = None
                await session.flush()
                payload = await job_to_dict(session, job)
            else:
                payload = None

            chat = await session.get(Chat, self.chat_id)
            if chat is not None:
                chat.messages_cached = int(
                    await session.scalar(
                        select(func.count(Message.id)).where(Message.chat_id == self.chat_id)
                    )
                    or 0
                )
                chat.media_cached = int(
                    await session.scalar(
                        select(func.count(MediaFile.id)).where(
                            MediaFile.chat_id == self.chat_id, MediaFile.status == "done"
                        )
                    )
                    or 0
                )
                chat.bytes_cached = int(
                    await session.scalar(
                        select(func.coalesce(func.sum(MediaFile.size), 0)).where(
                            MediaFile.chat_id == self.chat_id, MediaFile.status == "done"
                        )
                    )
                    or 0
                )

        if payload:
            await bus.publish("job_progress", payload)
        level = "info" if status == "completed" else "warning"
        await self._event(
            level,
            f"Задача завершена со статусом «{status}». "
            f"Сообщений: {self.progress.processed_messages}, "
            f"файлов: {self.progress.downloaded_files}, "
            f"ошибок: {self.progress.failed_files}",
        )


async def job_to_dict(session: AsyncSession, job: ExportJob) -> dict[str, Any]:
    """Serialise a job exactly as the contract's ``ExportJob`` interface."""
    chat = await session.get(Chat, job.chat_id)
    return {
        "id": job.id,
        "account_id": job.account_id,
        "chat_id": job.chat_id,
        "chat_title": chat.title if chat else "",
        "status": job.status,
        "phase": job.phase,
        "options": job.options,
        "output_dir": job.output_dir,
        "total_messages": job.total_messages,
        "processed_messages": job.processed_messages,
        "total_files": job.total_files,
        "downloaded_files": job.downloaded_files,
        "failed_files": job.failed_files,
        "skipped_files": job.skipped_files,
        "bytes_total": job.bytes_total,
        "bytes_downloaded": job.bytes_downloaded,
        "speed_bps": job.speed_bps,
        "eta_seconds": job.eta_seconds,
        "error": job.error,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds") + "Z" if value else None
