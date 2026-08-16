"""``/api/chats`` — chat details, statistics and the archived message browser."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter

from app.api.deps import CommitRoute, CurrentChat, DbSession
from app.db.models import Account
from app.services import chats as chats_service
from app.tg import dialogs as dialogs_service

log = logging.getLogger("tgvault.api.chats")

router = APIRouter(prefix="/api/chats", tags=["chats"], route_class=CommitRoute)


@router.get("/{chat_id}")
async def get_chat(chat: CurrentChat, session: DbSession, enrich: bool = False):
    """Chat card. ``enrich=true`` also pulls the description/member count."""
    if enrich:
        account = await session.get(Account, chat.account_id)
        if account is not None and account.status == "authorized":
            await dialogs_service.enrich_chat(session, account, chat)
    await chats_service.refresh_counters(session, chat)
    return chats_service.serialize_chat(chat)


@router.get("/{chat_id}/stats")
async def get_stats(chat: CurrentChat, session: DbSession):
    return await chats_service.chat_stats(session, chat)


@router.get("/{chat_id}/messages")
async def list_messages(
    chat: CurrentChat,
    session: DbSession,
    search: str | None = None,
    media_type: str | None = None,
    sender_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "date",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
):
    return await chats_service.list_messages(
        session,
        chat.id,
        search=search,
        media_type=media_type,
        sender_id=sender_id,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
