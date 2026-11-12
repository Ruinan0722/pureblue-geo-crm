from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import AppError
from app.modules.auth.schemas import AuthUser
from app.modules.invites.schemas import InviteListResponse, ResolveInviteResponse
from app.modules.invites.service import InviteService

router = APIRouter(prefix="/invites", tags=["invites"])


def _http_error(exc: AppError):
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.get("", response_model=InviteListResponse)
async def list_invites(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> InviteListResponse:
    try:
        return await InviteService(db).list_for_user(user)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/resolve/{token}", response_model=ResolveInviteResponse)
async def resolve_invite(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    count_visit: bool = False,
) -> ResolveInviteResponse:
    return await InviteService(db).resolve(token, count_visit=count_visit)
