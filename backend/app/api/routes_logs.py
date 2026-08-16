"""``/api/logs``, ``/api/files`` and ``/api/system`` — log viewer and file access."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import ApiError, CommitRoute, DbSession
from app.api.schemas import OpenFolderRequest
from app.config import settings
from app.db.models import AppLog, MediaFile

log = logging.getLogger("tgvault.api.logs")

router = APIRouter(prefix="/api", tags=["logs"], route_class=CommitRoute)


@router.get("/logs")
async def list_logs(
    session: DbSession,
    level: str | None = None,
    account_id: int | None = None,
    job_id: int | None = None,
    search: str | None = None,
    limit: int = 200,
    after_id: int = 0,
):
    query = select(AppLog)
    if level and level.lower() != "all":
        query = query.where(AppLog.level == level.upper())
    if account_id:
        query = query.where(AppLog.account_id == account_id)
    if job_id:
        query = query.where(AppLog.job_id == job_id)
    if search:
        query = query.where(AppLog.message.like(f"%{search.strip()}%"))
    if after_id:
        query = query.where(AppLog.id > after_id).order_by(AppLog.id.asc())
    else:
        query = query.order_by(AppLog.id.desc())
    query = query.limit(max(1, min(1000, limit)))

    rows = (await session.execute(query)).scalars().all()
    if not after_id:
        rows = list(reversed(rows))
    return [
        {
            "id": row.id,
            "ts": row.ts.isoformat(timespec="milliseconds") + "Z",
            "level": row.level,
            "logger": row.logger,
            "message": row.message,
            "account_id": row.account_id,
            "job_id": row.job_id,
            "data": row.data,
        }
        for row in rows
    ]


@router.get("/logs/files")
async def list_log_files():
    files = []
    for path in sorted(settings.logs_path.glob("*.log*")):
        try:
            stat = path.stat()
        except OSError:
            continue
        files.append(
            {"name": path.name, "size": stat.st_size, "modified": int(stat.st_mtime)}
        )
    return files


@router.get("/logs/files/{name}")
async def tail_log_file(name: str, tail: int = 500):
    # Reject anything that is not a plain filename inside the logs directory.
    if "/" in name or "\\" in name or ".." in name or name.startswith("."):
        raise ApiError(400, "Некорректное имя файла.", "BAD_FILENAME")
    path = (settings.logs_path / name).resolve()
    if not str(path).startswith(str(settings.logs_path.resolve())) or not path.is_file():
        raise ApiError(404, "Файл лога не найден.", "LOG_NOT_FOUND")
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError as exc:
        raise ApiError(500, f"Не удалось прочитать файл: {exc}", "LOG_UNREADABLE") from exc
    tail = max(1, min(5000, tail))
    return {"name": name, "lines": [line.rstrip("\n") for line in lines[-tail:]]}


def _guard_path(path: Path) -> Path:
    """Refuse to serve anything outside the data directory."""
    resolved = path.resolve()
    root = settings.data_path.resolve()
    if not str(resolved).startswith(str(root)):
        raise ApiError(403, "Доступ к этому пути запрещён.", "PATH_FORBIDDEN")
    if not resolved.is_file():
        raise ApiError(404, "Файл не найден.", "FILE_NOT_FOUND")
    return resolved


@router.get("/files/download")
async def download_file(session: DbSession, media_id: int):
    media = await session.get(MediaFile, media_id)
    if media is None or not media.abs_path:
        raise ApiError(404, "Файл не найден.", "FILE_NOT_FOUND")
    path = _guard_path(Path(media.abs_path))
    return FileResponse(
        path,
        filename=media.file_name or path.name,
        media_type=media.mime_type or "application/octet-stream",
    )


@router.get("/files/thumb")
async def download_thumb(session: DbSession, media_id: int):
    """Preview for a media file.

    Returns the ``thumb`` companion downloaded with ``download_thumbs``; for a
    photo or sticker, the file itself already is the preview.
    """
    media = await session.get(MediaFile, media_id)
    if media is None:
        raise ApiError(404, "Файл не найден.", "FILE_NOT_FOUND")

    thumb = (
        await session.execute(
            select(MediaFile).where(
                MediaFile.message_id == media.message_id,
                MediaFile.kind == "thumb",
                MediaFile.status == "done",
            )
        )
    ).scalars().first()

    target = thumb or (media if media.kind in {"photo", "sticker"} else None)
    if target is None or not target.abs_path or target.status != "done":
        raise ApiError(404, "Превью для этого файла нет.", "THUMB_NOT_FOUND")
    path = _guard_path(Path(target.abs_path))
    return FileResponse(path, media_type=target.mime_type or "image/jpeg")


@router.get("/files/photo")
async def chat_photo(path: str):
    if not path:
        raise ApiError(400, "Не указан путь.", "BAD_PATH")
    resolved = _guard_path(settings.data_path / path)
    return FileResponse(resolved, media_type="image/jpeg")


@router.post("/system/open-folder")
async def open_folder(payload: OpenFolderRequest):
    """Open an export folder in the OS file manager.

    Restricted to directories the app itself produced. The server listens on
    localhost, but any page in the browser can POST here, so an unrestricted
    version would let a random web page pop open arbitrary folders — and on
    Windows ``os.startfile`` on a file would *execute* it.
    """
    target = Path(payload.path).expanduser().resolve()
    allowed_roots = [settings.data_path.resolve()]
    custom = os.environ.get("TGV_EXTRA_OPEN_ROOTS", "")
    allowed_roots += [Path(p).expanduser().resolve() for p in custom.split(os.pathsep) if p]

    if not any(
        target == root or root in target.parents for root in allowed_roots
    ):
        raise ApiError(
            403,
            "Открывать можно только каталоги внутри каталога данных приложения.",
            "PATH_FORBIDDEN",
        )
    if not target.is_dir():
        raise ApiError(404, "Каталог не найден.", "DIR_NOT_FOUND")
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])  # noqa: S603,S607
        else:
            subprocess.Popen(["xdg-open", str(target)])  # noqa: S603,S607
    except Exception as exc:  # noqa: BLE001
        raise ApiError(500, f"Не удалось открыть каталог: {exc}", "OPEN_FAILED") from exc
    return {"ok": True}
