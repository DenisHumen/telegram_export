"""Where each downloaded file lands on disk.

Users care about this more than anything else in an exporter: an archive of
40 000 files in one folder is useless. Eight layout strategies cover the ways
people actually want to browse an archive afterwards, and the filename is a
user-editable template on top.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.tg.extract import safe_filename, slugify

LAYOUTS = (
    "flat",
    "by_type",
    "by_date",
    "by_date_type",
    "by_type_date",
    "by_sender",
    "by_album",
    "by_size",
)

SORT_FIELDS = ("date", "type", "sender", "size", "views", "id")

DEFAULT_TEMPLATE = "{date}_{id}_{name}"

#: Human-friendly directory name per media kind.
TYPE_DIRS = {
    "photo": "photos",
    "video": "videos",
    "video_note": "video_notes",
    "voice": "voice_messages",
    "audio": "audio",
    "document": "documents",
    "sticker": "stickers",
    "animation": "animations",
    "thumb": "thumbnails",
    "avatar": "avatars",
}

_SIZE_BUCKETS = (
    (10 * 1024 * 1024, "small_lt10mb"),
    (100 * 1024 * 1024, "medium_lt100mb"),
    (1024 * 1024 * 1024, "large_lt1gb"),
)


def type_dir(kind: str) -> str:
    return TYPE_DIRS.get(kind, "other")


def size_bucket(size: int | None) -> str:
    if not size:
        return "unknown_size"
    for threshold, name in _SIZE_BUCKETS:
        if size < threshold:
            return name
    return "huge_gte1gb"


def directory_for(
    layout: str,
    *,
    kind: str,
    date: datetime,
    sender: str | None,
    grouped_id: int | None,
    size: int | None,
) -> str:
    """Relative directory (POSIX separators) for one file."""
    year = f"{date.year:04d}"
    month = f"{date.year:04d}-{date.month:02d}"
    kind_dir = type_dir(kind)

    if layout == "flat":
        return "media"
    if layout == "by_type":
        return f"media/{kind_dir}"
    if layout == "by_date":
        return f"media/{year}/{month}"
    if layout == "by_date_type":
        return f"media/{year}/{month}/{kind_dir}"
    if layout == "by_sender":
        return f"media/{slugify(sender or 'unknown', 48)}"
    if layout == "by_album":
        return f"media/albums/{grouped_id}" if grouped_id else f"media/single/{kind_dir}"
    if layout == "by_size":
        return f"media/{size_bucket(size)}/{kind_dir}"
    # 'by_type_date' is the default: browsing by kind first matches how people
    # look for "that video note from January".
    return f"media/{kind_dir}/{month}"


def render_filename(
    template: str,
    *,
    message_id: int,
    date: datetime,
    original_name: str | None,
    ext: str | None,
    kind: str,
    sender: str | None,
    chat_title: str | None,
    grouped_id: int | None,
) -> str:
    """Apply a filename template and guarantee a sane, unique-ish result."""
    ext = (ext or "").lower()
    if ext and not ext.startswith("."):
        ext = "." + ext

    stem = Path(original_name).stem if original_name else ""
    stem = slugify(stem, 80) if stem else kind

    values = {
        "id": str(message_id),
        "date": date.strftime("%Y-%m-%d"),
        "time": date.strftime("%H-%M-%S"),
        "datetime": date.strftime("%Y-%m-%d_%H-%M-%S"),
        "name": stem,
        "ext": ext.lstrip("."),
        "kind": kind,
        "sender": slugify(sender or "unknown", 40),
        "chat": slugify(chat_title or "chat", 40),
        "album": str(grouped_id) if grouped_id else "single",
    }

    try:
        rendered = template.format(**values)
    except (KeyError, IndexError, ValueError):
        # A bad template must not abort an export — fall back to the default.
        rendered = DEFAULT_TEMPLATE.format(**values)

    rendered = safe_filename(rendered, 150).strip("._ ") or f"{kind}_{message_id}"
    if ext and not rendered.lower().endswith(ext):
        rendered += ext
    return rendered


def unique_path(directory: Path, filename: str, taken: set[str]) -> Path:
    """Resolve collisions with a ``_2``, ``_3`` … suffix.

    ``taken`` tracks names claimed during this run, because a file that is
    still downloading does not exist on disk yet.
    """
    candidate = directory / filename
    key = str(candidate).lower()
    if key not in taken and not candidate.exists():
        taken.add(key)
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    counter = 2
    while True:
        candidate = directory / f"{stem}_{counter}{suffix}"
        key = str(candidate).lower()
        if key not in taken and not candidate.exists():
            taken.add(key)
            return candidate
        counter += 1


def sort_key(field: str):
    """Sort key function for rendered message dicts."""

    def by_date(item: dict[str, Any]):
        return item.get("date") or ""

    def by_type(item: dict[str, Any]):
        return (item.get("media_type") or "", item.get("date") or "")

    def by_sender(item: dict[str, Any]):
        return ((item.get("sender_name") or "").lower(), item.get("date") or "")

    def by_size(item: dict[str, Any]):
        return max((f.get("size") or 0) for f in item.get("files", [])) if item.get("files") else 0

    def by_views(item: dict[str, Any]):
        return item.get("views") or 0

    def by_id(item: dict[str, Any]):
        return item.get("tg_message_id") or 0

    return {
        "date": by_date,
        "type": by_type,
        "sender": by_sender,
        "size": by_size,
        "views": by_views,
        "id": by_id,
    }.get(field, by_date)
