"""Request bodies.

Responses are built as plain dicts by the service layer so that the JSON shape
is guaranteed to match ``docs/CONTRACT.md`` §4 field-for-field, with no
model-to-model translation drifting away from it over time.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.services.options import ExportOptions


class AccountCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str = Field(default="", max_length=128)
    api_id: int | None = None
    api_hash: str | None = Field(default=None, max_length=64)
    proxy: str | None = Field(default=None, max_length=255)


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str | None = Field(default=None, max_length=128)
    proxy: str | None = Field(default=None, max_length=255)


class PhoneRequest(BaseModel):
    phone: str = Field(min_length=5, max_length=32)


class CodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16)


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    archived: bool | None = None
    limit: int | None = Field(default=None, ge=1)
    with_avatars: bool = True


class CreateJobRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account_id: int
    chat_id: int
    options: ExportOptions = Field(default_factory=ExportOptions)


class RebuildRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    formats: list[str] | None = None
    layout: str | None = None
    sort_field: str | None = None
    sort_order: str | None = None


class OpenFolderRequest(BaseModel):
    path: str
