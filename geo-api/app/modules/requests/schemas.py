from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.modules.auth.schemas import CamelModel

RequestStatus = Literal[
    "draft",
    "submitted",
    # 历史遗留兼容值（不在需求管理筛选/动作中使用，仅保证存量数据渲染）
    "supplement",
    "pending_review",
    "confirmed",
    "in_project",
    # 历史遗留兼容值（不在需求管理筛选/动作中使用，仅保证存量数据渲染）
    "closed",
    # 兼容 geo-api 旧枚举
    "reviewing",
    "approved",
    "rejected",
]


class NoteItem(CamelModel):
    id: str
    author: str
    content: str
    created_at: str


class RequestAttachmentItem(CamelModel):
    id: str
    name: str
    size: int = 0
    uploaded_at: str = ""
    uploaded_by: str = ""
    url: str | None = None
    content_type: str | None = None
    storage_path: str | None = None
    description: str | None = None


class RequestInviteInfo(CamelModel):
    id: str
    label: str | None = None
    url: str
    created_at: str
    active: bool = True


class RequestRecord(CamelModel):
    id: str
    code: str
    status: RequestStatus
    submitted_at: str
    updated_at: str
    owner: str
    staff_user_id: str | None = None
    owner_employment_status: Literal["active", "resigned"] | None = None
    invite_id: str | None = None
    invite: RequestInviteInfo | None = None
    opportunity_id: str | None = None
    data: dict[str, Any]
    notes: list[NoteItem] = Field(default_factory=list)
    attachments: list[RequestAttachmentItem] = Field(default_factory=list)
    reused: bool = False
    """已停用的历史兼容字段；不再联动商机。"""
    synced_opportunity: dict[str, Any] | None = None


class CreateRequestBody(CamelModel):
    data: dict[str, Any]
    status: Literal["submitted", "draft"] = "submitted"
    invite_token: str | None = None


class IntakeSubmitBody(CamelModel):
    """海外客户最终提交：invite token 必须在 body 中传递（不依赖员工 JWT / Cookie 鉴权）。"""

    data: dict[str, Any]
    invite_token: str
    status: Literal["submitted"] = "submitted"


class IntakeSubmitResponse(CamelModel):
    """只写接口最小响应，避免通过公网回传完整需求单。"""

    code: str
    reused: bool = False


class PatchRequestBody(CamelModel):
    data: dict[str, Any] | None = None
    status: RequestStatus | None = None
    owner: str | None = None
    opportunity_id: str | None = None
    note: str | None = None
    author: str | None = None
    """全量替换附件列表（前端追加后回写）。"""
    attachments: list[RequestAttachmentItem] | None = None


class RequestStatsResponse(CamelModel):
    total: int = 0
    submitted: int = 0
    pending: int = 0
    confirmed: int = 0
    in_project: int = 0
    supplement: int = 0


class ExportRequestsBody(CamelModel):
    """批量导出：勾选的需求 id 列表。"""

    ids: list[str] = Field(default_factory=list, min_length=1, max_length=200)


class RequestListResponse(CamelModel):
    items: list[RequestRecord] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10
