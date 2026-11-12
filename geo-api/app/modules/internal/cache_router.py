"""内部缓存失效接口（路径 B，备选；需 REDIS_INTERNAL_TOKEN）。"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core import cache_invalidation
from app.modules.crm.crm_list_cache import invalidate_crm_caches_for_users

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/cache", tags=["internal-cache"])


class InvalidateBody(BaseModel):
    type: Literal[
        "auth_user",
        "rbac_bump",
        "mention_scopes",
        "org_sync",
        "crm_users",
        "feishu",
    ]
    userId: str | None = None
    userIds: list[str] = Field(default_factory=list)
    permissionAffectingChanges: int = 0


def _require_internal_token(x_internal_token: str | None) -> None:
    expected = (get_settings().redis_internal_token or "").strip()
    if not expected:
        raise HTTPException(status_code=404, detail="internal cache API disabled")
    if not x_internal_token or x_internal_token.strip() != expected:
        raise HTTPException(status_code=403, detail="forbidden")


@router.post("/invalidate")
async def invalidate_cache(
    body: InvalidateBody,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    _require_internal_token(x_internal_token)
    action = body.type
    if action == "auth_user":
        if not body.userId:
            raise HTTPException(status_code=400, detail="userId required")
        await cache_invalidation.invalidate_after_user_rbac_change(body.userId)
    elif action == "rbac_bump":
        await cache_invalidation.invalidate_after_role_matrix_change()
    elif action == "mention_scopes":
        await cache_invalidation.invalidate_mention_scopes()
    elif action == "org_sync":
        await cache_invalidation.invalidate_after_org_sync(
            permission_affecting_changes=body.permissionAffectingChanges,
        )
    elif action == "crm_users":
        ids = list(body.userIds)
        if body.userId:
            ids.append(body.userId)
        await invalidate_crm_caches_for_users(ids)
    elif action == "feishu":
        await cache_invalidation.invalidate_feishu_caches()
    else:
        raise HTTPException(status_code=400, detail="unknown type")
    logger.info("internal cache invalidate type=%s userId=%s", action, body.userId)
    return {"ok": True, "type": action}
