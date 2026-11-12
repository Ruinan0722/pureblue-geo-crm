from __future__ import annotations

from typing import Any

from app.core.deps import (
    user_can_see_unassigned,
    user_can_view_request,
    user_data_scope,
    user_has_permission,
)
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service.base import (
    CUSTOMER_WRITE_CODES,
)
from app.modules.users.repository import UsersRepository

from .helpers_common import (
    _doc,
)


class BaseAccessMixin:
    async def _owner_filter(
                self,
                user: AuthUser,
                *,
                mine_only: bool = False,
                coverage_scope: str | None = None,
                lead_pool: bool = False,
            ) -> list[str] | None:
                """CRM 可见集合：all=不限；self/own=自己；managed=自己∪管辖子树（非部门同伴）。

                coverage_scope: "self" | "managed"；None 时 department→managed，own→self。
                lead_pool=True 时，SDR 角色按「SDR 部门共享线索池」返回全部在职 SDR 成员，
                用于线索列表/详情/统计/工作台/附件/审计；其余实体仍按自身 data_scope。
                """
                if mine_only:
                    return [user.id]
                scope = user_data_scope(user)
                scope_norm = (coverage_scope or "").strip().lower()
                if scope_norm not in ("", "self", "managed"):
                    scope_norm = ""
                # 「只看自己」优先：all 范围角色（运营/管理员）开启 coverageScope=self
                # 时也必须只取本人对接池，不能因 scope=all 短路成全量。
                if scope_norm == "self":
                    return [user.id]
                if scope == "all":
                    return None
                if lead_pool and self._is_sdr_role(user):
                    return await UsersRepository(self.db).get_sdr_directory_user_ids()
                if scope == "own":
                    return [user.id]
                # department（Leader / 售前等）：managed = 管辖子树；无 led 时多为 {self}
                return await UsersRepository(self.db).get_managed_scope_user_ids(user.id)

    def _include_unassigned(
                self,
                user: AuthUser,
                *,
                mine_only: bool = False,
                lead_pool: bool = False,
            ) -> bool:
                """无负责人：仅 Leader(department)/管理员(all) 可见；mine_only 或普通销售不并入。

                lead_pool=True 时，SDR 角色在共享线索池内也能看到无负责人线索，
                便于在编辑时选择归属 SDR 完成绑定（导入线索默认无负责人）。
                """
                if mine_only:
                    return False
                if lead_pool and self._is_sdr_role(user):
                    return True
                return user_can_see_unassigned(user)

    def _assert_section(self, user: AuthUser, section: str) -> None:
                if not user_has_permission(user, f"section:{section}"):
                    raise PermissionDeniedError()

    def _assert_write(self, user: AuthUser, permission: str) -> None:
                if not user_has_permission(user, permission):
                    raise PermissionDeniedError()

    def _assert_customer_write(self, user: AuthUser, code: str) -> None:
                """客户细粒度写权限：命中细码或遗留总写码（customers:write）即放行，
                兼容尚未按细码重配角色的过渡期；矩阵重配后移除总写码即可按细码控制。"""
                if user_has_permission(user, "customers:write") or user_has_permission(user, code):
                    return
                raise PermissionDeniedError()

    def _assert_any_customer_write(self, user: AuthUser) -> None:
                if user_has_permission(user, "customers:write") or any(
                    user_has_permission(user, c) for c in CUSTOMER_WRITE_CODES
                ):
                    return
                raise PermissionDeniedError()

    def _assert_customer_write_codes(self, user: AuthUser, codes: set[str]) -> None:
                """按载荷推断出的细码逐一校验；无具体写入时要求具备任一客户写权限。"""
                if codes:
                    for code in codes:
                        self._assert_customer_write(user, code)
                else:
                    self._assert_any_customer_write(user)

    def _assert_lead_write(self, user: AuthUser, code: str) -> None:
                if user_has_permission(user, "leads:write") or user_has_permission(user, code):
                    return
                raise PermissionDeniedError()

    def _assert_opportunity_write(self, user: AuthUser, code: str) -> None:
                if user_has_permission(user, "opportunities:write") or user_has_permission(user, code):
                    return
                raise PermissionDeniedError()

    def _assert_contract_write(self, user: AuthUser, code: str) -> None:
                if user_has_permission(user, "contracts:write") or user_has_permission(user, code):
                    return
                raise PermissionDeniedError()

    def _is_sdr_role(self, user: AuthUser) -> bool:
                return (user.role or "").strip() == "sdr"

    async def _assert_assignable_sdr_owner(self, user: AuthUser, target_user_id: str) -> None:
                """线索归属 SDR 只能指派给 SDR 成员目录（或 all 数据范围不限）。"""
                if user_data_scope(user) == "all":
                    return
                sdr_ids = await UsersRepository(self.db).get_sdr_directory_user_ids()
                if target_user_id not in sdr_ids:
                    raise PermissionDeniedError("只能将线索归属指派给 SDR 成员")

    async def _sdr_pool_names(self, user: AuthUser) -> list[str]:
                """SDR 共享线索池的 sdr 显示名集合（仅 SDR 角色使用；其余返回空）。"""
                if not self._is_sdr_role(user):
                    return []
                return await UsersRepository(self.db).get_sdr_directory_user_names()

    async def _resolve_sdr_owner_user_id(self, user: AuthUser, owner_name: str) -> str:
                """按显示名解析归属 SDR；必须是在职且角色为 sdr 的成员。"""
                name = (owner_name or "").strip()
                if not name:
                    raise ValidationError("请选择归属 SDR")
                resolved = await UsersRepository(self.db).get_by_name(name, active_only=True)
                if resolved is None:
                    raise ValidationError(f"未找到 SDR「{name}」，请选择系统中的有效 SDR 成员")
                if (resolved.role or "").strip() != "sdr":
                    raise ValidationError(f"「{name}」不是 SDR 成员，不能作为线索归属 SDR")
                await self._assert_assignable_sdr_owner(user, resolved.id)
                return resolved.id

    async def _try_resolve_active_sdr_id(self, owner_name: str) -> str | None:
                """宽容解析在职 SDR 用户 id：重名/不存在/非 SDR 一律返回 None，不阻断编辑。"""
                name = (owner_name or "").strip()
                if not name:
                    return None
                try:
                    resolved = await UsersRepository(self.db).get_by_name(
                        name, active_only=True
                    )
                except ValidationError:
                    return None
                if resolved is None or (resolved.role or "").strip() != "sdr":
                    return None
                return resolved.id

    def _can_edit_customer_master(self, user: AuthUser) -> bool:
                return user_has_permission(user, "customers:master_edit") or user_has_permission(
                    user, "customers:write"
                )

    async def _assert_row_access(
                self,
                user: AuthUser,
                owner_user_id: str | None,
                *,
                lead_pool: bool = False,
                lead_sdr_name: str | None = None,
            ) -> None:
                allowed = await self._owner_filter(user, lead_pool=lead_pool)
                if allowed is None:
                    return
                if not owner_user_id:
                    if self._include_unassigned(user, lead_pool=lead_pool):
                        return
                    raise PermissionDeniedError()
                if owner_user_id in allowed:
                    return
                # 导入线索：sdr 归属字段命中 SDR 目录时，即使负责人非 SDR 也属共享池
                if lead_pool:
                    sdr_names = await UsersRepository(self.db).get_sdr_directory_user_names()
                    if str(lead_sdr_name or "").strip() in sdr_names:
                        return
                raise PermissionDeniedError()

    async def _assignable_owner_ids(self, user: AuthUser) -> list[str] | None:
                """改派可用集合：all 不限；其余为销售成员目录（含自己）。

                与读隔离分离：SDR/销售转客户指定负责人走销售目录，而非下属集合。
                """
                if user_data_scope(user) == "all":
                    return None
                ids = await UsersRepository(self.db).get_sales_directory_user_ids()
                if user.id not in ids:
                    ids = [user.id, *ids]
                return ids

    async def _resolve_owner_user_id(self, user: AuthUser, owner_name: str) -> str:
                """按显示名解析负责人；找不到则报错，禁止静默落到自己（除非名字就是本人）。"""
                name = (owner_name or "").strip()
                if not name or name in ("未分配", "待分配"):
                    return user.id
                resolved = await UsersRepository(self.db).resolve_user_id_by_owner_name(name)
                if resolved:
                    return resolved
                if name == (user.name or "").strip():
                    return user.id
                raise ValidationError(f"未找到负责人「{name}」，请选择系统中的有效同事")

    async def _assert_assignable_owner(self, user: AuthUser, target_user_id: str) -> None:
                """负责人只能指派给销售成员目录（或 all 不限）。"""
                tid = (target_user_id or "").strip()
                if not tid:
                    raise PermissionDeniedError("无效的负责人")
                allowed = await self._assignable_owner_ids(user)
                if allowed is None:
                    return
                if tid not in allowed:
                    raise PermissionDeniedError("只能将负责人指派给销售成员目录中的同事")

    async def _assert_entity_readable(self, user: AuthUser, kind: str, entity_id: str) -> None:
                """与详情接口同一套可读校验（附件 / 审计复用）。"""
                k = (kind or "").strip().lower()
                eid = (entity_id or "").strip()
                if not eid:
                    raise PermissionDeniedError()

                if k in ("lead", "线索", "leads"):
                    if not user_has_permission(user, "section:leads"):
                        raise PermissionDeniedError()
                    row = await self.repo.get_lead(eid)
                    if not row:
                        raise NotFoundError("线索不存在")
                    await self._assert_row_access(
                        user,
                        row.owner_user_id,
                        lead_pool=True,
                        lead_sdr_name=getattr(row, "sdr", None),
                    )
                    return

                if k in ("customer", "客户", "customers"):
                    row = await self.repo.get_customer(eid)
                    if not row:
                        raise NotFoundError("客户不存在")
                    await self._assert_customer_master_readable(user, row)
                    return

                if k in ("coverage", "对接池", "coverages"):
                    if not user_has_permission(user, "section:customers"):
                        raise PermissionDeniedError()
                    row = await self.repo.get_coverage(eid)
                    if not row:
                        raise NotFoundError("对接池不存在")
                    await self._assert_coverage_access(user, row)
                    return

                if k in ("opportunity", "商机", "opportunities"):
                    if not user_has_permission(user, "section:opportunities"):
                        raise PermissionDeniedError()
                    row = await self.repo.get_opportunity(eid)
                    if not row:
                        raise NotFoundError("商机不存在")
                    await self._assert_row_access(user, row.owner_user_id)
                    geo = await self._resolve_opportunity_geo(
                        await self._opportunity_doc_for_geo(row)
                    )
                    self._assert_geo_access(user, geo)
                    return

                if k in ("contract", "合同", "contracts"):
                    if not user_has_permission(user, "section:contracts"):
                        raise PermissionDeniedError()
                    row = await self.repo.get_contract(eid)
                    if not row:
                        raise NotFoundError("合同不存在")
                    await self._assert_row_access(user, row.owner_user_id)
                    self._assert_geo_access(user, await self._resolve_contract_geo(_doc(row)))
                    return

                if k in ("request", "需求", "requests"):
                    from app.modules.requests.repository import RequestRepository

                    row = await RequestRepository(self.db).get_by_id(eid)
                    if not row:
                        raise NotFoundError("需求不存在")
                    if not await user_can_view_request(
                        self.db,
                        row.staff_user_id,
                        user,
                        request_code=getattr(row, "code", None),
                        request_data=row.data if isinstance(getattr(row, "data", None), dict) else None,
                    ):
                        raise PermissionDeniedError()
                    return

                if k in ("project", "项目", "projects"):
                    from app.modules.projects.service import ProjectsService

                    # 与 GET /projects/{id} 同一套可见性（含团队成员 / 部门 peer）
                    await ProjectsService(self.db).get_project(user, eid)
                    return

                raise PermissionDeniedError()

    async def _assert_entity_id_readable(self, user: AuthUser, entity_id: str) -> None:
                """仅有 entity_id 时探测类型再校验（审计列表）。"""
                eid = (entity_id or "").strip()
                if not eid:
                    raise PermissionDeniedError()

                probes: list[tuple[str, Any]] = [
                    ("lead", await self.repo.get_lead(eid)),
                    ("customer", await self.repo.get_customer(eid)),
                    ("opportunity", await self.repo.get_opportunity(eid)),
                    ("contract", await self.repo.get_contract(eid)),
                ]
                for kind, row in probes:
                    if row is not None:
                        await self._assert_entity_readable(user, kind, eid)
                        return

                from app.modules.requests.repository import RequestRepository

                req = await RequestRepository(self.db).get_by_id(eid)
                if req is not None:
                    await self._assert_entity_readable(user, "request", eid)
                    return

                from app.modules.projects.repository import ProjectsRepository

                proj = await ProjectsRepository(self.db).get(eid)
                if proj is not None:
                    await self._assert_entity_readable(user, "project", eid)
                    return

                raise NotFoundError("实体不存在")

    async def _assert_audit_entity_readable(self, user: AuthUser, entity_id: str) -> None:
                """审计可读：与详情一致；SDR 额外可看其转出线索关联的客户操作历史（不开客户经营）。"""
                eid = (entity_id or "").strip()
                if not eid:
                    raise PermissionDeniedError()
                try:
                    await self._assert_entity_id_readable(user, eid)
                    return
                except PermissionDeniedError:
                    if not self._is_sdr_role(user):
                        raise
                customer_row = await self.repo.get_customer(eid)
                if not customer_row:
                    raise PermissionDeniedError()
                source_lead_id = str(_doc(customer_row).get("sourceLeadId") or "").strip()
                if not source_lead_id:
                    raise PermissionDeniedError()
                lead_row = await self.repo.get_lead(source_lead_id)
                if not lead_row:
                    raise PermissionDeniedError()
                await self._assert_row_access(
                    user,
                    lead_row.owner_user_id,
                    lead_pool=True,
                    lead_sdr_name=getattr(lead_row, "sdr", None),
                )

    async def assert_attachment_access(self, user: AuthUser, attachment_id: str) -> str:
                """附件下载：先确认文件存在，再按父实体可读性校验。"""
                from app.core.exceptions import ValidationError
                from app.modules.crm.attachment_store import (
                    attachment_owner_hints,
                    resolve_attachment_path,
                )

                storage_id = await self.repo.get_attachment_storage_id(attachment_id)
                try:
                    path = resolve_attachment_path(storage_id)
                except ValidationError as exc:
                    raise NotFoundError("附件不存在") from exc
                if not path.is_file():
                    raise NotFoundError("附件不存在")

                candidates: list[tuple[str, str]] = []
                hints = attachment_owner_hints(storage_id, path=path)
                if hints.get("lead_id"):
                    candidates.append(("lead", hints["lead_id"]))
                if hints.get("entity_kind") and hints.get("entity_id"):
                    candidates.append((hints["entity_kind"], hints["entity_id"]))

                for kind, eid in await self.repo.find_entities_for_attachment(attachment_id):
                    if (kind, eid) not in candidates:
                        candidates.append((kind, eid))

                if not candidates:
                    # 磁盘有文件但无父实体引用：仅 all 可下（运维兜底）
                    if user_data_scope(user) == "all":
                        return storage_id
                    raise PermissionDeniedError("无权访问该附件")

                last_denied: PermissionDeniedError | None = None
                for kind, eid in candidates:
                    try:
                        if kind in ("customer", "客户", "customers"):
                            # 主档可读 ≠ 池附件可读：挂在客户 document 上的附件须有可见对接池
                            await self._assert_customer_attachment_access(user, eid)
                        else:
                            await self._assert_entity_readable(user, kind, eid)
                        return storage_id
                    except PermissionDeniedError as exc:
                        last_denied = exc
                    except NotFoundError:
                        continue
                if last_denied:
                    raise last_denied
                raise PermissionDeniedError("无权访问该附件")
