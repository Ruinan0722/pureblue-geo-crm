from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.feishu import fetch_sales_department_members, is_feishu_configured
from app.modules.users.contacts_repository import ContactsRepository
from app.modules.users.contacts_sync import _resolve_department_names
from app.modules.users.repository import UsersRepository
from app.modules.users.role_resolver import get_sales_department_names
from app.modules.users.schemas import (
    DirectManagerResponse,
    DirectoryMember,
    DirectoryResponse,
    SalesColleague,
    SalesColleaguesResponse,
)


class UsersService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.contacts_repo = ContactsRepository(db)
        self.users_repo = UsersRepository(db)

    @staticmethod
    def _department_match(user_depts: list[str], filters: list[str]) -> bool:
        if not filters:
            return True
        normalized = [str(d or "").strip() for d in user_depts if str(d or "").strip()]
        if not normalized:
            return False
        for want in filters:
            for have in normalized:
                if want == have or want in have or have in want:
                    return True
        return False

    async def list_directory(
        self,
        *,
        mention_scope: str | None = None,
        roles: list[str] | None = None,
        department_names: list[str] | None = None,
        viewer_user_id: str | None = None,
        managed_only: bool = False,
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> DirectoryResponse:
        from app.modules.users.directory_cache import get_or_load_directory_active

        role_set = {r.strip() for r in (roles or []) if r.strip()}
        dept_filters = [d.strip() for d in (department_names or []) if d.strip()]
        filtered = bool(role_set or dept_filters)

        if filtered:
            # 部门/角色下拉：直查库，仅飞书正式成员（ou_），不走全员缓存
            rows = await self.users_repo.list_active_directory()
            members = [
                DirectoryMember(
                    id=row.id,
                    name=row.name,
                    role=row.role or "",
                    department_names=row.department_names
                    if isinstance(row.department_names, list)
                    else [],
                )
                for row in rows
                if (
                    str(row.feishu_open_id or "").startswith("ou_")
                    # 开发/测试占位成员（seed_dev_crm 的 ou-dev-*、dev_login 的 dev_*），
                    # 仅非生产环境存在，保证角色下拉在联调时可选。
                    or str(row.feishu_open_id or "").startswith("ou-")
                    or str(row.feishu_open_id or "").startswith("dev_")
                )
                and (
                    (role_set and (row.role or "") in role_set)
                    or (
                        dept_filters
                        and self._department_match(
                            row.department_names if isinstance(row.department_names, list) else [],
                            dept_filters,
                        )
                    )
                )
            ]
        else:

            async def _load() -> list[dict]:
                rows = await self.users_repo.list_active_directory()
                return [
                    {
                        "id": row.id,
                        "name": row.name,
                        "role": row.role or "",
                        "feishu_open_id": row.feishu_open_id or "",
                        "department_names": row.department_names
                        if isinstance(row.department_names, list)
                        else [],
                    }
                    for row in rows
                ]

            cached_members = await get_or_load_directory_active(_load)
            members = [
                DirectoryMember(
                    id=str(m.get("id") or ""),
                    name=str(m.get("name") or ""),
                    role=str(m.get("role") or ""),
                    department_names=list(m.get("department_names") or [])
                    if isinstance(m.get("department_names"), list)
                    else [],
                )
                for m in cached_members
                if m.get("id")
                and (
                    not mention_scope
                    or str(m.get("feishu_open_id") or "").startswith("ou_")
                )
                ]

        if managed_only:
            managed_ids = set(
                await self.users_repo.get_managed_scope_user_ids(viewer_user_id or "")
            )
            managed_ids.discard(viewer_user_id or "")
            members = [member for member in members if member.id in managed_ids]

        # @通知面向飞书组织架构中的全部在职成员。mention_scope / entity_* 仅保留为
        # 兼容旧客户端的查询参数，不再按角色权限或业务实体可见性收窄候选人。
        # 业务数据本身仍由各模块 API 独立执行 RBAC 与数据范围校验。

        return DirectoryResponse(members=members, source="mysql_users")

    async def list_sales_colleagues(self) -> SalesColleaguesResponse:
        department_label = "、".join(await get_sales_department_names(self.db)) or "销售部"

        if not is_feishu_configured():
            return SalesColleaguesResponse(
                colleagues=[],
                department_label=department_label,
                source=None,
            )

        # 优先读 MySQL 快照（定时同步）
        db_rows = await self.contacts_repo.list_active_sales_contacts()
        if db_rows:
            return SalesColleaguesResponse(
                colleagues=[
                    SalesColleague(
                        id=row.feishu_open_id,
                        name=row.name,
                        job_title=row.job_title,
                        department_names=row.department_names
                        if isinstance(row.department_names, list)
                        else [],
                    )
                    for row in db_rows
                ],
                department_label=department_label,
                source="database",
            )

        # 库为空时 fallback 飞书实时拉取（首次部署 / 同步未跑）
        try:
            members = await fetch_sales_department_members()
            return SalesColleaguesResponse(
                colleagues=[
                    SalesColleague(
                        id=m.feishu_open_id,
                        name=m.name,
                        job_title=m.job_title,
                        department_names=list(await _resolve_department_names(self.db, m.department_ids)),
                    )
                    for m in members
                ],
                department_label=department_label,
                source="feishu",
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def resolve_direct_manager(self, name: str) -> DirectManagerResponse:
        """按姓名查飞书直属上级（leader_user_id），用于合同签订人自动带入。"""
        from app.core.exceptions import NotFoundError, ValidationError
        from app.core.feishu.contact import fetch_feishu_user_detail

        trimmed = (name or "").strip()
        if not trimmed:
            raise ValidationError("请选择合同签订人")

        user = await self.users_repo.get_by_name(trimmed, active_only=True)
        if not user:
            raise NotFoundError(f"未找到员工「{trimmed}」")

        if not is_feishu_configured():
            return DirectManagerResponse(
                name=user.name,
                manager_name="",
                source=None,
                message="未配置飞书，无法自动带入直属上级",
            )

        open_id = (user.feishu_open_id or "").strip()
        if not open_id.startswith("ou_"):
            return DirectManagerResponse(
                name=user.name,
                manager_name="",
                source=None,
                message="该员工未绑定飞书账号，无法查询直属上级",
            )

        try:
            detail = await fetch_feishu_user_detail(open_id)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            return DirectManagerResponse(
                name=user.name,
                manager_name="",
                source="feishu_error",
                message="查询飞书通讯录失败，请稍后重试或手动填写直属上级",
            )

        leader_oid = str(detail.get("leader_user_id") or "").strip()
        if not leader_oid:
            return DirectManagerResponse(
                name=user.name,
                manager_name="",
                source="feishu",
                message="飞书通讯录中未设置直属上级",
            )

        leader = await self.users_repo.get_by_feishu_open_id(leader_oid)
        if leader and (leader.name or "").strip():
            return DirectManagerResponse(
                name=user.name,
                manager_name=leader.name.strip(),
                manager_user_id=leader.id,
                source="feishu",
            )

        try:
            leader_detail = await fetch_feishu_user_detail(leader_oid)
            manager_name = str(leader_detail.get("name") or "").strip()
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            manager_name = ""

        if not manager_name:
            return DirectManagerResponse(
                name=user.name,
                manager_name="",
                source="feishu",
                message="已找到直属上级账号，但无法解析姓名，请手动填写",
            )

        return DirectManagerResponse(
            name=user.name,
            manager_name=manager_name,
            source="feishu",
        )
