"""Sync the account's dialog list (channels, groups, chats) into MySQL."""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import functions
from telethon.tl import types

from app.bus import bus
from app.config import settings
from app.db.base import utcnow
from app.db.models import Account, Chat
from app.db.session import session_scope
from app.tg.extract import naive_utc, slugify
from app.tg.manager import manager

log = logging.getLogger("tgvault.dialogs")


def classify(entity: Any) -> str:
    """Map a Telegram entity onto one of ``CHAT_KINDS``."""
    if isinstance(entity, types.User):
        return "bot" if getattr(entity, "bot", False) else "user"
    if isinstance(entity, (types.Chat, types.ChatForbidden)):
        return "group"
    if isinstance(entity, (types.Channel, types.ChannelForbidden)):
        return "supergroup" if getattr(entity, "megagroup", False) else "channel"
    return "channel"


def _entity_title(entity: Any) -> str:
    title = getattr(entity, "title", None)
    if title:
        return str(title)[:512]
    first = getattr(entity, "first_name", None)
    last = getattr(entity, "last_name", None)
    name = " ".join(p for p in (first, last) if p)
    if name:
        return name[:512]
    username = getattr(entity, "username", None)
    return str(username or f"id{getattr(entity, 'id', '?')}")[:512]


async def sync_dialogs(
    session: AsyncSession,
    account: Account,
    *,
    archived: bool | None = None,
    limit: int | None = None,
    with_avatars: bool = True,
) -> dict[str, int]:
    """Pull every dialog and upsert it.

    ``archived=None`` covers both the main list and the archive folder, which
    is what users expect from "sync everything".
    """
    handle = await manager.get_or_create(account)
    if not await handle.client.is_user_authorized():
        raise PermissionError("Аккаунт не авторизован — войдите заново.")

    existing_rows = (
        await session.execute(select(Chat).where(Chat.account_id == account.id))
    ).scalars().all()
    existing: dict[int, Chat] = {row.tg_chat_id: row for row in existing_rows}

    created = updated = seen = 0
    await bus.publish("chat_sync", {"account_id": account.id, "synced": 0, "done": False})

    async for dialog in handle.client.iter_dialogs(limit=limit, archived=archived):
        entity = dialog.entity
        if entity is None:
            continue
        try:
            tg_chat_id = int(dialog.id)
        except (TypeError, ValueError):
            continue

        kind = classify(entity)
        chat = existing.get(tg_chat_id)
        if chat is None:
            chat = Chat(account_id=account.id, tg_chat_id=tg_chat_id)
            session.add(chat)
            existing[tg_chat_id] = chat
            created += 1
        else:
            updated += 1

        chat.kind = kind
        chat.access_hash = getattr(entity, "access_hash", None)
        chat.title = _entity_title(entity)
        chat.username = (getattr(entity, "username", None) or None)
        chat.participants_count = getattr(entity, "participants_count", None)
        chat.is_broadcast = kind == "channel"
        chat.is_megagroup = bool(getattr(entity, "megagroup", False))
        chat.is_verified = bool(getattr(entity, "verified", False))
        chat.is_scam = bool(getattr(entity, "scam", False))
        chat.is_creator = bool(getattr(entity, "creator", False))
        chat.is_archived = bool(getattr(dialog, "archived", False))
        chat.is_pinned = bool(getattr(dialog, "pinned", False))
        chat.unread_count = int(getattr(dialog, "unread_count", 0) or 0)
        chat.last_message_id = getattr(dialog.message, "id", None) if dialog.message else None
        chat.last_message_date = naive_utc(getattr(dialog, "date", None))
        chat.last_synced_at = utcnow()
        chat.raw = {
            "folder_id": getattr(dialog, "folder_id", None),
            "restricted": bool(getattr(entity, "restricted", False)),
            "has_link": bool(getattr(entity, "has_link", False)),
            "noforwards": bool(getattr(entity, "noforwards", False)),
        }

        seen += 1
        if seen % 25 == 0:
            await session.flush()
            await bus.publish(
                "chat_sync", {"account_id": account.id, "synced": seen, "done": False}
            )

    account.last_seen_at = utcnow()
    await session.flush()
    log.info(
        "Synced %s dialogs for account #%s (new: %s, updated: %s)",
        seen,
        account.id,
        created,
        updated,
        extra={"account_id": account.id},
    )
    await bus.publish("chat_sync", {"account_id": account.id, "synced": seen, "done": True})

    if with_avatars:
        asyncio.create_task(
            _download_avatars(account.id), name=f"avatars-{account.id}"
        )

    return {"synced": seen, "created": created, "updated": updated}


async def _download_avatars(account_id: int, concurrency: int = 5) -> None:
    """Fetch missing chat avatars in the background.

    Runs after the dialog sync has been committed so the UI is usable
    immediately; failures here are cosmetic and never surface as errors.
    """
    handle = manager.get(account_id)
    if handle is None or not handle.client.is_connected():
        return
    settings.avatars_path.mkdir(parents=True, exist_ok=True)

    async with session_scope() as session:
        chats = (
            await session.execute(
                select(Chat).where(Chat.account_id == account_id, Chat.photo_path.is_(None))
            )
        ).scalars().all()
        targets = [(c.id, c.tg_chat_id, c.title) for c in chats]

    if not targets:
        return

    semaphore = asyncio.Semaphore(concurrency)
    results: dict[int, str] = {}

    async def fetch(chat_pk: int, tg_chat_id: int, title: str) -> None:
        async with semaphore:
            try:
                entity = await handle.client.get_entity(tg_chat_id)
                target = settings.avatars_path / f"{account_id}_{tg_chat_id}.jpg"
                path = await handle.client.download_profile_photo(entity, file=str(target))
                if path:
                    results[chat_pk] = f"avatars/{target.name}"
            except Exception as exc:  # noqa: BLE001 - avatars are best-effort
                log.debug("No avatar for %s (%s): %s", title, tg_chat_id, exc)

    await asyncio.gather(*(fetch(*t) for t in targets), return_exceptions=True)

    if results:
        async with session_scope() as session:
            for chat_pk, rel in results.items():
                chat = await session.get(Chat, chat_pk)
                if chat is not None:
                    chat.photo_path = rel
        log.info("Downloaded %s chat avatars", len(results), extra={"account_id": account_id})
        await bus.publish(
            "chat_sync", {"account_id": account_id, "synced": len(results), "done": True}
        )


async def enrich_chat(session: AsyncSession, account: Account, chat: Chat) -> Chat:
    """Fetch the description and exact member count for one chat.

    Kept out of the bulk sync on purpose: ``GetFullChannel`` is one round-trip
    per chat, which would make syncing hundreds of dialogs painfully slow.
    """
    handle = await manager.get_or_create(account)
    if not await handle.client.is_user_authorized():
        return chat
    try:
        entity = await handle.client.get_entity(chat.tg_chat_id)
        if isinstance(entity, types.Channel):
            full = await handle.client(functions.channels.GetFullChannelRequest(channel=entity))
            chat.about = getattr(full.full_chat, "about", None)
            chat.participants_count = getattr(full.full_chat, "participants_count", None)
        elif isinstance(entity, types.Chat):
            full = await handle.client(functions.messages.GetFullChatRequest(chat_id=entity.id))
            chat.about = getattr(full.full_chat, "about", None)
            participants = getattr(full.full_chat, "participants", None)
            members = getattr(participants, "participants", None)
            chat.participants_count = len(members) if members else chat.participants_count
        elif isinstance(entity, types.User):
            full = await handle.client(functions.users.GetFullUserRequest(id=entity))
            chat.about = getattr(full.full_user, "about", None)
        chat.last_synced_at = utcnow()
        await session.flush()
    except Exception as exc:  # noqa: BLE001
        log.debug("enrich_chat failed for chat #%s: %s", chat.id, exc)
    return chat


async def resolve_entity(account_id: int, tg_chat_id: int):
    """Resolve a chat id to a Telegram entity using the account's client."""
    handle = manager.get(account_id)
    if handle is None:
        raise RuntimeError("Клиент Telegram не подключён.")
    with suppress(Exception):
        return await handle.client.get_input_entity(tg_chat_id)
    return await handle.client.get_entity(tg_chat_id)


def chat_slug(chat: Chat) -> str:
    return slugify(chat.username or chat.title or f"chat{chat.tg_chat_id}")
