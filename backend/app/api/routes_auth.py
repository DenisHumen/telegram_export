"""``/api/auth`` — phone code, 2FA cloud password and QR sign-in."""

from __future__ import annotations

import logging

from fastapi import APIRouter

from app.api.deps import ApiError, CommitRoute, CurrentAccount, DbSession
from app.api.schemas import CodeRequest, PasswordRequest, PhoneRequest
from app.tg import auth as auth_service
from app.tg.auth import AuthError

log = logging.getLogger("tgvault.api.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"], route_class=CommitRoute)


def _fail(exc: AuthError) -> ApiError:
    status = 429 if exc.code == "FLOOD_WAIT" else 400
    error = ApiError(status, exc.message, exc.code)
    if exc.retry_after:
        error.detail["retry_after"] = exc.retry_after  # type: ignore[index]
    return error


@router.get("/{account_id}/state")
async def get_state(account: CurrentAccount, session: DbSession):
    state = await auth_service.current_state(session, account)
    return state.to_dict()


@router.post("/{account_id}/phone/send-code")
async def send_code(payload: PhoneRequest, account: CurrentAccount, session: DbSession):
    try:
        state = await auth_service.send_code(session, account, payload.phone)
    except AuthError as exc:
        raise _fail(exc) from exc
    return state.to_dict()


@router.post("/{account_id}/phone/sign-in")
async def sign_in(payload: CodeRequest, account: CurrentAccount, session: DbSession):
    try:
        state = await auth_service.sign_in_code(session, account, payload.code)
    except AuthError as exc:
        raise _fail(exc) from exc
    return state.to_dict()


@router.post("/{account_id}/password")
async def submit_password(payload: PasswordRequest, account: CurrentAccount, session: DbSession):
    try:
        state = await auth_service.sign_in_password(session, account, payload.password)
    except AuthError as exc:
        raise _fail(exc) from exc
    return state.to_dict()


@router.post("/{account_id}/qr/start")
async def qr_start(account: CurrentAccount, session: DbSession):
    try:
        state = await auth_service.qr_start(session, account)
    except AuthError as exc:
        raise _fail(exc) from exc
    return state.to_dict()


@router.post("/{account_id}/qr/refresh")
async def qr_refresh(account: CurrentAccount, session: DbSession):
    try:
        state = await auth_service.qr_refresh(session, account)
    except AuthError as exc:
        raise _fail(exc) from exc
    return state.to_dict()


@router.get("/{account_id}/qr/status")
async def qr_status(account: CurrentAccount, session: DbSession):
    state = await auth_service.qr_status(session, account)
    return state.to_dict()


@router.post("/{account_id}/cancel")
async def cancel(account: CurrentAccount, session: DbSession):
    state = await auth_service.cancel(session, account)
    return state.to_dict()
