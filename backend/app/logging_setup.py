"""Logging: console + rotating files + MySQL table + live WebSocket stream.

Three sinks, on purpose:
  * ``data/logs/app.log`` — everything, rotated, survives restarts;
  * ``app_logs`` table — queryable/filterable from the UI;
  * the event bus — live tail in the browser.

The database sink is buffered and drained by a background task, because the
logging API is synchronous and may be called from Telethon's threads; blocking
on MySQL inside ``emit()`` would deadlock the export loop.
"""

from __future__ import annotations

import asyncio
import logging
import logging.handlers
import queue
import sys
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

from app.bus import bus
from app.config import settings

_LOG_FORMAT = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

#: Loggers excluded from the DB sink — writing SQL logs through SQLAlchemy
#: would recurse; Telethon's debug chatter would flood the table.
_DB_SINK_DENYLIST = ("sqlalchemy", "aiomysql", "asyncio", "telethon.network", "uvicorn.access")

_pending: "queue.SimpleQueue[dict[str, Any]]" = queue.SimpleQueue()
_writer_task: asyncio.Task | None = None
_MAX_BATCH = 200


class _ColorFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[38;5;244m",
        "INFO": "\033[38;5;39m",
        "WARNING": "\033[38;5;214m",
        "ERROR": "\033[38;5;203m",
        "CRITICAL": "\033[48;5;203;38;5;231m",
    }
    RESET = "\033[0m"

    def __init__(self, use_color: bool) -> None:
        super().__init__(_LOG_FORMAT, _DATE_FORMAT)
        self.use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        if not self.use_color:
            return text
        color = self.COLORS.get(record.levelname, "")
        return f"{color}{text}{self.RESET}" if color else text


class BufferedDbHandler(logging.Handler):
    """Queues records for the async DB writer and streams them to the UI."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.name.startswith(_DB_SINK_DENYLIST):
                return
            if record.levelno < logging.INFO:
                return
            payload = {
                "ts": datetime.now(timezone.utc).replace(tzinfo=None),
                "level": record.levelname,
                "logger": record.name[:64],
                "message": self.format(record)[:8000],
                "account_id": getattr(record, "account_id", None),
                "job_id": getattr(record, "job_id", None),
                "data": getattr(record, "data", None),
            }
            _pending.put_nowait(payload)
        except Exception:  # noqa: BLE001 - logging must never raise
            pass


async def _db_writer_loop() -> None:
    """Drain the buffer into ``app_logs`` and mirror lines onto the bus."""
    from app.db.models import AppLog
    from app.db.session import session_scope

    while True:
        try:
            await asyncio.sleep(0.75)
            batch: list[dict[str, Any]] = []
            while len(batch) < _MAX_BATCH:
                try:
                    batch.append(_pending.get_nowait())
                except queue.Empty:
                    break
            if not batch:
                continue
            try:
                async with session_scope() as session:
                    rows = [AppLog(**item) for item in batch]
                    session.add_all(rows)
                    await session.flush()
                    for row in rows:
                        await bus.publish(
                            "log",
                            {
                                "id": row.id,
                                "ts": row.ts.isoformat(timespec="milliseconds") + "Z",
                                "level": row.level,
                                "logger": row.logger,
                                "message": row.message,
                                "account_id": row.account_id,
                                "job_id": row.job_id,
                                "data": row.data,
                            },
                        )
            except Exception:  # noqa: BLE001 - DB down must not kill logging
                for item in batch[-50:]:
                    await bus.publish(
                        "log",
                        {
                            "id": 0,
                            "ts": item["ts"].isoformat(timespec="milliseconds") + "Z",
                            "level": item["level"],
                            "logger": item["logger"],
                            "message": item["message"],
                            "account_id": item["account_id"],
                            "job_id": item["job_id"],
                            "data": None,
                        },
                    )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            await asyncio.sleep(2)


def setup_logging() -> None:
    """Install all handlers. Idempotent."""
    settings.ensure_dirs()
    root = logging.getLogger()
    if getattr(root, "_tgvault_configured", False):
        return

    root.setLevel(logging.DEBUG)
    for handler in list(root.handlers):
        root.removeHandler(handler)

    use_color = hasattr(sys.stderr, "isatty") and sys.stderr.isatty()
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(getattr(logging, settings.log_level, logging.INFO))
    console.setFormatter(_ColorFormatter(use_color))
    root.addHandler(console)

    plain = logging.Formatter(_LOG_FORMAT, _DATE_FORMAT)

    app_file = logging.handlers.RotatingFileHandler(
        settings.logs_path / "app.log", maxBytes=20 * 1024 * 1024, backupCount=7, encoding="utf-8"
    )
    app_file.setLevel(logging.DEBUG)
    app_file.setFormatter(plain)
    root.addHandler(app_file)

    error_file = logging.handlers.RotatingFileHandler(
        settings.logs_path / "error.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    error_file.setLevel(logging.ERROR)
    error_file.setFormatter(plain)
    root.addHandler(error_file)

    db_handler = BufferedDbHandler()
    db_handler.setLevel(logging.INFO)
    db_handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(db_handler)

    # Telethon is noisy at DEBUG but its INFO/WARNING lines matter; give it a
    # dedicated file so MTProto issues are easy to find.
    tg_file = logging.handlers.RotatingFileHandler(
        settings.logs_path / "telegram.log", maxBytes=20 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    tg_file.setLevel(logging.DEBUG)
    tg_file.setFormatter(plain)
    tg_logger = logging.getLogger("telethon")
    tg_logger.setLevel(logging.INFO)
    tg_logger.addHandler(tg_file)

    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.db_echo else logging.WARNING
    )
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("aiomysql").setLevel(logging.WARNING)

    root._tgvault_configured = True  # type: ignore[attr-defined]


async def start_log_writer() -> None:
    global _writer_task
    if _writer_task is None or _writer_task.done():
        _writer_task = asyncio.create_task(_db_writer_loop(), name="log-writer")


async def stop_log_writer() -> None:
    global _writer_task
    if _writer_task is not None:
        _writer_task.cancel()
        with suppress(asyncio.CancelledError):
            await _writer_task
        _writer_task = None


def get_logger(name: str) -> logging.LoggerAdapter | logging.Logger:
    return logging.getLogger(f"tgvault.{name}" if not name.startswith("tgvault") else name)
