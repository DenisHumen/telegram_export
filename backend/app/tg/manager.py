"""Pool of live ``TelegramClient`` instances, one per account.

Why a long-lived pool instead of a client per request: Telegram's login is
stateful. ``send_code_request`` and the following ``sign_in`` must run on the
*same* MTProto connection — the ``phone_code_hash`` and the auth key belong to
that connection. A fresh client per HTTP request would make code login
impossible and would re-negotiate the DC handshake on every call.

All clients share the FastAPI event loop. Each handle carries its own lock so
two concurrent requests (e.g. UI double-click) cannot interleave login steps.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from telethon import TelegramClient
from telethon.sessions import StringSession

from app import __version__
from app.config import settings
from app.crypto import decrypt, encrypt

log = logging.getLogger("tgvault.tg")

DEVICE_MODEL = "TgVault Desktop"
SYSTEM_VERSION = "Windows 11"
APP_VERSION = __version__

# Auth statuses — mirror of docs/CONTRACT.md §3.
IDLE = "idle"
CODE_SENT = "code_sent"
PASSWORD_REQUIRED = "password_required"
QR_WAITING = "qr_waiting"
QR_EXPIRED = "qr_expired"
AUTHORIZED = "authorized"
ERROR = "error"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class AuthState:
    """Serialisable snapshot of an account's login progress."""

    account_id: int
    status: str = IDLE
    phone: str | None = None
    qr_url: str | None = None
    qr_expires_at: datetime | None = None
    code_type: str | None = None
    password_hint: str | None = None
    error: str | None = None
    error_code: str | None = None
    retry_after: int | None = None
    user: dict[str, Any] | None = None

    def reset(self) -> None:
        self.status = IDLE
        self.qr_url = None
        self.qr_expires_at = None
        self.code_type = None
        self.error = None
        self.error_code = None
        self.retry_after = None

    def fail(self, code: str, message: str, retry_after: int | None = None) -> None:
        self.status = ERROR
        self.error_code = code
        self.error = message
        self.retry_after = retry_after

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["qr_expires_at"] = _iso(self.qr_expires_at)
        return data


@dataclass
class ClientHandle:
    """A connected (or connectable) Telethon client plus its auth state."""

    account_id: int
    client: TelegramClient
    auth: AuthState
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    qr_login: Any | None = None
    qr_task: asyncio.Task | None = None
    phone_code_hash: str | None = None
    takeout_id: int | None = None

    async def cancel_qr(self) -> None:
        if self.qr_task and not self.qr_task.done():
            self.qr_task.cancel()
            try:
                await self.qr_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self.qr_task = None
        self.qr_login = None


def _parse_proxy(proxy: str | None) -> dict[str, Any] | None:
    """Turn ``socks5://user:pass@host:port`` into Telethon's proxy dict.

    Returns ``None`` for an empty/invalid value — a broken proxy string should
    not prevent the account from being used directly.
    """
    if not proxy:
        return None
    from urllib.parse import urlparse

    try:
        parsed = urlparse(proxy)
        scheme = (parsed.scheme or "socks5").lower()
        if scheme not in {"socks5", "socks4", "http", "https"}:
            log.warning("Unsupported proxy scheme %r — ignoring proxy", scheme)
            return None
        if not parsed.hostname or not parsed.port:
            log.warning("Proxy %r has no host/port — ignoring", proxy)
            return None
        result: dict[str, Any] = {
            "proxy_type": "http" if scheme in {"http", "https"} else scheme,
            "addr": parsed.hostname,
            "port": int(parsed.port),
            "rdns": True,
        }
        if parsed.username:
            result["username"] = parsed.username
        if parsed.password:
            result["password"] = parsed.password
        return result
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not parse proxy %r: %s", proxy, exc)
        return None


class TelegramManager:
    """Owns every live client. Singleton, created once in the app lifespan."""

    def __init__(self) -> None:
        self._handles: dict[int, ClientHandle] = {}
        self._create_lock = asyncio.Lock()

    # -- lookup ----------------------------------------------------------

    def get(self, account_id: int) -> ClientHandle | None:
        return self._handles.get(account_id)

    def is_connected(self, account_id: int) -> bool:
        handle = self._handles.get(account_id)
        return bool(handle and handle.client.is_connected())

    def auth_state(self, account_id: int) -> AuthState:
        handle = self._handles.get(account_id)
        return handle.auth if handle else AuthState(account_id=account_id)

    @property
    def account_ids(self) -> list[int]:
        return list(self._handles)

    # -- lifecycle -------------------------------------------------------

    async def get_or_create(self, account) -> ClientHandle:
        """Return a connected handle for ``account`` (an ``Account`` row)."""
        existing = self._handles.get(account.id)
        if existing is not None:
            if not existing.client.is_connected():
                await existing.client.connect()
            return existing

        async with self._create_lock:
            existing = self._handles.get(account.id)
            if existing is not None:
                return existing

            session_string = decrypt(account.session_enc) or ""
            client = TelegramClient(
                StringSession(session_string),
                api_id=int(account.api_id),
                api_hash=account.api_hash,
                device_model=DEVICE_MODEL,
                system_version=SYSTEM_VERSION,
                app_version=APP_VERSION,
                lang_code="ru",
                system_lang_code="ru",
                proxy=_parse_proxy(account.proxy),
                connection_retries=settings.connection_retries,
                request_retries=settings.request_retries,
                retry_delay=2,
                flood_sleep_threshold=settings.flood_sleep_threshold,
                auto_reconnect=True,
            )
            handle = ClientHandle(
                account_id=account.id,
                client=client,
                auth=AuthState(account_id=account.id, phone=account.phone),
            )
            self._handles[account.id] = handle
            try:
                await client.connect()
                log.info(
                    "Telegram client connected for account #%s (%s)",
                    account.id,
                    account.label or account.phone or "—",
                    extra={"account_id": account.id},
                )
            except Exception as exc:  # noqa: BLE001
                log.error("Could not connect client for account #%s: %s", account.id, exc)
                handle.auth.fail("CONNECT_FAILED", str(exc))
            return handle

    async def disconnect(self, account_id: int) -> None:
        handle = self._handles.pop(account_id, None)
        if handle is None:
            return
        await handle.cancel_qr()
        try:
            if handle.client.is_connected():
                await handle.client.disconnect()
        except Exception as exc:  # noqa: BLE001
            log.debug("Disconnect error for account #%s: %s", account_id, exc)
        log.info("Telegram client disconnected for account #%s", account_id)

    async def disconnect_all(self) -> None:
        for account_id in list(self._handles):
            await self.disconnect(account_id)

    # -- session persistence ---------------------------------------------

    @staticmethod
    def dump_session(handle: ClientHandle) -> str | None:
        """Encrypted StringSession for storage, or ``None`` if not signed in."""
        try:
            raw = StringSession.save(handle.client.session)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not serialise session: %s", exc)
            return None
        return encrypt(raw)

    async def snapshot_user(self, handle: ClientHandle) -> dict[str, Any] | None:
        """``get_me`` mapped to the shape the API returns."""
        try:
            me = await handle.client.get_me()
        except Exception as exc:  # noqa: BLE001
            log.warning("get_me failed for account #%s: %s", handle.account_id, exc)
            return None
        if me is None:
            return None
        return {
            "id": int(me.id),
            "username": getattr(me, "username", None),
            "first_name": getattr(me, "first_name", None),
            "last_name": getattr(me, "last_name", None),
            "phone": getattr(me, "phone", None),
            "is_premium": bool(getattr(me, "premium", False)),
        }


manager = TelegramManager()
