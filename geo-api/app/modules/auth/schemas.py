from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def to_camel(string: str) -> str:
    parts = string.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class AuthUser(CamelModel):
    id: str
    feishu_open_id: str
    name: str
    avatar_url: str | None = None
    role: str
    role_label: str = ""
    roles: list[str] = Field(default_factory=list)
    permissions: list[str]
    data_scope: str = "own"
    department_names: list[str] = Field(default_factory=list)
    role_source: str = "feishu"
    role_locked: bool = False
    manual_department_open_id: str | None = None
    manual_department_name: str | None = None
    manual_department_note: str | None = None
    manual_department_leader: bool = False
    feishu_led_department_ids: list[Any] = Field(default_factory=list)


class MeResponse(CamelModel):
    user: AuthUser | None = None
    feishu_configured: bool = False


class LogoutResponse(CamelModel):
    ok: bool = True


class FeishuTokenRequest(CamelModel):
    code: str


class FeishuTokenResponse(CamelModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: AuthUser


class DevLoginIn(CamelModel):
    """开发/Staging 测试身份：本地写入 dev 用户并签发 JWT。"""

    name: str = "开发测试"
    role: str = "sales"
