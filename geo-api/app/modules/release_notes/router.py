from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import AppError
from app.core.geo_features import is_feature_enabled
from app.modules.auth.schemas import AuthUser
from app.modules.release_notes.schemas import ReleaseNoteOut, UpsertReleaseNoteBody
from app.modules.release_notes.service import ReleaseNotesService

router = APIRouter(prefix="/release-notes", tags=["release-notes"])


def _http_error(exc: AppError) -> None:
    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


def _require_release_notes_enabled() -> None:
    if not is_feature_enabled("RELEASE_NOTES"):
        raise HTTPException(status_code=404, detail="更新说明已关闭")


@router.get("/{version}", response_model=ReleaseNoteOut)
async def get_release_note(
    version: str,
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    """更新说明只读；不强制登录，避免管理端首屏鉴权竞态导致不弹窗。"""
    _require_release_notes_enabled()
    try:
        return await ReleaseNotesService(db).get_by_version(version)
    except AppError as exc:
        _http_error(exc)


@router.put("", response_model=ReleaseNoteOut)
async def upsert_release_note(
    body: UpsertReleaseNoteBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    """管理员 upsert；本地/发版写入更新说明。"""
    _require_release_notes_enabled()
    try:
        return await ReleaseNotesService(db).upsert(user, body)
    except AppError as exc:
        _http_error(exc)
