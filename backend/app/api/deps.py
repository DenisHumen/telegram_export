"""Shared dependencies, the transaction boundary, and the error contract.

**Why the custom route class:** FastAPI runs the exit code of a ``yield``
dependency *after the response has been sent*. Committing there means a client
that immediately re-reads what it just wrote can observe the old state — a
``POST /api/accounts`` returning 201 followed by a ``GET`` that answers 404.
``CommitRoute`` moves the commit to just after the handler returns and before
the response leaves the app, which is the boundary callers actually expect.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Request, Response
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, Chat, ExportJob
from app.db.session import get_session_factory


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request, committed by :class:`CommitRoute`."""
    session = get_session_factory()()
    request.state.db = session
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        # Closing without a commit rolls back, so a handler that raised never
        # leaves a half-applied write behind.
        await session.close()


class CommitRoute(APIRoute):
    """Commits the request's session before the response is returned."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            response = await original(request)
            session: AsyncSession | None = getattr(request.state, "db", None)
            if session is not None and session.in_transaction():
                await session.commit()
            return response

        return handler


DbSession = Annotated[AsyncSession, Depends(get_db)]


class ApiError(HTTPException):
    """HTTPException whose body is ``{"detail": …, "code": …}``."""

    def __init__(self, status_code: int, detail: str, code: str = "ERROR") -> None:
        super().__init__(status_code=status_code, detail={"detail": detail, "code": code})


async def get_account(
    session: DbSession, account_id: Annotated[int, Path(ge=1)]
) -> Account:
    account = await session.get(Account, account_id)
    if account is None:
        raise ApiError(404, f"Аккаунт #{account_id} не найден", "ACCOUNT_NOT_FOUND")
    return account


async def get_chat(session: DbSession, chat_id: Annotated[int, Path(ge=1)]) -> Chat:
    chat = await session.get(Chat, chat_id)
    if chat is None:
        raise ApiError(404, f"Чат #{chat_id} не найден", "CHAT_NOT_FOUND")
    return chat


async def get_job(session: DbSession, job_id: Annotated[int, Path(ge=1)]) -> ExportJob:
    job = await session.get(ExportJob, job_id)
    if job is None:
        raise ApiError(404, f"Задача #{job_id} не найдена", "JOB_NOT_FOUND")
    return job


CurrentAccount = Annotated[Account, Depends(get_account)]
CurrentChat = Annotated[Chat, Depends(get_chat)]
CurrentJob = Annotated[ExportJob, Depends(get_job)]
