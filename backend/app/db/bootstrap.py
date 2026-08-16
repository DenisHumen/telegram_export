"""Schema bootstrap: wait for the server, create the DB, create the tables.

Deliberately migration-free — the schema is created with ``create_all`` and
evolved by :func:`_apply_soft_migrations`, which adds missing columns/indexes
in place. That keeps ``start.sh`` a single step with no Alembic ceremony,
which matters far more here than perfect migration history.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.db.base import Base
from app.db.session import get_engine

# Import models for their side effect of registering on Base.metadata.
from app.db import models  # noqa: F401

log = logging.getLogger("tgvault.db")


async def wait_for_database(timeout: float = 90.0, interval: float = 2.0) -> None:
    """Block until the database server accepts connections."""
    if not settings.is_mysql:
        return
    url = make_url(settings.sqlalchemy_url).set(database=None)
    deadline = asyncio.get_event_loop().time() + timeout
    last_error: Exception | None = None
    attempt = 0
    while asyncio.get_event_loop().time() < deadline:
        attempt += 1
        engine = create_async_engine(url, pool_pre_ping=True)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            await engine.dispose()
            log.info("MySQL is reachable at %s:%s", settings.mysql_host, settings.mysql_port)
            return
        except Exception as exc:  # noqa: BLE001 - any connection error is retryable here
            last_error = exc
            await engine.dispose()
            if attempt == 1 or attempt % 5 == 0:
                log.warning("Waiting for MySQL (%s)…", type(exc).__name__)
            await asyncio.sleep(interval)
    raise RuntimeError(
        f"MySQL at {settings.mysql_host}:{settings.mysql_port} is not reachable "
        f"after {timeout:.0f}s. Is Docker running? Last error: {last_error}"
    )


async def ensure_database_exists() -> None:
    """``CREATE DATABASE IF NOT EXISTS`` with the right charset."""
    if not settings.is_mysql:
        return
    url = make_url(settings.sqlalchemy_url)
    db_name = url.database
    server_engine = create_async_engine(url.set(database=None))
    try:
        async with server_engine.begin() as conn:
            await conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
        log.info("Database `%s` is ready", db_name)
    finally:
        await server_engine.dispose()


async def create_tables() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    log.info("Tables created/verified (%d tables)", len(Base.metadata.tables))


async def _apply_soft_migrations() -> None:
    """Add anything ``create_all`` cannot express or that arrived later.

    Every statement is guarded so re-running is a no-op.
    """
    if not settings.is_mysql:
        return
    engine = get_engine()
    async with engine.begin() as conn:
        # An earlier version created a FULLTEXT index here. It was dropped:
        # message search is substring search (LIKE '%…%'), which FULLTEXT
        # cannot serve — MATCH…AGAINST is word-based, so searching "порт"
        # would not find "экспорт". Keeping the index only cost write
        # throughput during large exports, so it is removed if present.
        exists = await conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.statistics "
                "WHERE table_schema = DATABASE() AND table_name = 'messages' "
                "AND index_name = 'ft_messages_text'"
            )
        )
        if exists.scalar():
            try:
                await conn.execute(text("DROP INDEX ft_messages_text ON messages"))
                log.info("Dropped the unused FULLTEXT index on messages.text")
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not drop the FULLTEXT index: %s", exc)


async def _stamp_schema_version() -> None:
    """Record the app version that last touched this schema."""
    from sqlalchemy.dialects.mysql import insert as mysql_insert

    from app import __version__
    from app.db.models import Setting
    from app.db.session import session_scope

    payload = {"version": __version__}
    try:
        async with session_scope() as session:
            if settings.is_mysql:
                statement = mysql_insert(Setting).values(
                    skey="schema_version", svalue=payload
                )
                await session.execute(
                    statement.on_duplicate_key_update(svalue=payload)
                )
            else:
                existing = await session.get(Setting, "schema_version")
                if existing is None:
                    session.add(Setting(skey="schema_version", svalue=payload))
                else:
                    existing.svalue = payload
    except Exception as exc:  # noqa: BLE001 - bookkeeping must never block start-up
        log.debug("Could not stamp the schema version: %s", exc)


async def init_db() -> None:
    """Full bootstrap sequence used by the FastAPI lifespan."""
    await wait_for_database()
    await ensure_database_exists()
    await create_tables()
    await _apply_soft_migrations()
    await _stamp_schema_version()


async def reset_db() -> None:
    """Drop and recreate everything. Only used by tests and ``--fresh``."""
    engine = get_engine()
    async with engine.begin() as conn:
        if settings.is_mysql:
            await conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        await conn.run_sync(Base.metadata.drop_all)
        if settings.is_mysql:
            await conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        await conn.run_sync(Base.metadata.create_all)
    await _apply_soft_migrations()
