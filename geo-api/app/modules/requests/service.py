from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import (
    AuthContext,
    user_can_mutate_request,
    user_can_see_unassigned,
    user_can_view_request,
    user_data_scope,
    user_has_permission,
)
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    UnauthorizedError,
    ValidationError,
)
from app.models import Invite
from app.models.user import EMPLOYMENT_ACTIVE
from app.modules.auth.schemas import AuthUser
from app.modules.invites.repository import InviteRepository, _dt_to_str
from app.modules.requests.repository import RequestRepository
from app.modules.requests.schemas import (
    CreateRequestBody,
    IntakeSubmitBody,
    IntakeSubmitResponse,
    PatchRequestBody,
    RequestInviteInfo,
    RequestRecord,
    RequestStatus,
)
from app.modules.requests.validation import validate_intake_data
from app.modules.users.repository import UsersRepository

# 兼容存量手工邀请（32 位 hex）与当前固定邀请。
# 这里只做廉价的格式拦截；真实性仍由后续的数据库查询、撤销状态和员工在职状态共同决定。
_LEGACY_INVITE_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
_FIXED_INVITE_TOKEN_RE = re.compile(r"^staff-[a-z0-9][a-z0-9-]{0,127}-(?:overseas|domestic)$")


def _is_supported_invite_token(token: str) -> bool:
    return bool(
        _LEGACY_INVITE_TOKEN_RE.fullmatch(token)
        or _FIXED_INVITE_TOKEN_RE.fullmatch(token)
    )


class RequestService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = RequestRepository(db)
        self.invite_repo = InviteRepository(db)
        self.settings = get_settings()

    def _portal_url(self, token: str) -> str:
        base = self.settings.customer_portal_url.rstrip("/")
        return f"{base}/c/{token}"

    async def _invalidate_workbench_caches(self, *user_ids: str | None) -> None:
        """需求写影响工作台；须在 MySQL commit 之后调用。"""
        import logging

        from app.core.cache_metrics import incr as metric_incr

        try:
            from app.modules.crm.crm_list_cache import invalidate_crm_caches_for_users

            await invalidate_crm_caches_for_users([uid for uid in user_ids if uid])
        except Exception:
            metric_incr("redis_invalidate_fail_total")
            logging.getLogger(__name__).exception(
                "redis_invalidate_fail workbench caches user_ids=%s",
                [uid for uid in user_ids if uid],
            )

    def _invite_to_info(self, invite: Invite) -> RequestInviteInfo:
        return RequestInviteInfo(
            id=invite.id,
            label=invite.label,
            url=self._portal_url(invite.token),
            created_at=_dt_to_str(invite.created_at) or "",
            active=invite.revoked_at is None,
        )

    async def _enrich_with_invites(self, records: list[RequestRecord]) -> list[RequestRecord]:
        invite_ids = [r.invite_id for r in records if r.invite_id]
        if not invite_ids:
            return records
        invites = await self.invite_repo.get_by_ids(invite_ids)
        enriched: list[RequestRecord] = []
        for record in records:
            if not record.invite_id:
                enriched.append(record)
                continue
            invite = invites.get(record.invite_id)
            if not invite:
                enriched.append(record)
                continue
            enriched.append(record.model_copy(update={"invite": self._invite_to_info(invite)}))
        return enriched

    async def _enrich_owner_employment(self, records: list[RequestRecord]) -> list[RequestRecord]:
        """附带跟进人在职状态；不改 owner 姓名，便于历史回溯。"""
        staff_ids = [r.staff_user_id for r in records if r.staff_user_id]
        if not staff_ids:
            return records
        from sqlalchemy import select

        from app.models import User

        rows = (
            await self.db.execute(
                select(User.id, User.employment_status).where(User.id.in_(staff_ids))
            )
        ).all()
        status_by_id = {str(uid): str(status) for uid, status in rows}
        enriched: list[RequestRecord] = []
        for record in records:
            if not record.staff_user_id:
                enriched.append(record)
                continue
            status = status_by_id.get(record.staff_user_id)
            if status in ("active", "resigned"):
                enriched.append(record.model_copy(update={"owner_employment_status": status}))
            else:
                enriched.append(record)
        return enriched

    async def _enrich_records(self, records: list[RequestRecord]) -> list[RequestRecord]:
        records = await self._enrich_with_invites(records)
        return await self._enrich_owner_employment(records)

    async def list_for_user(self, user: AuthUser) -> list[RequestRecord]:
        """全量可见列表（兼容旧调用 / 工作台）。列表页请用 search_for_user。"""
        if not user_has_permission(user, "request:view"):
            raise PermissionDeniedError()

        scope = user_data_scope(user)
        if scope == "all":
            rows = await self.repo.list_all()
        elif scope == "department":
            peers = await UsersRepository(self.db).get_managed_scope_user_ids(user.id)
            rows = await self.repo.list_by_staff_ids(peers)
        else:
            rows = await self.repo.list_by_staff(user.id)

        # 未分配仅 Leader（department）可见；all 已含全量；普通销售 own 不并入
        if scope == "department" and user_can_see_unassigned(user):
            seen = {r.id for r in rows}
            for row in await self.repo.list_unassigned():
                if row.id not in seen:
                    rows.append(row)

        rows.sort(key=lambda r: r.updated_at or r.submitted_at, reverse=True)

        from app.modules.requests.repository import _row_to_record

        children_map = await self.repo.list_request_children([r.id for r in rows])
        records = [_row_to_record(r, children_map.get(r.id)) for r in rows]
        return await self._enrich_records(records)

    async def _resolve_list_scope(
        self, user: AuthUser, *, mine_only: bool = False
    ) -> tuple[list[str] | None, bool]:
        """返回 (staff_ids, include_unassigned)。staff_ids is None 表示全量。"""
        if mine_only:
            return [user.id], False
        include_unassigned = False
        scope = user_data_scope(user)
        if scope == "all":
            # 全量查询已含未分配行，无需额外 OR
            return None, False
        if scope == "department":
            peers = await UsersRepository(self.db).get_managed_scope_user_ids(user.id)
            staff_ids = list(peers)
            include_unassigned = user_can_see_unassigned(user)
        else:
            staff_ids = [user.id]
            include_unassigned = False
        return staff_ids, include_unassigned

    async def search_for_user(
        self,
        user: AuthUser,
        *,
        keyword: str | None = None,
        status: str | None = None,
        opportunity_id: str | None = None,
        geo_source: str | None = None,
        region: str | None = None,
        goal: str | None = None,
        submitted_from: str | None = None,
        submitted_to: str | None = None,
        mine_only: bool = False,
        page: int = 1,
        page_size: int = 10,
    ) -> dict[str, Any]:
        if not user_has_permission(user, "request:view"):
            raise PermissionDeniedError()

        if opportunity_id:
            raise ValidationError("需求与商机绑定功能已取消，不再支持按商机筛选需求")
        from app.core.geo_scope import forced_geo_source

        forced = forced_geo_source(user)
        if forced:
            geo_source = forced

        staff_ids, include_unassigned = await self._resolve_list_scope(user, mine_only=mine_only)
        page = max(1, int(page or 1))
        page_size = min(100, max(1, int(page_size or 10)))
        rows, total = await self.repo.search_requests(
            staff_ids=staff_ids,
            include_unassigned=include_unassigned,
            keyword=keyword,
            status=status,
            opportunity_id=opportunity_id,
            geo_source=geo_source,
            region=region,
            goal=goal,
            submitted_from=submitted_from,
            submitted_to=submitted_to,
            page=page,
            page_size=page_size,
        )
        from app.modules.requests.repository import _row_to_record

        children_map = await self.repo.list_request_children([r.id for r in rows])
        records = [_row_to_record(r, children_map.get(r.id)) for r in rows]
        records = await self._enrich_records(records)
        return {
            "items": records,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_stats(self, user: AuthUser, *, mine_only: bool = False) -> dict[str, int]:
        if not user_has_permission(user, "request:view"):
            raise PermissionDeniedError()
        from app.core.geo_scope import forced_geo_source

        staff_ids, include_unassigned = await self._resolve_list_scope(user, mine_only=mine_only)
        return await self.repo.aggregate_request_stats(
            staff_ids=staff_ids,
            include_unassigned=include_unassigned,
            geo_source=forced_geo_source(user),
        )

    async def export_records(self, user: AuthUser, ids: list[str]) -> list[RequestRecord]:
        """批量导出：校验权限与数据范围，返回可导出的需求记录。"""
        if not user_has_permission(user, "request:view") or not user_has_permission(
            user, "request:export"
        ):
            raise PermissionDeniedError()
        if not ids:
            raise ValidationError("请至少勾选一条需要导出的需求")
        if len(ids) > 200:
            raise ValidationError("单次最多导出 200 条需求")

        from app.core.geo_scope import forced_geo_source

        staff_ids, include_unassigned = await self._resolve_list_scope(user)
        rows = await self.repo.get_by_ids_for_export(
            list(dict.fromkeys(ids)),
            staff_ids=staff_ids,
            include_unassigned=include_unassigned,
            geo_source=forced_geo_source(user),
        )
        if len(rows) != len(dict.fromkeys(ids)):
            raise PermissionDeniedError("部分需求不在您的数据范围内，无法导出")

        from app.modules.requests.repository import _row_to_record

        children_map = await self.repo.list_request_children([row.id for row in rows])
        records = [_row_to_record(row, children_map.get(row.id)) for row in rows]
        return await self._enrich_records(records)

    async def get_detail(self, request_id: str, user: AuthUser) -> RequestRecord:
        row = await self.repo.get_by_id(request_id)
        if not row:
            raise NotFoundError("未找到该需求")
        from app.modules.requests.repository import _row_to_record

        children = await self.repo.get_request_children(request_id)
        record = _row_to_record(row, children)
        data = record.data if isinstance(record.data, dict) else None
        if not await user_can_view_request(
            self.db,
            record.staff_user_id,
            user,
            request_code=record.code,
            request_data=data,
        ):
            raise PermissionDeniedError()

        enriched = await self._enrich_records([record])
        return enriched[0]

    async def _require_authentic_invite_for_submit(self, raw_token: str) -> tuple[Invite, str]:
        """
        公网 submit 真实性门槛：仅库内真实、未撤销、归属在职销售的邀请可通过。
        行锁邀请记录，供后续幂等查询与写入在同一事务内串行化。
        """
        token = (raw_token or "").strip().lower()
        if not token:
            raise ValidationError("缺少邀请凭证，请通过销售提供的专属链接访问后再提交")
        if not _is_supported_invite_token(token):
            raise ValidationError("邀请链接无效")

        invite = await self.invite_repo.get_by_token_for_update(token)
        if not invite or invite.revoked_at is not None:
            raise ValidationError("邀请链接已失效，请联系销售获取新链接")

        staff = await UsersRepository(self.db).get_by_id(invite.staff_user_id)
        if not staff or not (staff.name or "").strip():
            raise ValidationError("邀请链接无效")
        if staff.employment_status != EMPLOYMENT_ACTIVE:
            raise ValidationError("邀请链接已失效，请联系销售获取新链接")

        return invite, staff.name.strip()

    async def submit_from_invite(self, body: IntakeSubmitBody) -> IntakeSubmitResponse:
        """
        客户邀请链接只写提交：
        1) 先验真邀请（格式 + 库内存在 + 未撤销 + 销售在职）
        2) 同一链接可多次提交，每笔均归属该销售（链接一对多，一个销售可服务多个客户）
        3) 短时相同表单内容去重（防连点/刷新双写），命中时 reused=true
        4) 表单字段校验通过后才入库
        """
        if not isinstance(body.data, dict) or not body.data:
            raise ValidationError("缺少表单数据")

        invite, owner_name = await self._require_authentic_invite_for_submit(body.invite_token)

        validate_intake_data(body.data)

        variant = getattr(invite, "geo_variant", None) or "overseas"
        from app.core.geo_scope import apply_intake_geo_stamp

        stamped_data = apply_intake_geo_stamp(body.data, variant)

        record = await self.repo.insert(
            staff_user_id=invite.staff_user_id,
            invite_id=invite.id,
            owner_name=owner_name,
            data=stamped_data,
            status="submitted",
        )
        await self.db.commit()
        await self._invalidate_workbench_caches(invite.staff_user_id)
        return IntakeSubmitResponse(code=record.code, reused=record.reused)

    async def create(self, body: CreateRequestBody, ctx: AuthContext) -> RequestRecord:
        """员工代客填报 / 内网创建；客户公网提交请使用 submit_from_invite。"""
        if not body.data:
            raise ValidationError("缺少表单数据")

        status: RequestStatus = body.status or "submitted"

        # 客户公网填报一律走 /api/intake/submit（submit_from_invite）；
        # 这里只允许员工代客填报，不再接受 invite_token 兼容分支，避免绕过 request:create 权限。
        if ctx.kind != "user" or not ctx.user:
            raise UnauthorizedError("请通过销售提供的专属链接访问后再提交")
        if not user_has_permission(ctx.user, "request:create"):
            raise PermissionDeniedError("无权限代客填报")
        name = await self.repo.get_staff_name(ctx.user.id)
        if not name:
            raise ValidationError("用户不存在")
        if status == "submitted":
            validate_intake_data(body.data)
        from app.core.geo_scope import (
            apply_intake_geo_stamp,
            forced_geo_source,
            resolve_request_geo_source,
        )

        # 海外运营代填强制海外；其它角色保留客户端 stamp（海外/国内表单各自写入）
        data = body.data
        forced = forced_geo_source(ctx.user)
        if forced == "overseas":
            data = apply_intake_geo_stamp(data, "overseas")
        elif resolve_request_geo_source(data=data if isinstance(data, dict) else None) == "manual":
            # 未打标时：海外运营已处理；销售走海外页通常已 stamp，此处不臆测
            pass
        record = await self.repo.insert(
            staff_user_id=ctx.user.id,
            invite_id=None,
            owner_name=name,
            data=data,
            status=status,
        )
        await self.db.commit()
        await self._invalidate_workbench_caches(ctx.user.id)
        enriched = await self._enrich_records([record])
        return enriched[0]

    async def patch(self, request_id: str, body: PatchRequestBody, user: AuthUser) -> RequestRecord:
        row = await self.repo.get_by_id(request_id)
        if not row:
            raise NotFoundError("未找到该需求")
        from app.modules.requests.repository import _row_to_record

        children = await self.repo.get_request_children(request_id)
        record = _row_to_record(row, children)
        req_data = record.data if isinstance(record.data, dict) else None
        geo_kw = {"request_code": record.code, "request_data": req_data}
        if not await user_can_view_request(self.db, record.staff_user_id, user, **geo_kw):
            raise PermissionDeniedError()

        if body.opportunity_id:
            if not await user_can_mutate_request(self.db, record.staff_user_id, user, "request:edit", **geo_kw):
                raise PermissionDeniedError("无权限编辑需求")
            raise ValidationError("需求与商机绑定功能已取消")

        if body.data is not None:
            if not await user_can_mutate_request(self.db, record.staff_user_id, user, "request:edit", **geo_kw):
                raise PermissionDeniedError("无权限编辑需求信息")
            if record.status == "submitted" or body.status == "submitted":
                validate_intake_data(body.data)
            record = await self.repo.update_data(request_id, body.data) or record

        if body.status is not None:
            if not await user_can_mutate_request(
                self.db, record.staff_user_id, user, "request:change_status", **geo_kw
            ):
                raise PermissionDeniedError("无权限变更需求状态")
            record = await self.repo.update_status(request_id, body.status) or record

        if body.attachments is not None:
            if not await user_can_mutate_request(self.db, record.staff_user_id, user, "request:edit", **geo_kw):
                raise PermissionDeniedError("无权限更新附件")
            payload = [item.model_dump(by_alias=True) for item in body.attachments]
            record = await self.repo.replace_attachments(request_id, payload) or record

        prev_staff = record.staff_user_id
        if body.owner is not None:
            if not await user_can_mutate_request(
                self.db, record.staff_user_id, user, "request:assign_owner", **geo_kw
            ):
                raise PermissionDeniedError("无权限修改跟进人")
            owner_label = body.owner.strip()
            if owner_label in ("", "—", "-"):
                owner_label = UsersRepository.UNASSIGNED_OWNER
            staff_user_id = await UsersRepository(self.db).resolve_user_id_by_owner_name(owner_label)
            record = await self.repo.update_owner(request_id, owner_label, staff_user_id) or record

        if body.note and body.note.strip():
            if not await user_can_mutate_request(self.db, record.staff_user_id, user, "request:add_note", **geo_kw):
                raise PermissionDeniedError("无权限添加备注")
            record = (
                await self.repo.append_note(request_id, body.note.strip(), body.author or user.name)
                or record
            )

        await self.db.commit()
        await self._invalidate_workbench_caches(
            user.id,
            prev_staff,
            record.staff_user_id,
        )
        enriched = await self._enrich_records([record])
        return enriched[0]





