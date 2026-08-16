"""Login flows: phone + code, cloud password (2FA), and QR sign-in.

Three things this module gets right on purpose:

1. **2FA is a state, not an error.** Both the code flow and the QR flow can end
   in ``password_required``; the UI handles them identically.
2. **QR waiting is off the request path.** ``QRLogin.wait()`` blocks until the
   phone scans the code, so it runs in a background task and the HTTP endpoint
   just reports the current state.
3. **The session is persisted the moment login succeeds**, so a backend restart
   never costs the user another login.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from telethon import functions
from telethon.errors import (
    ApiIdInvalidError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    PhoneNumberUnoccupiedError,
    RPCError,
    SessionPasswordNeededError,
)

from app.bus import bus
from app.db.base import utcnow
from app.db.models import Account
from app.db.session import session_scope
from app.tg.manager import (
    AUTHORIZED,
    CODE_SENT,
    IDLE,
    PASSWORD_REQUIRED,
    QR_EXPIRED,
    QR_WAITING,
    AuthState,
    ClientHandle,
    manager,
)

log = logging.getLogger("tgvault.auth")

_CODE_TYPE_NAMES = {
    "SentCodeTypeApp": "app",
    "SentCodeTypeSms": "sms",
    "SentCodeTypeCall": "call",
    "SentCodeTypeFlashCall": "flash_call",
    "SentCodeTypeMissedCall": "missed_call",
    "SentCodeTypeEmailCode": "email",
    "SentCodeTypeFragmentSms": "fragment",
    "SentCodeTypeFirebaseSms": "firebase",
    "SentCodeTypeSetUpEmailRequired": "email_setup_required",
}


class AuthError(Exception):
    """Login failure carrying a machine-readable code for the UI."""

    def __init__(self, code: str, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after = retry_after


async def _publish(state: AuthState) -> None:
    await bus.publish("auth_state", state.to_dict())


async def _password_hint(handle: ClientHandle) -> str | None:
    try:
        password = await handle.client(functions.account.GetPasswordRequest())
        return getattr(password, "hint", None) or None
    except Exception as exc:  # noqa: BLE001 - a missing hint is not fatal
        log.debug("Could not fetch password hint: %s", exc)
        return None


def _translate(exc: Exception) -> AuthError:
    """Map a Telethon exception onto an ``AuthError`` the UI can act on."""
    if isinstance(exc, FloodWaitError):
        return AuthError(
            "FLOOD_WAIT",
            f"Telegram временно ограничил попытки. Повторите через {exc.seconds} с.",
            retry_after=int(exc.seconds),
        )
    if isinstance(exc, PhoneCodeInvalidError):
        return AuthError("PHONE_CODE_INVALID", "Неверный код подтверждения.")
    if isinstance(exc, PhoneCodeExpiredError):
        return AuthError("PHONE_CODE_EXPIRED", "Код истёк — запросите новый.")
    if isinstance(exc, PasswordHashInvalidError):
        return AuthError("PASSWORD_INVALID", "Неверный облачный пароль (2FA).")
    if isinstance(exc, PhoneNumberInvalidError):
        return AuthError("PHONE_NUMBER_INVALID", "Неверный номер телефона.")
    if isinstance(exc, PhoneNumberBannedError):
        return AuthError("PHONE_NUMBER_BANNED", "Этот номер заблокирован в Telegram.")
    if isinstance(exc, PhoneNumberUnoccupiedError):
        return AuthError(
            "PHONE_NUMBER_UNOCCUPIED", "На этом номере нет аккаунта Telegram."
        )
    if isinstance(exc, ApiIdInvalidError):
        return AuthError("API_ID_INVALID", "Неверная пара api_id / api_hash.")
    if isinstance(exc, AuthKeyUnregisteredError):
        return AuthError("AUTH_KEY_UNREGISTERED", "Сессия отозвана — войдите заново.")
    if isinstance(exc, RPCError):
        return AuthError("RPC_ERROR", str(exc))
    return AuthError("UNKNOWN", str(exc) or exc.__class__.__name__)


# --------------------------------------------------------------------------
# finalisation
# --------------------------------------------------------------------------


async def finalize_login(session: AsyncSession, account: Account, handle: ClientHandle) -> AuthState:
    """Persist the session + profile after a successful sign-in."""
    handle.auth.status = AUTHORIZED
    handle.auth.error = None
    handle.auth.error_code = None
    handle.auth.qr_url = None
    handle.auth.qr_expires_at = None

    encoded = manager.dump_session(handle)
    if encoded:
        account.session_enc = encoded

    profile = await manager.snapshot_user(handle)
    if profile:
        account.tg_user_id = profile["id"]
        account.username = profile["username"]
        account.first_name = profile["first_name"]
        account.last_name = profile["last_name"]
        account.is_premium = profile["is_premium"]
        if profile["phone"]:
            account.phone = "+" + profile["phone"].lstrip("+")
        handle.auth.user = profile
        if not account.label:
            account.label = (
                profile["username"]
                or " ".join(p for p in (profile["first_name"], profile["last_name"]) if p)
                or account.phone
                or f"account #{account.id}"
            )

    with suppress(Exception):
        account.dc_id = handle.client.session.dc_id

    account.status = "authorized"
    account.last_error = None
    account.last_seen_at = utcnow()
    await session.flush()

    log.info(
        "Account #%s authorized as %s",
        account.id,
        account.username or account.phone or account.tg_user_id,
        extra={"account_id": account.id},
    )
    await _publish(handle.auth)
    return handle.auth


# --------------------------------------------------------------------------
# phone + code
# --------------------------------------------------------------------------


async def send_code(session: AsyncSession, account: Account, phone: str) -> AuthState:
    handle = await manager.get_or_create(account)
    phone = phone.strip()
    if not phone.startswith("+"):
        phone = "+" + phone.lstrip("+")

    async with handle.lock:
        await handle.cancel_qr()
        if await handle.client.is_user_authorized():
            return await finalize_login(session, account, handle)
        try:
            sent = await handle.client.send_code_request(phone)
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc)
            handle.auth.fail(err.code, err.message, err.retry_after)
            account.status = "error"
            account.last_error = err.message
            await session.flush()
            await _publish(handle.auth)
            raise err from exc

        handle.phone_code_hash = sent.phone_code_hash
        handle.auth.reset()
        handle.auth.status = CODE_SENT
        handle.auth.phone = phone
        handle.auth.code_type = _CODE_TYPE_NAMES.get(
            type(sent.type).__name__, type(sent.type).__name__
        )
        account.phone = phone
        account.status = "pending_code"
        await session.flush()
        log.info(
            "Confirmation code sent to %s (type=%s)",
            phone,
            handle.auth.code_type,
            extra={"account_id": account.id},
        )
        await _publish(handle.auth)
        return handle.auth


async def sign_in_code(session: AsyncSession, account: Account, code: str) -> AuthState:
    handle = await manager.get_or_create(account)
    code = code.strip().replace(" ", "").replace("-", "")

    async with handle.lock:
        if not handle.auth.phone:
            handle.auth.phone = account.phone
        if not handle.auth.phone:
            raise AuthError("NO_PHONE", "Сначала запросите код на номер телефона.")
        try:
            await handle.client.sign_in(
                phone=handle.auth.phone,
                code=code,
                phone_code_hash=handle.phone_code_hash,
            )
        except SessionPasswordNeededError:
            handle.auth.status = PASSWORD_REQUIRED
            handle.auth.password_hint = await _password_hint(handle)
            account.status = "pending_password"
            await session.flush()
            log.info("Account #%s requires 2FA password", account.id, extra={"account_id": account.id})
            await _publish(handle.auth)
            return handle.auth
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc)
            handle.auth.fail(err.code, err.message, err.retry_after)
            await _publish(handle.auth)
            raise err from exc

        return await finalize_login(session, account, handle)


async def sign_in_password(session: AsyncSession, account: Account, password: str) -> AuthState:
    handle = await manager.get_or_create(account)
    async with handle.lock:
        try:
            await handle.client.sign_in(password=password)
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc)
            handle.auth.status = PASSWORD_REQUIRED
            handle.auth.error_code = err.code
            handle.auth.error = err.message
            handle.auth.retry_after = err.retry_after
            await _publish(handle.auth)
            raise err from exc
        return await finalize_login(session, account, handle)


# --------------------------------------------------------------------------
# QR login
# --------------------------------------------------------------------------


async def _qr_watch(account_id: int) -> None:
    """Background waiter for a scanned QR code.

    Runs until the phone confirms, 2FA is requested, or the token expires.
    """
    handle = manager.get(account_id)
    if handle is None or handle.qr_login is None:
        return
    try:
        await handle.qr_login.wait()
    except SessionPasswordNeededError:
        handle.auth.status = PASSWORD_REQUIRED
        handle.auth.password_hint = await _password_hint(handle)
        handle.auth.qr_url = None
        async with session_scope() as session:
            account = await session.get(Account, account_id)
            if account:
                account.status = "pending_password"
        log.info("QR scanned, 2FA password required", extra={"account_id": account_id})
        await _publish(handle.auth)
        return
    except (asyncio.TimeoutError, TimeoutError):
        handle.auth.status = QR_EXPIRED
        log.info("QR token expired", extra={"account_id": account_id})
        await _publish(handle.auth)
        return
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        err = _translate(exc)
        handle.auth.fail(err.code, err.message, err.retry_after)
        log.warning("QR login failed: %s", err.message, extra={"account_id": account_id})
        await _publish(handle.auth)
        return

    # Scanned and accepted without 2FA.
    async with session_scope() as session:
        account = await session.get(Account, account_id)
        if account is not None:
            await finalize_login(session, account, handle)


async def qr_start(session: AsyncSession, account: Account) -> AuthState:
    handle = await manager.get_or_create(account)
    async with handle.lock:
        if await handle.client.is_user_authorized():
            return await finalize_login(session, account, handle)

        await handle.cancel_qr()
        try:
            qr_login = await handle.client.qr_login()
        except Exception as exc:  # noqa: BLE001
            err = _translate(exc)
            handle.auth.fail(err.code, err.message, err.retry_after)
            account.status = "error"
            account.last_error = err.message
            await session.flush()
            await _publish(handle.auth)
            raise err from exc

        handle.qr_login = qr_login
        handle.auth.reset()
        handle.auth.status = QR_WAITING
        handle.auth.qr_url = qr_login.url
        handle.auth.qr_expires_at = _as_utc(qr_login.expires)
        handle.qr_task = asyncio.create_task(_qr_watch(account.id), name=f"qr-{account.id}")
        account.status = "pending_code"
        await session.flush()
        log.info("QR login token issued", extra={"account_id": account.id})
        await _publish(handle.auth)
        return handle.auth


async def qr_refresh(session: AsyncSession, account: Account) -> AuthState:
    """Re-issue an expired token, reusing the same client and DC."""
    handle = manager.get(account.id)
    if handle is None or handle.qr_login is None:
        return await qr_start(session, account)

    async with handle.lock:
        if handle.qr_task and not handle.qr_task.done():
            handle.qr_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await handle.qr_task
        try:
            await handle.qr_login.recreate()
        except Exception as exc:  # noqa: BLE001
            log.debug("recreate() failed (%s) — issuing a fresh token", exc)
            return await qr_start(session, account)

        handle.auth.status = QR_WAITING
        handle.auth.qr_url = handle.qr_login.url
        handle.auth.qr_expires_at = _as_utc(handle.qr_login.expires)
        handle.auth.error = None
        handle.auth.error_code = None
        handle.qr_task = asyncio.create_task(_qr_watch(account.id), name=f"qr-{account.id}")
        await _publish(handle.auth)
        return handle.auth


async def qr_status(session: AsyncSession, account: Account) -> AuthState:
    """Poll endpoint: reports state and auto-expires a stale token."""
    handle = manager.get(account.id)
    if handle is None:
        return AuthState(account_id=account.id, phone=account.phone)
    state = handle.auth
    if (
        state.status == QR_WAITING
        and state.qr_expires_at is not None
        and _as_utc(state.qr_expires_at) <= datetime.now(timezone.utc)
    ):
        state.status = QR_EXPIRED
    return state


# --------------------------------------------------------------------------
# misc
# --------------------------------------------------------------------------


async def cancel(session: AsyncSession, account: Account) -> AuthState:
    handle = manager.get(account.id)
    if handle is None:
        return AuthState(account_id=account.id, phone=account.phone)
    await handle.cancel_qr()
    handle.auth.reset()
    if account.status in {"pending_code", "pending_password"}:
        account.status = "new" if not account.session_enc else "unauthorized"
        await session.flush()
    await _publish(handle.auth)
    return handle.auth


async def current_state(session: AsyncSession, account: Account) -> AuthState:
    """State for ``GET /api/auth/{id}/state``, refreshing from the client."""
    handle = manager.get(account.id)
    if handle is None:
        state = AuthState(account_id=account.id, phone=account.phone)
        if account.status == "authorized":
            state.status = AUTHORIZED
        return state
    if handle.client.is_connected():
        try:
            if await handle.client.is_user_authorized():
                handle.auth.status = AUTHORIZED
                if handle.auth.user is None:
                    handle.auth.user = await manager.snapshot_user(handle)
            elif handle.auth.status == AUTHORIZED:
                handle.auth.status = IDLE
        except Exception as exc:  # noqa: BLE001
            log.debug("is_user_authorized failed: %s", exc)
    return handle.auth


async def logout(session: AsyncSession, account: Account) -> None:
    """Revoke the Telegram session and wipe the stored credentials."""
    handle = manager.get(account.id)
    if handle is not None:
        with suppress(Exception):
            if handle.client.is_connected():
                await handle.client.log_out()
        await manager.disconnect(account.id)
    account.session_enc = None
    account.status = "unauthorized"
    account.last_error = None
    await session.flush()
    log.info("Account #%s logged out", account.id, extra={"account_id": account.id})
    await bus.publish("auth_state", AuthState(account_id=account.id).to_dict())


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
