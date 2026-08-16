"""Export job lifecycle: create, schedule, pause, resume, cancel.

A small scheduler runs in the background instead of starting a task straight
from the HTTP handler. That buys three things: a hard cap on how many exports
hit Telegram at once (flood protection), a real ``queued`` state the UI can
show, and automatic recovery of jobs that were running when the process died.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bus import bus
from app.db.base import utcnow
from app.db.models import Chat, ExportJob, JobEvent
from app.db.session import session_scope
from app.services.options import ExportOptions
from app.tg.exporter import (
    ExportEngine,
    JobControl,
    active_downloads,
    controls,
    job_to_dict,
)

log = logging.getLogger("tgvault.jobs")

#: How many exports may talk to Telegram simultaneously.
MAX_CONCURRENT_JOBS = 3

_tasks: dict[int, asyncio.Task] = {}
_scheduler_task: asyncio.Task | None = None


# --------------------------------------------------------------------------
# creation
# --------------------------------------------------------------------------


async def create_job(
    session: AsyncSession, *, account_id: int, chat_id: int, options: ExportOptions
) -> ExportJob:
    job = ExportJob(
        account_id=account_id,
        chat_id=chat_id,
        options=options.model_dump(mode="json"),
        status="queued",
        phase="init",
        min_id=options.min_id,
        max_id=options.max_id,
    )
    session.add(job)
    await session.flush()
    session.add(
        JobEvent(job_id=job.id, level="info", message="Задача создана и поставлена в очередь")
    )
    await session.flush()
    log.info(
        "Created export job #%s for chat #%s", job.id, chat_id, extra={"account_id": account_id}
    )
    payload = await job_to_dict(session, job)
    await bus.publish("job_progress", payload)
    return job


# --------------------------------------------------------------------------
# scheduling
# --------------------------------------------------------------------------


def running_count() -> int:
    return sum(1 for task in _tasks.values() if not task.done())


def is_running(job_id: int) -> bool:
    task = _tasks.get(job_id)
    return task is not None and not task.done()


async def _run_job(job_id: int) -> None:
    control = JobControl()
    controls[job_id] = control
    engine = ExportEngine(job_id, control)
    try:
        await engine.run()
    finally:
        _tasks.pop(job_id, None)
        controls.pop(job_id, None)


async def launch(job_id: int) -> None:
    """Start a job immediately (used by the scheduler)."""
    if is_running(job_id):
        return
    _tasks[job_id] = asyncio.create_task(_run_job(job_id), name=f"export-{job_id}")


async def _scheduler_loop() -> None:
    """Promote queued jobs to running while there is capacity."""
    while True:
        try:
            await asyncio.sleep(1.5)
            free = MAX_CONCURRENT_JOBS - running_count()
            if free <= 0:
                continue
            async with session_scope() as session:
                queued = (
                    await session.execute(
                        select(ExportJob)
                        .where(ExportJob.status == "queued")
                        .order_by(ExportJob.id.asc())
                        .limit(free)
                    )
                ).scalars().all()
                job_ids = [job.id for job in queued]
            for job_id in job_ids:
                if not is_running(job_id):
                    await launch(job_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the scheduler must never die
            log.warning("Scheduler tick failed: %s", exc)
            await asyncio.sleep(5)


async def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(_scheduler_loop(), name="job-scheduler")
        log.info("Export scheduler started (max %s concurrent jobs)", MAX_CONCURRENT_JOBS)


async def stop_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task is not None:
        _scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await _scheduler_task
        _scheduler_task = None
    for job_id, task in list(_tasks.items()):
        control = controls.get(job_id)
        if control:
            control.cancel()
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
    _tasks.clear()


async def recover_interrupted() -> int:
    """Re-queue jobs that were mid-flight when the process stopped.

    Safe because the engine is idempotent: already-archived messages and
    already-downloaded files are skipped on the second pass.
    """
    async with session_scope() as session:
        stuck = (
            await session.execute(
                select(ExportJob).where(ExportJob.status.in_(("running", "paused")))
            )
        ).scalars().all()
        for job in stuck:
            job.status = "queued"
            job.phase = "init"
            job.error = None
            session.add(
                JobEvent(
                    job_id=job.id,
                    level="warning",
                    message="Приложение было перезапущено — задача возвращена в очередь",
                )
            )
        count = len(stuck)
    if count:
        log.info("Re-queued %s interrupted export job(s)", count)
    return count


# --------------------------------------------------------------------------
# control
# --------------------------------------------------------------------------


async def pause_job(session: AsyncSession, job: ExportJob) -> ExportJob:
    control = controls.get(job.id)
    if control is not None:
        control.pause()
    job.status = "paused"
    await session.flush()
    session.add(JobEvent(job_id=job.id, level="info", message="Задача приостановлена"))
    await _notify(session, job)
    return job


async def resume_job(session: AsyncSession, job: ExportJob) -> ExportJob:
    control = controls.get(job.id)
    if control is not None:
        control.resume()
        job.status = "running"
    else:
        # The process restarted while it was paused — re-queue it instead.
        job.status = "queued"
        job.phase = "init"
    await session.flush()
    session.add(JobEvent(job_id=job.id, level="info", message="Задача возобновлена"))
    await _notify(session, job)
    return job


#: How long a cancelled job may take to stop cooperatively before it is killed.
CANCEL_GRACE_SECONDS = 8.0


async def cancel_job(session: AsyncSession, job: ExportJob) -> ExportJob:
    control = controls.get(job.id)
    if control is not None:
        control.cancel()
    job.status = "cancelled"
    if not is_running(job.id):
        job.finished_at = utcnow()
        job.phase = "done"
    await session.flush()
    session.add(JobEvent(job_id=job.id, level="warning", message="Задача отменена"))

    # Cooperative cancellation only lands when the coroutine reaches a
    # checkpoint. A task blocked on a Telegram call that never returns would
    # otherwise stay alive forever — leaving the job "running" internally and
    # making it undeletable. Kill it after a grace period.
    if is_running(job.id):
        asyncio.create_task(
            _kill_after_grace(job.id, CANCEL_GRACE_SECONDS), name=f"kill-{job.id}"
        )

    await _notify(session, job)
    return job


async def _kill_after_grace(job_id: int, grace: float) -> None:
    await asyncio.sleep(grace)
    task = _tasks.get(job_id)
    if task is None or task.done():
        return
    log.warning(
        "Job #%s ignored cancellation for %.0fs — terminating the task", job_id, grace
    )
    task.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await task
    _tasks.pop(job_id, None)
    controls.pop(job_id, None)
    active_downloads.pop(job_id, None)
    async with session_scope() as session:
        job = await session.get(ExportJob, job_id)
        if job is not None and job.status in {"running", "queued", "paused", "cancelled"}:
            job.status = "cancelled"
            job.phase = "done"
            job.finished_at = utcnow()
            session.add(
                JobEvent(
                    job_id=job_id,
                    level="warning",
                    message="Задача не остановилась сама и была снята принудительно",
                )
            )


async def force_stop(job_id: int) -> None:
    """Terminate a job's task immediately, no grace period.

    Used before deleting a job: whatever state the engine is in, the row must
    become deletable.
    """
    control = controls.get(job_id)
    if control is not None:
        control.cancel()
    task = _tasks.pop(job_id, None)
    if task is not None and not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
    controls.pop(job_id, None)
    active_downloads.pop(job_id, None)


async def rebuild_outputs(
    session: AsyncSession, job: ExportJob, *, overrides: dict[str, Any] | None = None
) -> list[str]:
    """Re-render the output files from the database, without Telegram."""
    from pathlib import Path

    from app.services.render import write_outputs

    options = ExportOptions.model_validate({**(job.options or {}), **(overrides or {})})
    job.options = options.model_dump(mode="json")
    output_dir = Path(job.output_dir) if job.output_dir else None
    if output_dir is None:
        raise ValueError("У задачи нет каталога вывода — сначала выполните экспорт.")
    written = await write_outputs(
        session,
        job_id=job.id,
        chat_id=job.chat_id,
        account_id=job.account_id,
        output_dir=output_dir,
        options=options,
    )
    session.add(
        JobEvent(
            job_id=job.id,
            level="info",
            message=f"Файлы пересобраны из базы: {', '.join(written)}",
            data={"files": written},
        )
    )
    await session.flush()
    return written


async def _notify(session: AsyncSession, job: ExportJob) -> None:
    payload = await job_to_dict(session, job)
    await bus.publish("job_progress", payload)


async def serialize(session: AsyncSession, job: ExportJob) -> dict[str, Any]:
    return await job_to_dict(session, job)


async def active_job_id(session: AsyncSession, chat_id: int) -> int | None:
    return await session.scalar(
        select(ExportJob.id)
        .where(ExportJob.chat_id == chat_id, ExportJob.status.in_(("queued", "running", "paused")))
        .order_by(ExportJob.id.desc())
        .limit(1)
    )


async def chat_title(session: AsyncSession, chat_id: int) -> str:
    chat = await session.get(Chat, chat_id)
    return chat.title if chat else ""
