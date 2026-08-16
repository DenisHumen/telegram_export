"""Turn a Telethon ``Message`` into plain dicts ready for the database.

The tricky part is media typing. Telethon's convenience properties overlap:
a round video note *also* answers ``True`` to ``.video``, a video sticker
answers ``True`` to both ``.sticker`` and ``.video``, and an animation (GIF)
is a silent MP4 that also answers ``.video``. So the checks below run in a
deliberate order, most specific first — reordering them is a bug.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from telethon.extensions import html as tl_html
from telethon.tl import types

log = logging.getLogger("tgvault.extract")

_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MULTI_DASH = re.compile(r"[-_\s]+")


def naive_utc(value: datetime | None) -> datetime | None:
    """Telegram hands out tz-aware UTC; the DB stores naive UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def slugify(value: str, max_length: int = 64) -> str:
    """ASCII-ish, filesystem-safe slug used for directory names."""
    if not value:
        return "untitled"
    normalized = unicodedata.normalize("NFKD", value)
    cleaned = _UNSAFE_CHARS.sub("", normalized).strip()
    cleaned = _MULTI_DASH.sub("_", cleaned)
    cleaned = cleaned.strip("._ ") or "untitled"
    if cleaned.upper() in _WINDOWS_RESERVED:
        cleaned = f"_{cleaned}"
    return cleaned[:max_length]


def safe_filename(name: str, max_length: int = 150) -> str:
    """Sanitise a filename, preserving the extension when truncating."""
    name = _UNSAFE_CHARS.sub("_", name or "").strip().strip(".")
    if not name:
        name = "file"
    stem, dot, ext = name.rpartition(".")
    if dot and len(ext) <= 10:
        keep = max(1, max_length - len(ext) - 1)
        return f"{stem[:keep]}.{ext}" if stem else name[:max_length]
    return name[:max_length]


# --------------------------------------------------------------------------
# media typing
# --------------------------------------------------------------------------


def detect_media_type(message: Any) -> str:
    """Return one of ``db.base.MEDIA_TYPES`` for a message."""
    try:
        if getattr(message, "photo", None):
            return "photo"
        # Round video notes ("кружочки") must be checked before .video.
        if getattr(message, "video_note", None):
            return "video_note"
        if getattr(message, "sticker", None):
            return "sticker"
        # GIFs are silent MP4 documents flagged as animated.
        if getattr(message, "gif", None):
            return "animation"
        if getattr(message, "voice", None):
            return "voice"
        if getattr(message, "audio", None):
            return "audio"
        if getattr(message, "video", None):
            return "video"
        if getattr(message, "contact", None):
            return "contact"
        if getattr(message, "poll", None):
            return "poll"
        if getattr(message, "venue", None):
            return "venue"
        if getattr(message, "geo", None):
            return "geo"
        if getattr(message, "game", None):
            return "game"
        if getattr(message, "invoice", None):
            return "invoice"
        if getattr(message, "dice", None):
            return "dice"
        if getattr(message, "document", None):
            return "document"
        if getattr(message, "web_preview", None):
            return "webpage"
        if getattr(message, "media", None):
            return "unsupported"
    except Exception as exc:  # noqa: BLE001 - exotic media must never break a run
        log.debug("Media detection failed for message %s: %s", getattr(message, "id", "?"), exc)
        return "unsupported"
    return "none"


#: Media types that produce a downloadable file on disk.
DOWNLOADABLE = {
    "photo",
    "video",
    "video_note",
    "voice",
    "audio",
    "document",
    "sticker",
    "animation",
}


def media_object(message: Any):
    """The Document/Photo carrying the bytes, or ``None``."""
    document = getattr(message, "document", None)
    if document is not None:
        return document
    return getattr(message, "photo", None)


def file_identity(message: Any) -> tuple[int | None, int | None]:
    """``(tg_file_id, access_hash)`` — stable across a file's lifetime.

    Used for deduplication: the same document forwarded twice downloads once.
    """
    obj = media_object(message)
    if obj is None:
        return None, None
    return getattr(obj, "id", None), getattr(obj, "access_hash", None)


_EXT_BY_KIND = {
    "photo": ".jpg",
    "video": ".mp4",
    "video_note": ".mp4",
    "voice": ".ogg",
    "audio": ".mp3",
    "animation": ".mp4",
    "sticker": ".webp",
}


def extract_file_info(message: Any, kind: str) -> dict[str, Any] | None:
    """Metadata for the attachment of ``message``, or ``None`` if there is none."""
    if kind not in DOWNLOADABLE:
        return None
    tg_file_id, access_hash = file_identity(message)
    file_obj = getattr(message, "file", None)

    name = getattr(file_obj, "name", None) if file_obj else None
    mime = getattr(file_obj, "mime_type", None) if file_obj else None
    size = getattr(file_obj, "size", None) if file_obj else None
    ext = (getattr(file_obj, "ext", None) if file_obj else None) or _EXT_BY_KIND.get(kind, "")
    if ext and not ext.startswith("."):
        ext = "." + ext

    width = getattr(file_obj, "width", None) if file_obj else None
    height = getattr(file_obj, "height", None) if file_obj else None
    duration = getattr(file_obj, "duration", None) if file_obj else None

    if size is None and kind == "photo":
        photo = getattr(message, "photo", None)
        sizes = getattr(photo, "sizes", None) or []
        candidates = [getattr(s, "size", None) for s in sizes if getattr(s, "size", None)]
        size = max(candidates) if candidates else None

    if not name:
        base = {
            "photo": "photo",
            "video": "video",
            "video_note": "video_note",
            "voice": "voice",
            "audio": "audio",
            "animation": "animation",
            "sticker": "sticker",
        }.get(kind, "file")
        name = f"{base}_{getattr(message, 'id', 0)}{ext}"

    return {
        "kind": kind,
        "tg_file_id": tg_file_id,
        "access_hash": access_hash,
        "file_unique": f"{kind}:{tg_file_id}" if tg_file_id else None,
        "file_name": safe_filename(name, 480),
        "ext": (ext or "").lower()[:16] or None,
        "mime_type": (mime or None) and str(mime)[:128],
        "size": int(size) if size else None,
        "width": int(width) if width else None,
        "height": int(height) if height else None,
        "duration": int(duration) if duration else None,
    }


# --------------------------------------------------------------------------
# message content
# --------------------------------------------------------------------------


def _sender_info(message: Any) -> tuple[int | None, str | None, str | None]:
    """``(sender_id, display_name, username)`` without extra API calls.

    ``iter_messages`` already ships the user/channel objects alongside the
    messages, so ``message.sender`` is a cache hit; ``get_sender()`` would be
    a network round-trip per message and is deliberately avoided.
    """
    sender_id = None
    raw_id = getattr(message, "sender_id", None)
    if raw_id is not None:
        try:
            sender_id = int(raw_id)
        except (TypeError, ValueError):
            sender_id = None

    name: str | None = None
    username: str | None = None
    try:
        sender = getattr(message, "sender", None)
    except Exception:  # noqa: BLE001
        sender = None
    if sender is not None:
        username = getattr(sender, "username", None)
        first = getattr(sender, "first_name", None)
        last = getattr(sender, "last_name", None)
        title = getattr(sender, "title", None)
        if first or last:
            name = " ".join(p for p in (first, last) if p)
        elif title:
            name = title
        elif username:
            name = username
    if not name:
        post_author = getattr(message, "post_author", None)
        if post_author:
            name = post_author
    return sender_id, (name[:255] if name else None), (username[:64] if username else None)


def _forward_info(message: Any) -> dict[str, Any]:
    fwd = getattr(message, "fwd_from", None)
    if fwd is None:
        return {
            "fwd_from_name": None,
            "fwd_from_id": None,
            "fwd_from_date": None,
            "fwd_from_post_id": None,
        }
    from_id = getattr(fwd, "from_id", None)
    numeric_id = None
    for attr in ("user_id", "channel_id", "chat_id"):
        value = getattr(from_id, attr, None)
        if value is not None:
            numeric_id = int(value)
            break
    name = getattr(fwd, "from_name", None) or getattr(fwd, "post_author", None)
    return {
        "fwd_from_name": (str(name)[:255] if name else None),
        "fwd_from_id": numeric_id,
        "fwd_from_date": naive_utc(getattr(fwd, "date", None)),
        "fwd_from_post_id": getattr(fwd, "channel_post", None),
    }


def _reactions(message: Any) -> list[dict[str, Any]] | None:
    reactions = getattr(message, "reactions", None)
    results = getattr(reactions, "results", None) if reactions else None
    if not results:
        return None
    out: list[dict[str, Any]] = []
    for item in results:
        reaction = getattr(item, "reaction", None)
        emoticon = getattr(reaction, "emoticon", None)
        document_id = getattr(reaction, "document_id", None)
        out.append(
            {
                "emoji": emoticon,
                "custom_emoji_id": int(document_id) if document_id else None,
                "count": int(getattr(item, "count", 0) or 0),
            }
        )
    return out or None


def _entities(message: Any) -> list[dict[str, Any]] | None:
    entities = getattr(message, "entities", None)
    if not entities:
        return None
    out: list[dict[str, Any]] = []
    for entity in entities:
        try:
            data = entity.to_dict()
        except Exception:  # noqa: BLE001
            continue
        data["_"] = type(entity).__name__
        out.append(data)
    return out or None


def _render_html(message: Any) -> str | None:
    """Message text with entities applied (bold/links/code…)."""
    text = getattr(message, "message", None) or ""
    if not text:
        return None
    entities = getattr(message, "entities", None)
    try:
        return tl_html.unparse(text, entities or [])
    except Exception as exc:  # noqa: BLE001
        log.debug("HTML unparse failed: %s", exc)
        return text


def _service_action(message: Any) -> tuple[bool, str | None]:
    action = getattr(message, "action", None)
    if action is None:
        return False, None
    name = type(action).__name__
    if name.startswith("MessageAction"):
        name = name[len("MessageAction"):]
    return True, name[:64]


def _compact_raw(message: Any) -> dict[str, Any] | None:
    """A small, useful subset of the raw TL object.

    Storing the whole ``to_dict()`` would multiply the database size for very
    little benefit, so only fields we might want later are kept.
    """
    data: dict[str, Any] = {}
    for attr in ("silent", "noforwards", "pinned", "legacy", "ttl_period", "via_bot_id"):
        value = getattr(message, attr, None)
        if value:
            data[attr] = int(value) if isinstance(value, bool) else value

    poll = getattr(message, "poll", None)
    if poll is not None:
        try:
            question = poll.poll.question
            data["poll"] = {
                "question": getattr(question, "text", question),
                "answers": [
                    getattr(a.text, "text", a.text) for a in poll.poll.answers
                ],
                "total_voters": getattr(poll.results, "total_voters", None),
                "closed": bool(getattr(poll.poll, "closed", False)),
            }
        except Exception:  # noqa: BLE001
            pass

    contact = getattr(message, "contact", None)
    if contact is not None:
        data["contact"] = {
            "phone": getattr(contact, "phone_number", None),
            "first_name": getattr(contact, "first_name", None),
            "last_name": getattr(contact, "last_name", None),
        }

    geo = getattr(message, "geo", None)
    if geo is not None:
        data["geo"] = {"lat": getattr(geo, "lat", None), "long": getattr(geo, "long", None)}

    preview = getattr(message, "web_preview", None)
    if preview is not None and isinstance(preview, types.WebPage):
        data["webpage"] = {
            "url": getattr(preview, "url", None),
            "title": getattr(preview, "title", None),
            "description": getattr(preview, "description", None),
            "site_name": getattr(preview, "site_name", None),
        }

    sticker_attrs = getattr(getattr(message, "file", None), "sticker_set", None)
    if sticker_attrs is not None:
        data["sticker_set"] = str(sticker_attrs)
    emoji = getattr(getattr(message, "file", None), "emoji", None)
    if emoji:
        data["emoji"] = emoji

    return data or None


def extract_message(message: Any) -> dict[str, Any] | None:
    """Map a Telethon message onto ``Message`` model kwargs.

    Returns ``None`` for ``MessageEmpty`` (deleted) — those carry no date and
    must not be archived.
    """
    if isinstance(message, types.MessageEmpty) or getattr(message, "date", None) is None:
        return None

    media_type = detect_media_type(message)
    is_service, service_action = _service_action(message)
    sender_id, sender_name, sender_username = _sender_info(message)
    replies = getattr(message, "replies", None)

    row: dict[str, Any] = {
        "tg_message_id": int(message.id),
        "date": naive_utc(message.date),
        "edit_date": naive_utc(getattr(message, "edit_date", None)),
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_username": sender_username,
        "post_author": (getattr(message, "post_author", None) or None),
        "text": (getattr(message, "message", None) or None),
        "text_html": _render_html(message),
        "entities": _entities(message),
        "media_type": media_type,
        "has_media": media_type not in {"none"},
        "grouped_id": getattr(message, "grouped_id", None),
        "reply_to_msg_id": getattr(message, "reply_to_msg_id", None),
        "views": getattr(message, "views", None),
        "forwards": getattr(message, "forwards", None),
        "replies_count": getattr(replies, "replies", None) if replies else None,
        "reactions": _reactions(message),
        "is_service": is_service,
        "service_action": service_action,
        "is_pinned": bool(getattr(message, "pinned", False)),
        "is_outgoing": bool(getattr(message, "out", False)),
        "raw": _compact_raw(message),
    }
    row.update(_forward_info(message))
    if row["post_author"]:
        row["post_author"] = str(row["post_author"])[:128]
    return row
