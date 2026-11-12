"""内部 RBAC 运维接口（X-Internal-Token）：供本地 CLI/部署脚本调用，替代脚本直连 MySQL。"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db_session
from app.modules.rbac.service import RbacService

router = APIRouter(prefix="/internal/rbac", tags=["internal-rbac"])


class MemberProfile(BaseModel):
    feishuOpenId: str
    name: str
    departmentOpenId: str
    departmentName: str
    breadcrumb: str = ""
    leader: bool = False
    note: str | None = None


class SyncMemberProfilesBody(BaseModel):
    profiles: list[MemberProfile] = Field(default_factory=list)


def _require_internal_token(x_internal_token: str | None) -> None:
    expected = (get_settings().redis_internal_token or "").strip()
    if not expected:
        raise HTTPException(status_code=404, detail="internal RBAC API disabled")
    if not x_internal_token or x_internal_token.strip() != expected:
        raise HTTPException(status_code=403, detail="forbidden")


@router.post("/sync-member-profiles")
async def sync_member_profiles(
    body: SyncMemberProfilesBody,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _require_internal_token(x_internal_token)
    updated = await RbacService(db).sync_member_profiles(
        [p.model_dump() for p in body.profiles]
    )
    return {"ok": True, "updated": updated}
