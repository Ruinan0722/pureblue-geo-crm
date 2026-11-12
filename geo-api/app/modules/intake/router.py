"""客户填报侧写入口：与员工 requests CRUD 分离，供海外 intake / ALB 只暴露写入。"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.exceptions import AppError
from app.modules.requests.schemas import IntakeSubmitBody, IntakeSubmitResponse
from app.modules.requests.service import RequestService

router = APIRouter(prefix="/intake", tags=["intake"])


def _http_error(exc: AppError) -> None:
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.post(
    "/submit",
    response_model=IntakeSubmitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="客户邀请链接提交需求（只写）",
)
async def submit_intake_request(
    body: IntakeSubmitBody,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> IntakeSubmitResponse:
    """公开填报写入口：验真 inviteToken + 表单后入库；同一邀请幂等；不依赖员工 JWT。"""
    try:
        return await RequestService(db).submit_from_invite(body)
    except AppError as e:
        _http_error(e)
        raise
