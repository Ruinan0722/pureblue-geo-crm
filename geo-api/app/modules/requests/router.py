from __future__ import annotations

import io
from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import AuthContext, get_auth_context, require_user
from app.core.exceptions import AppError
from app.modules.auth.schemas import AuthUser
from app.modules.requests.export_data import build_pdf, build_xlsx
from app.modules.requests.schemas import (
    CreateRequestBody,
    ExportRequestsBody,
    PatchRequestBody,
    RequestListResponse,
    RequestRecord,
    RequestStatsResponse,
)
from app.modules.requests.service import RequestService

router = APIRouter(prefix="/requests", tags=["requests"])


def _http_error(exc: AppError):
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.get("", response_model=RequestListResponse)
async def list_requests(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    opportunity_id: str | None = Query(default=None, alias="opportunityId"),
    geo_source: str | None = Query(default=None, alias="geoSource"),
    region: str | None = Query(default=None),
    goal: str | None = Query(default=None),
    submitted_from: str | None = Query(default=None, alias="submittedFrom"),
    submitted_to: str | None = Query(default=None, alias="submittedTo"),
    mine_only: bool = Query(default=False, alias="mineOnly"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> RequestListResponse:
    try:
        data = await RequestService(db).search_for_user(
            user,
            keyword=keyword,
            status=status_filter,
            opportunity_id=opportunity_id,
            geo_source=geo_source,
            region=region,
            goal=goal,
            submitted_from=submitted_from,
            submitted_to=submitted_to,
            mine_only=mine_only,
            page=page,
            page_size=page_size,
        )
        return RequestListResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/stats", response_model=RequestStatsResponse)
async def request_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    mine_only: bool = Query(default=False, alias="mineOnly"),
) -> RequestStatsResponse:
    try:
        data = await RequestService(db).get_stats(user, mine_only=mine_only)
        return RequestStatsResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/export/excel")
async def export_requests_excel(
    body: ExportRequestsBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> StreamingResponse:
    try:
        records = await RequestService(db).export_records(user, body.ids)
    except AppError as e:
        _http_error(e)
        raise
    content = build_xlsx(records)
    filename = f"需求导出-{datetime.now().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.post("/export/pdf")
async def export_requests_pdf(
    body: ExportRequestsBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> StreamingResponse:
    try:
        records = await RequestService(db).export_records(user, body.ids)
    except AppError as e:
        _http_error(e)
        raise
    content = build_pdf(records)
    filename = f"需求导出-{datetime.now().strftime('%Y%m%d-%H%M%S')}.pdf"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.post("", response_model=RequestRecord, status_code=status.HTTP_201_CREATED)
async def create_request(
    body: CreateRequestBody,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> RequestRecord:
    try:
        return await RequestService(db).create(body, ctx)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/{request_id}", response_model=RequestRecord)
async def get_request(
    request_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> RequestRecord:
    try:
        return await RequestService(db).get_detail(request_id, user)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/{request_id}", response_model=RequestRecord)
async def patch_request(
    request_id: str,
    body: PatchRequestBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> RequestRecord:
    try:
        return await RequestService(db).patch(request_id, body, user)
    except AppError as e:
        _http_error(e)
        raise
