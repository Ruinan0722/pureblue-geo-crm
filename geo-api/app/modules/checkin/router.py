from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import AppError
from app.modules.auth.schemas import AuthUser
from app.modules.checkin.attachment_store import (
    build_attachment_db_records,
    delete_attachment,
    load_attachment,
    save_upload_files,
)
from app.modules.checkin.schemas import (
    CheckinAttachment,
    CheckinAttachmentUploadResponse,
    CheckinRecord,
    CheckinStats,
    CheckinType,
    CreateCheckinBody,
)
from app.modules.checkin.service import CheckinService

router = APIRouter(prefix="/checkin", tags=["checkin"])


def _http_error(exc: AppError):
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.post("/attachments", response_model=CheckinAttachmentUploadResponse)
async def upload_checkin_attachments(
    user: Annotated[AuthUser, Depends(require_user)],
    files: Annotated[list[UploadFile], File(description="现场照片")],
) -> CheckinAttachmentUploadResponse:
    try:
        ids = await save_upload_files(files, uploaded_by=user.id)
        records = build_attachment_db_records(ids)
        attachments = [
            CheckinAttachment(
                id=str(item["id"]),
                url=str(item["url"]),
                storage_path=str(item["storagePath"]),
                original_name=item.get("originalName"),
                content_type=item.get("contentType"),
                size=item.get("size") if isinstance(item.get("size"), int) else None,
                uploaded_at=item.get("uploadedAt"),
                uploaded_by=item.get("uploadedBy"),
            )
            for item in records
        ]
        return CheckinAttachmentUploadResponse(attachment_ids=ids, attachments=attachments)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/attachments/{attachment_id}")
async def get_checkin_attachment(
    attachment_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        await CheckinService(db).assert_attachment_access(user, attachment_id)
        stored = load_attachment(attachment_id)
        return FileResponse(
            path=stored.path,
            media_type=stored.content_type,
            filename=stored.original_name,
            content_disposition_type="inline",
        )
    except AppError as e:
        _http_error(e)
        raise


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_checkin_attachment(
    attachment_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
) -> None:
    try:
        delete_attachment(attachment_id, user_id=user.id)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/active-visit")
async def get_active_visit(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, str | None]:
    try:
        visit_id = await CheckinService(db).get_active_visit_id(user)
        return {"activeVisitId": visit_id}
    except AppError as e:
        _http_error(e)
        raise


@router.get("", response_model=list[CheckinRecord])
async def list_checkin_records(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    scope: Literal["own", "team"] = Query(default="own"),
    user_id: str | None = Query(default=None, alias="userId"),
    record_type: CheckinType | None = Query(default=None, alias="type"),
    from_ts: int | None = Query(default=None, alias="from"),
    to_ts: int | None = Query(default=None, alias="to"),
) -> list[CheckinRecord]:
    try:
        return await CheckinService(db).list_records(
            user,
            scope=scope,
            user_id=user_id,
            record_type=record_type,
            from_ts=from_ts,
            to_ts=to_ts,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/stats", response_model=CheckinStats)
async def get_checkin_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    scope: Literal["own", "team"] = Query(default="team"),
    user_id: str | None = Query(default=None, alias="userId"),
    record_type: CheckinType | None = Query(default=None, alias="type"),
    from_ts: int | None = Query(default=None, alias="from"),
    to_ts: int | None = Query(default=None, alias="to"),
) -> CheckinStats:
    try:
        return await CheckinService(db).get_stats(
            user,
            scope=scope,
            user_id=user_id,
            record_type=record_type,
            from_ts=from_ts,
            to_ts=to_ts,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.post("", response_model=CheckinRecord, status_code=status.HTTP_201_CREATED)
async def create_checkin_record(
    body: CreateCheckinBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> CheckinRecord:
    try:
        return await CheckinService(db).create(user, body)
    except AppError as e:
        _http_error(e)
        raise
