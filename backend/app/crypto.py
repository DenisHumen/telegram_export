"""Symmetric encryption for Telegram session strings stored in MySQL.

A leaked ``sessions`` row is a full account takeover, so session strings never
touch the database in plaintext. The Fernet key is derived from the master
secret in ``data/secret.key`` (see :meth:`Settings.resolve_secret_key`).
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

_PREFIX = "fernet:"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    secret = settings.resolve_secret_key()
    # Fernet needs exactly 32 url-safe base64 bytes; the master secret is an
    # arbitrary-length token, so hash it down to a fixed size.
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str | None) -> str | None:
    if plaintext is None or plaintext == "":
        return None
    token = _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt(ciphertext: str | None) -> str | None:
    """Decrypt a stored value.

    Returns ``None`` when the value is missing or cannot be decrypted (wrong
    or regenerated key) — callers treat that as "session lost, re-login".
    """
    if not ciphertext:
        return None
    if not ciphertext.startswith(_PREFIX):
        # Value written before encryption was introduced, or manually seeded.
        return ciphertext
    try:
        return _fernet().decrypt(ciphertext[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def mask(value: str | None, keep: int = 4) -> str:
    """Mask a secret for logging: ``1234abcd…`` -> ``1234…``."""
    if not value:
        return "—"
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + "…" + "*" * 4
