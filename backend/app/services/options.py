"""The ``ExportOptions`` model — contract §4.6.

Lives in its own module so both the API layer and the export engine can import
it without a circular dependency.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MediaKind = Literal[
    "photo", "video", "video_note", "voice", "audio", "document", "sticker", "animation"
]

LayoutStrategy = Literal[
    "flat",
    "by_type",
    "by_date",
    "by_date_type",
    "by_type_date",
    "by_sender",
    "by_album",
    "by_size",
]

SortField = Literal["date", "type", "sender", "size", "views", "id"]
OutputFormat = Literal["json", "jsonl", "html", "csv", "txt"]

def _default_concurrency() -> int:
    """Default parallel downloads, from ``TGV_DOWNLOAD_CONCURRENCY``."""
    from app.config import settings

    return max(1, min(16, settings.download_concurrency))


ALL_MEDIA_KINDS: list[str] = [
    "photo",
    "video",
    "video_note",
    "voice",
    "audio",
    "document",
    "sticker",
    "animation",
]


class ExportOptions(BaseModel):
    """Everything the user can tune for one export run."""

    model_config = ConfigDict(extra="ignore", validate_assignment=True)

    # --- what to fetch ---------------------------------------------------
    download_media: bool = True
    media_types: list[MediaKind] = Field(default_factory=lambda: list(ALL_MEDIA_KINDS))
    include_service_messages: bool = True
    include_text_only: bool = True
    date_from: datetime | None = None
    date_to: datetime | None = None
    min_id: int | None = None
    max_id: int | None = None
    limit: int | None = Field(default=None, ge=1)
    max_file_size_mb: int | None = Field(default=None, ge=1)
    search: str | None = None

    # --- how to fetch ----------------------------------------------------
    order: Literal["asc", "desc"] = "asc"
    concurrency: int = Field(
        default_factory=lambda: _default_concurrency(), ge=1, le=16
    )
    use_takeout: bool = False
    skip_existing: bool = True
    incremental: bool = True
    download_thumbs: bool = False
    download_avatars: bool = False

    #: Keep retrying a file until it downloads. With a handful of attempts a
    #: long export quietly loses files to transient network errors — and a
    #: partial archive is worse than a slow one. Permanent errors (deleted
    #: media, revoked access) still stop immediately.
    retry_forever: bool = True
    #: Hard ceiling per file even in retry_forever mode, as a runaway guard.
    max_attempts: int = Field(default=200, ge=1, le=10_000)
    #: Continue an interrupted file from where it stopped instead of restarting.
    resume_partial: bool = True
    #: After the main pass, sweep everything still missing and retry it.
    final_sweep: bool = True

    # --- how to lay out --------------------------------------------------
    layout: LayoutStrategy = "by_type_date"
    sort_field: SortField = "date"
    sort_order: Literal["asc", "desc"] = "asc"
    filename_template: str = "{date}_{id}_{name}"

    # --- what to produce -------------------------------------------------
    formats: list[OutputFormat] = Field(default_factory=lambda: ["json", "html"])
    output_dir: str | None = None

    @field_validator("media_types")
    @classmethod
    def _dedupe_media(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen or list(ALL_MEDIA_KINDS)

    @field_validator("formats")
    @classmethod
    def _dedupe_formats(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen or ["json"]

    @field_validator("filename_template")
    @classmethod
    def _non_empty_template(cls, value: str) -> str:
        return value.strip() or "{date}_{id}_{name}"

    @field_validator("date_from", "date_to", mode="before")
    @classmethod
    def _strip_tz(cls, value):
        """Normalise incoming ISO strings to naive UTC, matching the DB."""
        if value in (None, ""):
            return None
        if isinstance(value, str):
            raw = value.replace("Z", "+00:00")
            try:
                value = datetime.fromisoformat(raw)
            except ValueError:
                try:
                    value = datetime.strptime(raw[:10], "%Y-%m-%d")
                except ValueError:
                    return None
        if isinstance(value, datetime) and value.tzinfo is not None:
            from datetime import timezone

            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @property
    def max_file_size_bytes(self) -> int | None:
        return self.max_file_size_mb * 1024 * 1024 if self.max_file_size_mb else None

    def wants(self, kind: str) -> bool:
        """Should a file of this kind be downloaded?"""
        return self.download_media and kind in self.media_types
