"""Declarative base plus dialect-portable column types.

The primary target is MySQL 8, but every type here degrades to something
SQLAlchemy can also create on SQLite so the app can run without Docker for
quick smoke tests (``TGV_DATABASE_URL=sqlite+aiosqlite:///./data/tgvault.db``).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, Text
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase

# --- portable column types -------------------------------------------------

#: 64-bit auto-increment primary key (SQLite needs plain INTEGER for rowid).
PK = BigInteger().with_variant(Integer(), "sqlite")

#: 64-bit signed integer — Telegram ids, sizes, byte counters.
BIG = BigInteger().with_variant(Integer(), "sqlite")

#: Millisecond-precision timestamps (Telegram message ordering needs them).
TS = DateTime().with_variant(mysql.DATETIME(fsp=3), "mysql")

#: Long text (message bodies, rendered HTML).
LONGTEXT = Text().with_variant(mysql.MEDIUMTEXT(), "mysql")


def utcnow() -> datetime:
    """Naive UTC ``datetime`` — the single time convention across the app."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    """Common declarative base with utf8mb4 table defaults on MySQL."""

    __table_args__ = {
        "mysql_engine": "InnoDB",
        "mysql_charset": "utf8mb4",
        "mysql_collate": "utf8mb4_unicode_ci",
    }


# --- vocabularies (stored as VARCHAR for migration-friendliness) -----------

ACCOUNT_STATUSES = (
    "new",
    "pending_code",
    "pending_password",
    "authorized",
    "unauthorized",
    "error",
)

CHAT_KINDS = ("user", "bot", "group", "supergroup", "channel")

MEDIA_TYPES = (
    "none",
    "photo",
    "video",
    "video_note",
    "voice",
    "audio",
    "document",
    "sticker",
    "animation",
    "contact",
    "poll",
    "geo",
    "venue",
    "webpage",
    "game",
    "invoice",
    "dice",
    "unsupported",
)

#: Media kinds a user can actually ask us to download.
DOWNLOADABLE_KINDS = (
    "photo",
    "video",
    "video_note",
    "voice",
    "audio",
    "document",
    "sticker",
    "animation",
)

JOB_STATUSES = ("queued", "running", "paused", "completed", "failed", "cancelled")

JOB_PHASES = ("init", "counting", "fetching", "downloading", "rendering", "done")

FILE_STATUSES = ("pending", "downloading", "done", "failed", "skipped")
