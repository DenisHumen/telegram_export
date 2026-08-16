"""``/api/export`` — create and control export jobs."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.deps import ApiError, CommitRoute, CurrentJob, DbSession
from app.api.schemas import CreateJobRequest, RebuildRequest
from app.db.models import Account, Chat, ExportJob, JobEvent
from app.services import jobs as jobs_service

log = logging.getLogger("tgvault.api.export")

router = APIRouter(prefix="/api/export", tags=["export"], route_class=CommitRoute)


@router.post("/jobs", status_code=201)
async def create_job(payload: CreateJobRequest, session: DbSession):
    account = await session.get(Account, payload.account_id)
    if account is None:
        raise ApiError(404, f"Аккаунт #{payload.account_id} не найден", "ACCOUNT_NOT_FOUND")
    if account.status != "authorized":
        raise ApiError(400, "Аккаунт не авторизован.", "NOT_AUTHORIZED")
    chat = await session.get(Chat, payload.chat_id)
    if chat is None:
        raise ApiError(404, f"Чат #{payload.chat_id} не найден", "CHAT_NOT_FOUND")
    if chat.account_id != account.id:
        raise ApiError(400, "Этот чат принадлежит другому аккаунту.", "CHAT_ACCOUNT_MISMATCH")

    existing = await jobs_service.active_job_id(session, chat.id)
    if existing:
        raise ApiError(
            409,
            f"Для этого чата уже выполняется задача #{existing}.",
            "JOB_ALREADY_RUNNING",
        )

    job = await jobs_service.create_job(
        session, account_id=account.id, chat_id=chat.id, options=payload.options
    )
    return await jobs_service.serialize(session, job)


@router.get("/jobs")
async def list_jobs(
    session: DbSession,
    account_id: int | None = None,
    chat_id: int | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 50,
):
    query = select(ExportJob)
    if account_id:
        query = query.where(ExportJob.account_id == account_id)
    if chat_id:
        query = query.where(ExportJob.chat_id == chat_id)
    if status and status != "all":
        query = query.where(ExportJob.status == status)
    query = query.order_by(ExportJob.id.desc())

    page = max(1, page)
    page_size = max(1, min(200, page_size))
    total = int(
        await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    )
    rows = (
        await session.execute(query.offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return {
        "items": [await jobs_service.serialize(session, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size else 1,
    }


@router.get("/jobs/{job_id}")
async def get_job(job: CurrentJob, session: DbSession):
    return await jobs_service.serialize(session, job)


@router.post("/jobs/{job_id}/pause")
async def pause_job(job: CurrentJob, session: DbSession):
    if job.status not in {"running", "queued"}:
        raise ApiError(400, f"Нельзя приостановить задачу в статусе «{job.status}».", "BAD_STATE")
    await jobs_service.pause_job(session, job)
    return await jobs_service.serialize(session, job)


@router.post("/jobs/{job_id}/resume")
async def resume_job(job: CurrentJob, session: DbSession):
    if job.status != "paused":
        raise ApiError(400, "Задача не находится на паузе.", "BAD_STATE")
    await jobs_service.resume_job(session, job)
    return await jobs_service.serialize(session, job)


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job: CurrentJob, session: DbSession):
    if job.status in {"completed", "cancelled", "failed"}:
        raise ApiError(400, "Задача уже завершена.", "BAD_STATE")
    await jobs_service.cancel_job(session, job)
    return await jobs_service.serialize(session, job)


@router.delete("/jobs/{job_id}")
async def delete_job(job: CurrentJob, session: DbSession):
    if jobs_service.is_running(job.id):
        raise ApiError(409, "Сначала остановите выполняющуюся задачу.", "JOB_RUNNING")
    await session.delete(job)
    await session.flush()
    return {"ok": True}


@router.get("/jobs/{job_id}/events")
async def job_events(job: CurrentJob, session: DbSession, after_id: int = 0, limit: int = 200):
    query = (
        select(JobEvent)
        .where(JobEvent.job_id == job.id, JobEvent.id > after_id)
        .order_by(JobEvent.id.asc())
        .limit(max(1, min(1000, limit)))
    )
    rows = (await session.execute(query)).scalars().all()
    return [
        {
            "id": row.id,
            "job_id": row.job_id,
            "ts": row.ts.isoformat(timespec="milliseconds") + "Z",
            "level": row.level,
            "message": row.message,
            "data": row.data,
        }
        for row in rows
    ]


@router.post("/jobs/{job_id}/rebuild")
async def rebuild_job(payload: RebuildRequest, job: CurrentJob, session: DbSession):
    overrides = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        written = await jobs_service.rebuild_outputs(session, job, overrides=overrides)
    except ValueError as exc:
        raise ApiError(400, str(exc), "NO_OUTPUT_DIR") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Rebuild failed for job #%s", job.id)
        raise ApiError(500, f"Не удалось пересобрать файлы: {exc}", "REBUILD_FAILED") from exc
    data = await jobs_service.serialize(session, job)
    data["written"] = written
    return data


@router.get("/jobs/{job_id}/manifest")
async def job_manifest(job: CurrentJob):
    if not job.output_dir:
        raise ApiError(404, "У задачи ещё нет каталога вывода.", "NO_OUTPUT_DIR")
    manifest = Path(job.output_dir) / "manifest.json"
    if not manifest.exists():
        raise ApiError(404, "manifest.json не найден — выполните пересборку.", "NO_MANIFEST")
    try:
        return json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ApiError(500, f"Не удалось прочитать манифест: {exc}", "MANIFEST_UNREADABLE") from exc
