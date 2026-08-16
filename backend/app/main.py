"""FastAPI application entry point.

Run with::

    uvicorn app.main:app --host 127.0.0.1 --port 8077

or, normally, via ``./start.sh`` which also brings up MySQL and Redis.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api import routes_accounts, routes_auth, routes_chats, routes_export, routes_logs, ws
from app.bus import bus
from app.config import settings
from app.db.bootstrap import init_db
from app.db.session import dispose_engine, get_engine, session_scope
from app.logging_setup import setup_logging, start_log_writer, stop_log_writer
from app.services import accounts as accounts_service
from app.services import jobs as jobs_service
from app.tg.manager import manager

log = logging.getLogger("tgvault.main")

_STARTED_AT = time.monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    log.info("─" * 60)
    log.info("TgVault %s starting…", __version__)
    log.info("Data directory: %s", settings.data_path)

    await init_db()
    await bus.connect()
    await start_log_writer()
    await jobs_service.recover_interrupted()
    await jobs_service.start_scheduler()
    await _reconnect_accounts()

    log.info("Ready on http://%s:%s", settings.host, settings.port)
    try:
        yield
    finally:
        log.info("TgVault shutting down…")
        await jobs_service.stop_scheduler()
        await manager.disconnect_all()
        await stop_log_writer()
        await bus.close()
        await dispose_engine()
        log.info("Shutdown complete")


async def _reconnect_accounts() -> None:
    """Bring previously authorised accounts back online at startup.

    Failures are recorded on the account instead of raised: one revoked
    session must not stop the app from starting.
    """
    from sqlalchemy import select

    from app.db.models import Account
    from app.tg import auth as auth_service

    async with session_scope() as session:
        accounts = (
            await session.execute(
                select(Account).where(Account.session_enc.is_not(None))
            )
        ).scalars().all()
        for account in accounts:
            try:
                handle = await manager.get_or_create(account)
                if await handle.client.is_user_authorized():
                    await auth_service.finalize_login(session, account, handle)
                else:
                    account.status = "unauthorized"
                    account.last_error = "Сессия недействительна — требуется повторный вход."
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not restore account #%s: %s", account.id, exc)
                account.status = "error"
                account.last_error = str(exc)[:1000]


app = FastAPI(
    title="TgVault API",
    description="Экспорт каналов и чатов Telegram в локальный архив",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# error contract: every failure is {"detail": …, "code": …}
# --------------------------------------------------------------------------


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "detail" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(detail), "code": f"HTTP_{exc.status_code}"},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    location = ".".join(str(part) for part in first.get("loc", [])[1:]) or "запрос"
    return JSONResponse(
        status_code=422,
        content={
            "detail": f"Некорректные данные ({location}): {first.get('msg', 'ошибка валидации')}",
            "code": "VALIDATION_ERROR",
            "errors": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Внутренняя ошибка: {exc}", "code": "INTERNAL_ERROR"},
    )


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    db_ok = True
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        log.debug("Health check DB probe failed: %s", exc)
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
        "redis": bus.redis_ok,
        "version": __version__,
        "uptime_seconds": int(time.monotonic() - _STARTED_AT),
        "data_dir": str(settings.data_path),
        "ws_clients": bus.subscriber_count,
    }


@app.get("/api/stats", tags=["system"])
async def global_stats() -> dict:
    """Dashboard totals across all accounts."""
    async with session_scope() as session:
        return await accounts_service.global_stats(session)


app.include_router(routes_accounts.router)
app.include_router(routes_auth.router)
app.include_router(routes_chats.router)
app.include_router(routes_export.router)
app.include_router(routes_logs.router)
app.include_router(ws.router)


# --------------------------------------------------------------------------
# static frontend (served only when the bundle has been built)
# --------------------------------------------------------------------------


def _mount_frontend(application: FastAPI) -> None:
    dist: Path = settings.frontend_dist
    index = dist / "index.html"
    if not settings.serve_frontend or not index.exists():
        log.info("Frontend bundle not found at %s — API-only mode", dist)

        @application.get("/", include_in_schema=False)
        async def _placeholder() -> dict:
            return {
                "app": "TgVault",
                "version": __version__,
                "ui": "не собран — запустите ./start.sh или frontend: npm run build",
                "docs": "/docs",
            }

        return

    assets = dist / "assets"
    if assets.is_dir():
        application.mount("/assets", StaticFiles(directory=assets), name="assets")

    @application.get("/", include_in_schema=False)
    async def _index() -> FileResponse:
        return FileResponse(index)

    #: Extensions that must never fall back to index.html — answering a missing
    #: script with HTML turns a 404 into a confusing MIME-type error.
    _ASSET_SUFFIXES = {
        ".js", ".mjs", ".css", ".map", ".json", ".ico", ".png", ".jpg", ".jpeg",
        ".gif", ".svg", ".webp", ".woff", ".woff2", ".ttf", ".otf", ".wasm",
    }

    @application.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str):
        """Client-side routing: any unknown non-API path returns index.html."""
        candidate = (dist / full_path).resolve()
        if str(candidate).startswith(str(dist.resolve())) and candidate.is_file():
            return FileResponse(candidate)
        if Path(full_path).suffix.lower() in _ASSET_SUFFIXES:
            return JSONResponse(
                status_code=404,
                content={"detail": f"Файл не найден: /{full_path}", "code": "ASSET_NOT_FOUND"},
            )
        return FileResponse(index)

    log.info("Serving frontend bundle from %s", dist)


_mount_frontend(app)
