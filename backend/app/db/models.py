"""ORM models — the schema described in ``docs/CONTRACT.md`` §2.

Multi-account is the core constraint: every row that comes from Telegram
carries ``account_id`` so two accounts can archive the same public channel
without colliding, and deleting an account cascades its whole archive away.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import BIG, LONGTEXT, PK, TS, Base, utcnow


class Account(Base):
    """A Telegram user account connected to TgVault."""

    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("tg_user_id", name="uq_accounts_tg_user_id"),
        Index("ix_accounts_status", "status"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    phone: Mapped[str | None] = mapped_column(String(32))
    tg_user_id: Mapped[int | None] = mapped_column(BIG)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    api_id: Mapped[int] = mapped_column(Integer, nullable=False)
    api_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    session_enc: Mapped[str | None] = mapped_column(Text)
    dc_id: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[str] = mapped_column(String(24), default="new", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    proxy: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(TS)

    chats: Mapped[list["Chat"]] = relationship(
        back_populates="account", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def display_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) or self.label or (self.phone or f"account #{self.id}")


class Chat(Base):
    """A dialog (channel / supergroup / group / private chat) of one account."""

    __tablename__ = "chats"
    __table_args__ = (
        UniqueConstraint("account_id", "tg_chat_id", name="uq_chats_account_chat"),
        Index("ix_chats_account_kind", "account_id", "kind"),
        Index("ix_chats_account_last_msg", "account_id", "last_message_date"),
        Index("ix_chats_title", "title", mysql_length=191),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tg_chat_id: Mapped[int] = mapped_column(BIG, nullable=False)
    access_hash: Mapped[int | None] = mapped_column(BIG)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="channel")

    title: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    username: Mapped[str | None] = mapped_column(String(64))
    about: Mapped[str | None] = mapped_column(Text)
    participants_count: Mapped[int | None] = mapped_column(Integer)

    is_broadcast: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_megagroup: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_scam: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_creator: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    photo_path: Mapped[str | None] = mapped_column(String(768))
    last_message_id: Mapped[int | None] = mapped_column(BIG)
    last_message_date: Mapped[datetime | None] = mapped_column(TS)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    messages_cached: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    media_cached: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bytes_cached: Mapped[int] = mapped_column(BIG, default=0, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(TS)

    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, nullable=False)

    account: Mapped[Account] = relationship(back_populates="chats")


class Message(Base):
    """One archived Telegram message."""

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("chat_id", "tg_message_id", name="uq_messages_chat_msg"),
        Index("ix_messages_chat_date", "chat_id", "date"),
        Index("ix_messages_chat_media", "chat_id", "media_type"),
        Index("ix_messages_chat_group", "chat_id", "grouped_id"),
        Index("ix_messages_sender", "sender_id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    tg_message_id: Mapped[int] = mapped_column(BIG, nullable=False)

    date: Mapped[datetime] = mapped_column(TS, nullable=False)
    edit_date: Mapped[datetime | None] = mapped_column(TS)

    sender_id: Mapped[int | None] = mapped_column(BIG)
    sender_name: Mapped[str | None] = mapped_column(String(255))
    sender_username: Mapped[str | None] = mapped_column(String(64))
    post_author: Mapped[str | None] = mapped_column(String(128))

    text: Mapped[str | None] = mapped_column(LONGTEXT)
    text_html: Mapped[str | None] = mapped_column(LONGTEXT)
    entities: Mapped[list | None] = mapped_column(JSON)

    media_type: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    has_media: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    grouped_id: Mapped[int | None] = mapped_column(BIG)
    reply_to_msg_id: Mapped[int | None] = mapped_column(BIG)

    fwd_from_name: Mapped[str | None] = mapped_column(String(255))
    fwd_from_id: Mapped[int | None] = mapped_column(BIG)
    fwd_from_date: Mapped[datetime | None] = mapped_column(TS)
    fwd_from_post_id: Mapped[int | None] = mapped_column(BIG)

    views: Mapped[int | None] = mapped_column(Integer)
    forwards: Mapped[int | None] = mapped_column(Integer)
    replies_count: Mapped[int | None] = mapped_column(Integer)
    reactions: Mapped[list | None] = mapped_column(JSON)

    is_service: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    service_action: Mapped[str | None] = mapped_column(String(64))
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_outgoing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)

    files: Mapped[list["MediaFile"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", passive_deletes=True
    )


class MediaFile(Base):
    """A downloadable attachment belonging to a message."""

    __tablename__ = "media_files"
    __table_args__ = (
        Index("ix_media_message", "message_id"),
        Index("ix_media_chat_kind", "chat_id", "kind"),
        Index("ix_media_status", "status"),
        Index("ix_media_chat_unique", "chat_id", "file_unique"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    tg_message_id: Mapped[int] = mapped_column(BIG, nullable=False)

    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    tg_file_id: Mapped[int | None] = mapped_column(BIG)
    access_hash: Mapped[int | None] = mapped_column(BIG)
    file_unique: Mapped[str | None] = mapped_column(String(96))

    file_name: Mapped[str | None] = mapped_column(String(512))
    ext: Mapped[str | None] = mapped_column(String(16))
    mime_type: Mapped[str | None] = mapped_column(String(128))
    size: Mapped[int | None] = mapped_column(BIG)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer)

    rel_path: Mapped[str | None] = mapped_column(String(768))
    abs_path: Mapped[str | None] = mapped_column(String(1024))
    sha256: Mapped[str | None] = mapped_column(String(64))

    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downloaded_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)

    message: Mapped[Message] = relationship(back_populates="files")


class ExportJob(Base):
    """A single export run over one chat."""

    __tablename__ = "export_jobs"
    __table_args__ = (
        Index("ix_jobs_account_status", "account_id", "status"),
        Index("ix_jobs_chat", "chat_id"),
        Index("ix_jobs_status", "status"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )

    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    phase: Mapped[str] = mapped_column(String(16), default="init", nullable=False)
    options: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_dir: Mapped[str | None] = mapped_column(String(1024))

    total_messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed_messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downloaded_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bytes_total: Mapped[int] = mapped_column(BIG, default=0, nullable=False)
    bytes_downloaded: Mapped[int] = mapped_column(BIG, default=0, nullable=False)

    min_id: Mapped[int | None] = mapped_column(BIG)
    max_id: Mapped[int | None] = mapped_column(BIG)
    last_processed_id: Mapped[int | None] = mapped_column(BIG)

    speed_bps: Mapped[int] = mapped_column(BIG, default=0, nullable=False)
    eta_seconds: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)


class JobEvent(Base):
    """Human-readable timeline of a job (shown in the UI under each job)."""

    __tablename__ = "job_events"
    __table_args__ = (
        Index("ix_job_events_job", "job_id", "id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        BIG, ForeignKey("export_jobs.id", ondelete="CASCADE"), nullable=False
    )
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)
    level: Mapped[str] = mapped_column(String(8), default="info", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON)


class AppLog(Base):
    """Application log mirrored into the database for the UI log viewer."""

    __tablename__ = "app_logs"
    __table_args__ = (
        Index("ix_app_logs_ts", "ts"),
        Index("ix_app_logs_level", "level"),
        Index("ix_app_logs_account", "account_id"),
        Index("ix_app_logs_job", "job_id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    id: Mapped[int] = mapped_column(PK, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(TS, default=utcnow, nullable=False)
    level: Mapped[str] = mapped_column(String(8), default="INFO", nullable=False)
    logger: Mapped[str] = mapped_column(String(64), default="app", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    account_id: Mapped[int | None] = mapped_column(BIG)
    job_id: Mapped[int | None] = mapped_column(BIG)
    data: Mapped[dict | None] = mapped_column(JSON)


class Setting(Base):
    """Small key/value store for UI preferences and schema bookkeeping."""

    __tablename__ = "settings"
    __table_args__ = (
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    skey: Mapped[str] = mapped_column(String(64), primary_key=True)
    svalue: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, nullable=False)
