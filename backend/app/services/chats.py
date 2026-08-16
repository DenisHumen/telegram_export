"""Chat listing, statistics and the message browser — all served from MySQL."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chat, MediaFile, Message

log = logging.getLogger("tgvault.chats")

CHAT_SORTS = {
    "last_message": Chat.last_message_date,
    "title": Chat.title,
    "messages": Chat.messages_cached,
    "participants": Chat.participants_count,
    "created": Chat.id,
}

MESSAGE_SORTS = {
    "date": Message.date,
    "views": Message.views,
    "type": Message.media_type,
    "id": Message.tg_message_id,
}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds") + "Z" if value else None


def serialize_chat(chat: Chat) -> dict[str, Any]:
    return {
        "id": chat.id,
        "account_id": chat.account_id,
        "tg_chat_id": chat.tg_chat_id,
        "kind": chat.kind,
        "title": chat.title,
        "username": chat.username,
        "about": chat.about,
        "participants_count": chat.participants_count,
        "is_broadcast": bool(chat.is_broadcast),
        "is_megagroup": bool(chat.is_megagroup),
        "is_verified": bool(chat.is_verified),
        "is_scam": bool(chat.is_scam),
        "is_creator": bool(chat.is_creator),
        "is_archived": bool(chat.is_archived),
        "is_pinned": bool(chat.is_pinned),
        "photo_path": chat.photo_path,
        "last_message_id": chat.last_message_id,
        "last_message_date": _iso(chat.last_message_date),
        "unread_count": chat.unread_count,
        "messages_cached": chat.messages_cached,
        "media_cached": chat.media_cached,
        "bytes_cached": chat.bytes_cached,
        "last_synced_at": _iso(chat.last_synced_at),
    }


async def _paginate(
    session: AsyncSession, query: Select, page: int, page_size: int
) -> tuple[list[Any], int, int]:
    page = max(1, page)
    page_size = max(1, min(500, page_size))
    total = int(
        await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    )
    rows = (
        await session.execute(query.offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    pages = (total + page_size - 1) // page_size if page_size else 1
    return rows, total, pages


async def list_chats(
    session: AsyncSession,
    account_id: int,
    *,
    search: str | None = None,
    kind: str = "all",
    sort: str = "last_message",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
    only_cached: bool = False,
) -> dict[str, Any]:
    query = select(Chat).where(Chat.account_id == account_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(Chat.title.like(pattern), Chat.username.like(pattern)))
    if kind and kind != "all":
        query = query.where(Chat.kind == kind)
    if only_cached:
        query = query.where(Chat.messages_cached > 0)

    column = CHAT_SORTS.get(sort, Chat.last_message_date)
    # Chats that were never synced have NULL counters/dates and belong at the
    # bottom in both directions. MySQL has no NULLS LAST clause (SQLAlchemy's
    # .nullslast() renders one and MySQL rejects it with a syntax error), so
    # the standard portable trick is an extra leading key: `col IS NULL`
    # evaluates to 0 for real values and 1 for NULLs.
    query = query.order_by(
        column.is_(None).asc(),
        column.desc() if order == "desc" else column.asc(),
        Chat.id.desc(),
    )

    rows, total, pages = await _paginate(session, query, page, page_size)
    return {
        "items": [serialize_chat(row) for row in rows],
        "total": total,
        "page": max(1, page),
        "page_size": page_size,
        "pages": pages,
    }


async def chat_stats(session: AsyncSession, chat: Chat) -> dict[str, Any]:
    messages = int(
        await session.scalar(select(func.count(Message.id)).where(Message.chat_id == chat.id)) or 0
    )
    files = int(
        await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    total_bytes = int(
        await session.scalar(
            select(func.coalesce(func.sum(MediaFile.size), 0)).where(
                MediaFile.chat_id == chat.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    first_date = await session.scalar(
        select(func.min(Message.date)).where(Message.chat_id == chat.id)
    )
    last_date = await session.scalar(
        select(func.max(Message.date)).where(Message.chat_id == chat.id)
    )

    by_type_rows = await session.execute(
        select(Message.media_type, func.count(Message.id))
        .where(Message.chat_id == chat.id)
        .group_by(Message.media_type)
    )
    by_month_rows = await session.execute(
        select(
            func.date_format(Message.date, "%Y-%m").label("month"), func.count(Message.id)
        )
        .where(Message.chat_id == chat.id)
        .group_by("month")
        .order_by("month")
    )
    top_sender_rows = await session.execute(
        select(
            Message.sender_id,
            func.coalesce(func.max(Message.sender_name), ""),
            func.count(Message.id).label("cnt"),
        )
        .where(Message.chat_id == chat.id, Message.sender_id.is_not(None))
        .group_by(Message.sender_id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )

    from app.services.jobs import active_job_id

    return {
        "chat_id": chat.id,
        "messages": messages,
        "media_files": files,
        "bytes": total_bytes,
        "first_message_date": _iso(first_date),
        "last_message_date": _iso(last_date),
        "by_media_type": {kind: count for kind, count in by_type_rows.all()},
        "by_month": [{"month": month, "count": count} for month, count in by_month_rows.all()],
        "top_senders": [
            {"sender_id": sender_id, "name": name or str(sender_id), "count": count}
            for sender_id, name, count in top_sender_rows.all()
        ],
        "active_job_id": await active_job_id(session, chat.id),
    }


async def list_messages(
    session: AsyncSession,
    chat_id: int,
    *,
    search: str | None = None,
    media_type: str | None = None,
    sender_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "date",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    query = select(Message).where(Message.chat_id == chat_id)
    if search:
        query = query.where(Message.text.like(f"%{search.strip()}%"))
    if media_type and media_type != "all":
        if media_type == "any":
            query = query.where(Message.has_media.is_(True))
        else:
            query = query.where(Message.media_type == media_type)
    if sender_id:
        query = query.where(Message.sender_id == sender_id)
    if date_from:
        query = query.where(Message.date >= date_from)
    if date_to:
        query = query.where(Message.date <= date_to)

    if sort == "size":
        # Sort by the largest attachment; text-only messages sort as 0 rather
        # than dropping out, so the listing stays complete.
        size_expr = (
            select(func.coalesce(func.max(MediaFile.size), 0))
            .where(MediaFile.message_id == Message.id)
            .correlate(Message)
            .scalar_subquery()
        )
        query = query.order_by(
            size_expr.desc() if order == "desc" else size_expr.asc(), Message.id.desc()
        )
    elif sort == "sender":
        query = query.order_by(
            Message.sender_name.desc() if order == "desc" else Message.sender_name.asc(),
            Message.id.desc(),
        )
    else:
        column = MESSAGE_SORTS.get(sort, Message.date)
        query = query.order_by(
            column.desc() if order == "desc" else column.asc(), Message.id.desc()
        )

    rows, total, pages = await _paginate(session, query, page, page_size)

    files_by_message: dict[int, list[dict[str, Any]]] = {}
    if rows:
        media_rows = (
            await session.execute(
                select(MediaFile).where(MediaFile.message_id.in_([r.id for r in rows]))
            )
        ).scalars().all()
        for media in media_rows:
            files_by_message.setdefault(media.message_id, []).append(
                {
                    "id": media.id,
                    "kind": media.kind,
                    "file_name": media.file_name,
                    "size": media.size,
                    "status": media.status,
                    "rel_path": media.rel_path,
                }
            )

    return {
        "items": [
            {
                "id": row.id,
                "tg_message_id": row.tg_message_id,
                "date": _iso(row.date),
                "sender_id": row.sender_id,
                "sender_name": row.sender_name,
                "text": row.text,
                "media_type": row.media_type,
                "has_media": bool(row.has_media),
                "grouped_id": row.grouped_id,
                "views": row.views,
                "reply_to_msg_id": row.reply_to_msg_id,
                "is_service": bool(row.is_service),
                "files": files_by_message.get(row.id, []),
            }
            for row in rows
        ],
        "total": total,
        "page": max(1, page),
        "page_size": page_size,
        "pages": pages,
    }


async def refresh_counters(session: AsyncSession, chat: Chat) -> Chat:
    """Recompute the cached counters shown in the chat list."""
    chat.messages_cached = int(
        await session.scalar(select(func.count(Message.id)).where(Message.chat_id == chat.id)) or 0
    )
    chat.media_cached = int(
        await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.chat_id == chat.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    chat.bytes_cached = int(
        await session.scalar(
            select(func.coalesce(func.sum(MediaFile.size), 0)).where(
                MediaFile.chat_id == chat.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    await session.flush()
    return chat
