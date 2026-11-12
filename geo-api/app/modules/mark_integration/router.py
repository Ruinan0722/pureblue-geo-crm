from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.exceptions import AppError
from app.modules.mark_integration.auth import require_integration_auth
from app.modules.mark_integration.schemas import (
    IntegrationEnvelope,
    MarkMaterialEvent,
    UnifiedLeadEvent,
)
from app.modules.mark_integration.service import MarkIntegrationService

router = APIRouter(
    prefix="/integrations",
    tags=["lead-integration"],
    dependencies=[Depends(require_integration_auth)],
)


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "") or request.headers.get("X-Request-Id") or "")


def _error(exc: AppError) -> None:
    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 422,
        "conflict": 409,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.post(
    "/leads",
    response_model=IntegrationEnvelope,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_integrated_lead(
    body: UnifiedLeadEvent,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> JSONResponse:
    """官网、36氪、Mark 统一入站接口。"""
    try:
        authenticated_platform = str(getattr(request.state, "integration_platform", ""))
        body_platform = str(body.platform_code or "")
        if body_platform and authenticated_platform and body_platform != authenticated_platform:
            raise HTTPException(status_code=403, detail="platformCode 与认证平台不一致")
        platform = body_platform or authenticated_platform
        if not platform:
            raise HTTPException(status_code=422, detail="缺少必填字段：platformCode")
        result = await MarkIntegrationService(db).receive_lead(platform, body)  # type: ignore[arg-type]
        payload = IntegrationEnvelope(
            message="accepted",
            request_id=_request_id(request),
            data=result.model_dump(mode="json", by_alias=True, exclude_none=True),
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=payload.model_dump(mode="json", by_alias=True),
        )
    except AppError as exc:
        _error(exc)
        raise


@router.post(
    "/mark/leads/{crm_lead_id}/materials",
    response_model=IntegrationEnvelope,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_mark_materials(
    crm_lead_id: str,
    body: MarkMaterialEvent,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> JSONResponse:
    """Mark 通知 CRM S3 PDF 地址，由 CRM 异步下载归档。"""
    if getattr(request.state, "integration_platform", "") != "mark":
        raise HTTPException(status_code=403, detail="该接口仅允许 Mark 调用")
    try:
        result = await MarkIntegrationService(db).receive_material(crm_lead_id, body)
        payload = IntegrationEnvelope(
            message="accepted",
            request_id=_request_id(request),
            data=result.model_dump(mode="json", by_alias=True),
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=payload.model_dump(mode="json", by_alias=True),
        )
    except AppError as exc:
        _error(exc)
        raise
