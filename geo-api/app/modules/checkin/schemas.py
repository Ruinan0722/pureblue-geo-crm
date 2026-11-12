from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.modules.auth.schemas import CamelModel

CheckinType = Literal["arrive", "leave"]


class CheckinAttachment(CamelModel):
    """打卡附件：库内可直接看到 id / url / 本地路径。"""

    id: str
    url: str
    storage_path: str
    original_name: str | None = None
    content_type: str | None = None
    size: int | None = None
    uploaded_at: str | None = None
    uploaded_by: str | None = None


class CheckinRecord(CamelModel):
    id: str
    user_id: str
    user_name: str
    department_names: list[str] = Field(default_factory=list)
    visit_id: str
    type: CheckinType
    timestamp: int
    beijing_time: str
    latitude: float
    longitude: float
    accuracy: float | None = None
    address: str
    province: str | None = None
    city: str | None = None
    district: str | None = None
    attachment_ids: list[str] | None = None
    attachments: list[CheckinAttachment] = Field(default_factory=list)


class CreateCheckinBody(CamelModel):
    visit_id: str
    type: CheckinType
    timestamp: int
    beijing_time: str
    latitude: float
    longitude: float
    accuracy: float | None = None
    address: str
    province: str | None = None
    city: str | None = None
    district: str | None = None
    attachment_ids: list[str] | None = None


class CheckinAttachmentUploadResponse(CamelModel):
    attachment_ids: list[str] = Field(default_factory=list)
    attachments: list[CheckinAttachment] = Field(default_factory=list)


class CheckinUserBreakdown(CamelModel):
    user_id: str
    user_name: str
    count: int
    arrive_count: int
    leave_count: int


class CheckinStats(CamelModel):
    total: int
    arrive_count: int
    leave_count: int
    unique_users: int
    user_breakdown: list[CheckinUserBreakdown] = Field(default_factory=list)
