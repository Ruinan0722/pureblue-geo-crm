from __future__ import annotations

from typing import Literal

from app.modules.auth.schemas import CamelModel


class InviteRecord(CamelModel):
    id: str
    # 列表直接返回明文 token / url（不做脱敏）
    token: str | None = None
    staff_user_id: str
    staff_name: str | None = None
    label: str | None = None
    geo_variant: Literal["overseas", "domestic"] = "overseas"
    revoked_at: str | None = None
    visit_count: int = 0
    created_at: str
    url: str | None = None
    active: bool | None = None
    is_fixed: bool = False


class InviteListResponse(CamelModel):
    invites: list[InviteRecord]


class ResolveInviteResponse(CamelModel):
    valid: bool
    staff_name: str | None = None
    reason: Literal["revoked", "invalid"] | None = None
    # 邀请存在时返回，供 /c/[token] 入口决定国内/海外填报（不依赖 ?v=cn）
    geo_variant: Literal["overseas", "domestic"] | None = None
