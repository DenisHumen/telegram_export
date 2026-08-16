"""A fake Telethon client good enough to drive the export engine end to end.

The real client cannot be used in tests (it needs a phone number, a live
network and Telegram's rate limits), but the export engine is exactly the part
most worth testing. These fakes implement only the surface the engine touches.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class FakeAttr:
    """Any attribute not explicitly set reads as ``None``.

    Telethon messages expose dozens of optional properties and
    ``app.tg.extract`` probes many of them; this keeps the fakes readable.
    """

    def __getattr__(self, name: str) -> Any:  # noqa: D105
        if name.startswith("__"):
            raise AttributeError(name)
        return None


class FakeFile(FakeAttr):
    def __init__(
        self,
        name: str | None,
        mime_type: str,
        size: int,
        ext: str,
        *,
        width: int | None = None,
        height: int | None = None,
        duration: int | None = None,
    ) -> None:
        self.name = name
        self.mime_type = mime_type
        self.size = size
        self.ext = ext
        self.width = width
        self.height = height
        self.duration = duration


class FakeDocument(FakeAttr):
    def __init__(self, doc_id: int) -> None:
        self.id = doc_id
        self.access_hash = doc_id * 7


class FakeSender(FakeAttr):
    def __init__(self, sender_id: int, first_name: str, username: str | None = None) -> None:
        self.id = sender_id
        self.first_name = first_name
        self.username = username


class FakeMessage(FakeAttr):
    """One message. ``kind`` decides which media property answers truthy."""

    def __init__(
        self,
        message_id: int,
        date: datetime,
        *,
        kind: str = "none",
        text: str | None = None,
        sender: FakeSender | None = None,
        size: int = 1024,
        grouped_id: int | None = None,
        views: int | None = None,
        service: str | None = None,
    ) -> None:
        self.id = message_id
        self.date = date
        self.message = text
        self.kind = kind
        self.grouped_id = grouped_id
        self.views = views
        self.out = False
        self.pinned = False
        self._sender = sender
        self.sender_id = sender.id if sender else None

        if service:
            self.action = _FakeAction(service)

        payload_size = size
        if kind == "photo":
            self.photo = FakeDocument(1000 + message_id)
            self.file = FakeFile(None, "image/jpeg", payload_size, ".jpg", width=1280, height=720)
        elif kind == "video_note":
            doc = FakeDocument(2000 + message_id)
            self.document = doc
            self.video_note = doc
            self.video = doc  # a round note is also a video — ordering matters
            self.file = FakeFile(None, "video/mp4", payload_size, ".mp4", duration=12)
        elif kind == "video":
            doc = FakeDocument(3000 + message_id)
            self.document = doc
            self.video = doc
            self.file = FakeFile("clip.mp4", "video/mp4", payload_size, ".mp4", duration=30)
        elif kind == "voice":
            doc = FakeDocument(4000 + message_id)
            self.document = doc
            self.voice = doc
            self.file = FakeFile(None, "audio/ogg", payload_size, ".ogg", duration=7)
        elif kind == "document":
            doc = FakeDocument(5000 + message_id)
            self.document = doc
            self.file = FakeFile("report.pdf", "application/pdf", payload_size, ".pdf")
        elif kind == "sticker":
            doc = FakeDocument(6000 + message_id)
            self.document = doc
            self.sticker = doc
            self.video = doc  # video stickers answer .video too
            self.file = FakeFile(None, "image/webp", payload_size, ".webp")
        elif kind == "animation":
            doc = FakeDocument(7000 + message_id)
            self.document = doc
            self.gif = doc
            self.video = doc
            self.file = FakeFile("anim.mp4", "video/mp4", payload_size, ".mp4")

    @property
    def sender(self) -> FakeSender | None:
        return self._sender


def _FakeAction(name: str) -> Any:
    """Build an action object whose class name matches Telethon's convention.

    ``extract._service_action`` reads ``type(action).__name__`` and strips the
    ``MessageAction`` prefix, so the class must genuinely carry that name.
    """
    return type(f"MessageAction{name}", (FakeAttr,), {})()


class FakeTotal(list):
    """``get_messages(limit=1)`` returns a list carrying ``.total``."""

    def __init__(self, total: int) -> None:
        super().__init__()
        self.total = total


class FakeClient:
    """Implements only what :class:`app.tg.exporter.ExportEngine` calls."""

    def __init__(
        self,
        messages: list[FakeMessage],
        *,
        fail_first_download: bool = False,
        hang_iter_after: int | None = None,
        hang_download: bool = False,
    ) -> None:
        self.messages = messages
        self.downloads: list[str] = []
        self.fail_first_download = fail_first_download
        # Reproduce the failure seen in production: Telegram accepts the
        # request and simply never answers. Without a timeout this hangs the
        # export forever with no error at all.
        self.hang_iter_after = hang_iter_after
        self.hang_download = hang_download
        self._failed_once = False
        #: Fail this many attempts per file before succeeding (transient errors).
        self.flaky_attempts = 0
        #: Write half the file, then fail — exercises resume-from-offset.
        self.partial_fail_once = False
        self.resumed: list[str] = []
        self._attempts: dict[str, int] = {}

    def is_connected(self) -> bool:
        return True

    async def is_user_authorized(self) -> bool:
        return True

    async def get_entity(self, value: Any) -> Any:
        return FakeAttr()

    async def get_input_entity(self, value: Any) -> Any:
        return FakeAttr()

    async def get_messages(self, entity: Any, limit: int | None = None, ids: Any = None) -> Any:
        if ids is not None:
            if isinstance(ids, (list, tuple, set)):
                wanted = set(ids)
                return [m for m in self.messages if m.id in wanted]
            for message in self.messages:
                if message.id == ids:
                    return message
            return None
        return FakeTotal(len(self.messages))

    def iter_download(self, message: Any, offset: int = 0, request_size: int = 524288, **_: Any):
        """Byte stream from ``offset`` — what the resume path uses."""
        size = getattr(getattr(message, "file", None), "size", 0) or 512
        self.resumed.append(f"{getattr(message, 'id', '?')}@{offset}")

        async def generator():
            position = offset
            while position < size:
                step = min(request_size, size - position)
                await asyncio.sleep(0)
                yield b"\x00" * step
                position += step

        return generator()

    def iter_messages(self, entity: Any, **kwargs: Any):
        reverse = kwargs.get("reverse", True)
        min_id = kwargs.get("min_id")
        limit = kwargs.get("limit")

        selected = [m for m in self.messages if not min_id or m.id > min_id]
        selected.sort(key=lambda m: m.id, reverse=not reverse)
        if limit:
            selected = selected[:limit]

        async def generator():
            for index, message in enumerate(selected):
                if self.hang_iter_after is not None and index >= self.hang_iter_after:
                    await asyncio.sleep(3600)  # never answers
                await asyncio.sleep(0)
                yield message

        return generator()

    async def download_media(
        self, message: Any, file: str | None = None, progress_callback=None, **_: Any
    ) -> str | None:
        if self.hang_download:
            await asyncio.sleep(3600)  # never answers
        if self.fail_first_download and not self._failed_once:
            self._failed_once = True
            raise OSError("simulated network hiccup")

        size = getattr(getattr(message, "file", None), "size", 0) or 512
        path = Path(file)
        path.parent.mkdir(parents=True, exist_ok=True)

        attempts = self._attempts.get(str(path), 0) + 1
        self._attempts[str(path)] = attempts

        if self.partial_fail_once and attempts == 1:
            # Leave a real partial file behind, like a dropped connection would.
            half = max(1, size // 2)
            path.write_bytes(b"\x00" * half)
            if progress_callback:
                progress_callback(half, size)
            raise ConnectionError("simulated drop mid-transfer")

        if self.flaky_attempts and attempts <= self.flaky_attempts:
            raise ConnectionError(f"simulated transient failure #{attempts}")

        path.write_bytes(b"\x00" * size)
        if progress_callback:
            progress_callback(size, size)
        self.downloads.append(str(path))
        return str(path)

    def takeout(self, **_: Any):
        raise RuntimeError("takeout not available in tests")

    # -- dialogs --------------------------------------------------------

    def iter_dialogs(self, limit: int | None = None, archived: bool | None = None, **_: Any):
        dialogs = build_dialogs()
        if archived is True:
            dialogs = [d for d in dialogs if d.archived]
        elif archived is False:
            dialogs = [d for d in dialogs if not d.archived]
        if limit:
            dialogs = dialogs[:limit]

        async def generator():
            for dialog in dialogs:
                await asyncio.sleep(0)
                yield dialog

        return generator()

    async def download_profile_photo(self, entity: Any, file: str | None = None, **_: Any):
        # Sender 502 deliberately has no avatar, to exercise the "skipped"
        # branch alongside the success path.
        if getattr(entity, "id", None) == 502:
            return None
        path = Path(file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00" * 256)
        self.downloads.append(str(path))
        return str(path)


class FakeDialog(FakeAttr):
    def __init__(self, dialog_id: int, entity: Any, *, archived: bool = False,
                 pinned: bool = False, unread: int = 0) -> None:
        self.id = dialog_id
        self.entity = entity
        self.archived = archived
        self.pinned = pinned
        self.unread_count = unread
        self.date = datetime(2026, 2, 1, tzinfo=timezone.utc)
        self.message = FakeAttr()
        self.folder_id = 1 if archived else 0


def build_dialogs() -> list["FakeDialog"]:
    """A realistic dialog mix: broadcast channel, supergroup, group, user, bot.

    Real Telethon types are used here because ``dialogs.classify`` dispatches on
    ``isinstance`` — a duck-typed stand-in would silently take the wrong branch.
    """
    from telethon.tl import types

    channel = types.Channel(
        id=1001, title="Новостной канал", photo=None, date=None,
        broadcast=True, megagroup=None, username="news_channel",
        participants_count=15000, verified=True, access_hash=111,
    )
    supergroup = types.Channel(
        id=1002, title="Чат сообщества", photo=None, date=None,
        broadcast=None, megagroup=True, username="community",
        participants_count=430, access_hash=222,
    )
    group = types.Chat(
        id=1003, title="Семейный чат", photo=None, date=None,
        participants_count=5, version=1,
    )
    user = types.User(id=1004, first_name="Пётр", last_name="Иванов", username="petr")
    bot = types.User(id=1005, first_name="HelperBot", username="helper_bot", bot=True)

    return [
        FakeDialog(-1001001, channel, pinned=True, unread=3),
        FakeDialog(-1001002, supergroup, unread=12),
        FakeDialog(-1003, group, archived=True),
        FakeDialog(1004, user, unread=1),
        FakeDialog(1005, bot),
    ]


def build_messages(count: int = 12) -> list[FakeMessage]:
    """A representative mix: text, photos, video notes, voice, docs, service."""
    base = datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc)
    alice = FakeSender(501, "Алиса", "alice")
    bob = FakeSender(502, "Bob", None)
    kinds = ["none", "photo", "video_note", "voice", "document", "video", "sticker", "animation"]
    messages: list[FakeMessage] = []
    for index in range(count):
        kind = kinds[index % len(kinds)]
        messages.append(
            FakeMessage(
                index + 1,
                base + timedelta(days=index * 3, minutes=index),
                kind=kind,
                text=f"Сообщение №{index + 1}" if kind == "none" else f"Подпись {index + 1}",
                sender=alice if index % 2 == 0 else bob,
                size=1024 * (index + 1),
                views=100 + index,
            )
        )
    return messages
