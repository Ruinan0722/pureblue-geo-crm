from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.deps import user_data_scope
from app.core.geo_scope import forced_geo_source
from app.models.channel import ChannelPartner
from app.modules.auth.schemas import AuthUser

def require_partner_permission(user: AuthUser, permission: str | None = None) -> None:
    permissions = set(user.permissions or [])
    if "section:channels" not in permissions:
        raise HTTPException(status_code=403, detail="无权访问合作伙伴档案")
    if permission and permission not in permissions and "channels:write" not in permissions:
        raise HTTPException(status_code=403, detail="无权执行该合作伙伴操作")

async def managed_partner_owner_ids(db: AsyncSession, user: AuthUser) -> set[str]:
    scope = user_data_scope(user)
    if scope == "department":
        from app.modules.users.repository import UsersRepository
        return set(await UsersRepository(db).get_managed_scope_user_ids(user.id))
    return {user.id} if scope == "own" else set()

def partner_visible(user: AuthUser, row: ChannelPartner, managed_ids: set[str]) -> bool:
    # 伙伴档案目前为国内/manual 业务，不能被海外 all 范围旁路读取。
    if forced_geo_source(user):
        return False
    return user_data_scope(user) == "all" or bool(row.owner_user_id and row.owner_user_id in managed_ids)

async def require_partner(db: AsyncSession, user: AuthUser, partner_id: str) -> ChannelPartner:
    require_partner_permission(user)
    row = await db.get(ChannelPartner, partner_id)
    if row is None or not partner_visible(user, row, await managed_partner_owner_ids(db, user)):
        raise HTTPException(status_code=404, detail="合作伙伴不存在或无权访问")
    return row
