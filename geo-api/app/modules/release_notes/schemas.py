from __future__ import annotations

from pydantic import Field

from app.modules.auth.schemas import CamelModel


class ReleaseNoteOut(CamelModel):
    version: str
    title: str
    body: str
    published_at: str


class UpsertReleaseNoteBody(CamelModel):
    version: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    published_at: str | None = None
