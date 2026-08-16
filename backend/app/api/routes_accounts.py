"""``/api/accounts`` — CRUD plus connect/logout/sync."""

from __future__ import annotations

import logging

from fastapi import APIRouter

from app.api.deps import ApiError, CommitRoute, CurrentAccount, DbSession
from app.api.schemas import AccountCreate, AccountUpdate, SyncRequest
from app.bus import bus
from app.services import accounts as accounts_service
from app.services import chats as chats_service
from app.tg import auth as auth_service
from app.tg import dialogs as dialogs_service
from app.tg.manager import manager

log = logging.getLogger("tgvault.api.accounts")

router = APIRouter(prefix="/api", tags=["accounts"], route_class=CommitRoute)


@router.get("/accounts")
async def list_accounts(session: DbSession):
    return await accounts_service.list_accounts(session)


@router.post("/accounts", status_code=201)
async def create_account(payload: AccountCreate, session: DbSession):
    try:
        account = await accounts_service.create_account(
            session,
            label=payload.label,
            api_id=payload.api_id,
            api_hash=payload.api_hash,
            proxy=payload.proxy,
        )
    except ValueError as exc:
        raise ApiError(400, str(exc), "API_CREDENTIALS_REQUIRED") from exc
    data = await accounts_service.serialize(session, account)
    await bus.publish("account", data)
    return data


@router.get("/accounts/{account_id}")
async def get_account(account: CurrentAccount, session: DbSession):
    return await accounts_service.serialize(session, account)


@router.patch("/accounts/{account_id}")
async def update_account(payload: AccountUpdate, account: CurrentAccount, session: DbSession):
    if payload.label is not None:
        account.label = payload.label.strip() or account.label
    if payload.proxy is not None:
        account.proxy = payload.proxy.strip() or None
        # The proxy is baked into the client at construction time.
        await manager.disconnect(account.id)
    await session.flush()
    data = await accounts_service.serialize(session, account)
    await bus.publish("account", data)
    return data


@router.delete("/accounts/{account_id}")
async def delete_account(account: CurrentAccount, session: DbSession):
    account_id = account.id
    await accounts_service.delete_account(session, account)
    await bus.publish("account", {"id": account_id, "deleted": True})
    return {"ok": True}


@router.post("/accounts/{account_id}/connect")
async def connect_account(account: CurrentAccount, session: DbSession):
    """Bring the client online from the stored session."""
    if not account.session_enc:
        raise ApiError(400, "Для этого аккаунта ещё нет сохранённой сессии.", "NO_SESSION")
    handle = await manager.get_or_create(account)
    if await handle.client.is_user_authorized():
        await auth_service.finalize_login(session, account, handle)
    else:
        account.status = "unauthorized"
        account.last_error = "Сессия недействительна — требуется повторный вход."
        await session.flush()
    data = await accounts_service.serialize(session, account)
    await bus.publish("account", data)
    return data


@router.post("/accounts/{account_id}/logout")
async def logout_account(account: CurrentAccount, session: DbSession):
    await auth_service.logout(session, account)
    data = await accounts_service.serialize(session, account)
    await bus.publish("account", data)
    return data


@router.get("/accounts/{account_id}/stats")
async def account_stats(account: CurrentAccount, session: DbSession):
    return await accounts_service.stats(session, account)


@router.post("/accounts/{account_id}/chats/sync")
async def sync_chats(payload: SyncRequest, account: CurrentAccount, session: DbSession):
    if account.status != "authorized":
        raise ApiError(400, "Аккаунт не авторизован.", "NOT_AUTHORIZED")
    try:
        result = await dialogs_service.sync_dialogs(
            session,
            account,
            archived=payload.archived,
            limit=payload.limit,
            with_avatars=payload.with_avatars,
        )
    except PermissionError as exc:
        raise ApiError(401, str(exc), "NOT_AUTHORIZED") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Chat sync failed for account #%s", account.id)
        raise ApiError(502, f"Не удалось синхронизировать чаты: {exc}", "SYNC_FAILED") from exc
    return result


@router.get("/accounts/{account_id}/chats")
async def list_chats(
    account: CurrentAccount,
    session: DbSession,
    search: str | None = None,
    kind: str = "all",
    sort: str = "last_message",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
    only_cached: bool = False,
):
    return await chats_service.list_chats(
        session,
        account.id,
        search=search,
        kind=kind,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
        only_cached=only_cached,
    )
