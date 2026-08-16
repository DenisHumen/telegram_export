"""Account CRUD and serialisation."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import Account, Chat, ExportJob, MediaFile, Message
from app.tg.manager import manager

log = logging.getLogger("tgvault.accounts")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds") + "Z" if value else None


async def serialize(session: AsyncSession, account: Account) -> dict[str, Any]:
    chats_count = int(
        await session.scalar(
            select(func.count(Chat.id)).where(Chat.account_id == account.id)
        )
        or 0
    )
    return {
        "id": account.id,
        "label": account.label,
        "phone": account.phone,
        "tg_user_id": account.tg_user_id,
        "username": account.username,
        "first_name": account.first_name,
        "last_name": account.last_name,
        "is_premium": bool(account.is_premium),
        "api_id": account.api_id,
        "status": account.status,
        "last_error": account.last_error,
        "proxy": account.proxy,
        "connected": manager.is_connected(account.id),
        "chats_count": chats_count,
        "created_at": _iso(account.created_at),
        "last_seen_at": _iso(account.last_seen_at),
    }


async def list_accounts(session: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await session.execute(select(Account).order_by(Account.id.asc()))
    ).scalars().all()
    return [await serialize(session, row) for row in rows]


async def create_account(
    session: AsyncSession,
    *,
    label: str,
    api_id: int | None,
    api_hash: str | None,
    proxy: str | None = None,
) -> Account:
    """Create an account shell; the Telegram login happens separately.

    ``api_id``/``api_hash`` fall back to the ``.env`` defaults so a user with a
    single application can add several accounts without retyping them.
    """
    resolved_id = api_id or (int(settings.default_api_id) if settings.default_api_id else None)
    resolved_hash = api_hash or settings.default_api_hash or None
    if not resolved_id or not resolved_hash:
        raise ValueError(
            "Нужны api_id и api_hash — получите их на my.telegram.org "
            "или задайте TGV_DEFAULT_API_ID / TGV_DEFAULT_API_HASH в .env"
        )
    account = Account(
        label=label.strip() or "Новый аккаунт",
        api_id=int(resolved_id),
        api_hash=str(resolved_hash).strip(),
        proxy=(proxy or None),
        status="new",
    )
    session.add(account)
    await session.flush()
    log.info("Account #%s created (%s)", account.id, account.label, extra={"account_id": account.id})
    return account


async def delete_account(session: AsyncSession, account: Account) -> None:
    account_id = account.id
    await manager.disconnect(account_id)
    await session.delete(account)
    await session.flush()
    log.info("Account #%s deleted with its whole archive", account_id)


async def stats(session: AsyncSession, account: Account) -> dict[str, Any]:
    chats = int(
        await session.scalar(select(func.count(Chat.id)).where(Chat.account_id == account.id)) or 0
    )
    messages = int(
        await session.scalar(
            select(func.count(Message.id)).where(Message.account_id == account.id)
        )
        or 0
    )
    files = int(
        await session.scalar(
            select(func.count(MediaFile.id)).where(
                MediaFile.account_id == account.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    total_bytes = int(
        await session.scalar(
            select(func.coalesce(func.sum(MediaFile.size), 0)).where(
                MediaFile.account_id == account.id, MediaFile.status == "done"
            )
        )
        or 0
    )
    jobs = int(
        await session.scalar(
            select(func.count(ExportJob.id)).where(ExportJob.account_id == account.id)
        )
        or 0
    )
    by_kind_rows = await session.execute(
        select(Chat.kind, func.count(Chat.id))
        .where(Chat.account_id == account.id)
        .group_by(Chat.kind)
    )
    return {
        "account_id": account.id,
        "chats": chats,
        "messages": messages,
        "media_files": files,
        "bytes": total_bytes,
        "jobs": jobs,
        "by_kind": {kind: count for kind, count in by_kind_rows.all()},
    }


async def global_stats(session: AsyncSession) -> dict[str, Any]:
    """Dashboard totals across every account."""
    return {
        "accounts": int(await session.scalar(select(func.count(Account.id))) or 0),
        "authorized_accounts": int(
            await session.scalar(
                select(func.count(Account.id)).where(Account.status == "authorized")
            )
            or 0
        ),
        "chats": int(await session.scalar(select(func.count(Chat.id))) or 0),
        "messages": int(await session.scalar(select(func.count(Message.id))) or 0),
        "media_files": int(
            await session.scalar(
                select(func.count(MediaFile.id)).where(MediaFile.status == "done")
            )
            or 0
        ),
        "bytes": int(
            await session.scalar(
                select(func.coalesce(func.sum(MediaFile.size), 0)).where(
                    MediaFile.status == "done"
                )
            )
            or 0
        ),
        "jobs": int(await session.scalar(select(func.count(ExportJob.id))) or 0),
        "running_jobs": int(
            await session.scalar(
                select(func.count(ExportJob.id)).where(
                    ExportJob.status.in_(("queued", "running", "paused"))
                )
            )
            or 0
        ),
    }
