from __future__ import annotations

import json
import logging
from collections import Counter
from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_data_scope, user_has_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.core.geo_scope import (
    coalesce_geo_sources,
    forced_geo_source,
    matches_forced_geo,
    normalize_geo_source,
    opportunity_geo_from_request_map,
    resolve_document_geo_source,
    resolve_request_geo_source,
)
from app.core.time_utils import china_now, format_legacy_time
from app.models.project import Project, ProjectNote, ProjectSowVersion, ProjectWorkItem
from app.modules.auth.schemas import AuthUser
from app.modules.contracts.status_catalog import (
    PROJECT_HEALTH_META as _PROJECT_HEALTH_CATALOG,
)
from app.modules.contracts.status_catalog import (
    PROJECT_NOTE_KIND_META as _PROJECT_NOTE_KIND_CATALOG,
)
from app.modules.contracts.status_catalog import (
    PROJECT_RISK_META as _PROJECT_RISK_CATALOG,
)
from app.modules.contracts.status_catalog import (
    PROJECT_STAGE_META as _PROJECT_STAGE_CATALOG,
)
from app.modules.crm.repository import CrmRepository
from app.modules.projects.repository import ARCHIVE_STAGES, ProjectsRepository
from app.modules.projects.schemas import (
    CreateProjectNoteBody,
    CreateProjectSowVersionBody,
    PatchProjectBody,
    ProjectListResponse,
    ProjectDashboardResponse,
    ProjectAttachmentItem,
    ProjectAttachmentsResponse,
    ProjectNoteItem,
    ProjectNotesResponse,
    ProjectPaymentSummary,
    ProjectRecord,
    ProjectReportResponse,
    ProjectStatsResponse,
    ProjectSowClause,
    ProjectSowVersionRecord,
    ProjectSowVersionsResponse,
    ProjectWorkItemBody,
    ProjectWorkItemRecord,
    ProjectWorkItemsResponse,
)
from app.modules.users.repository import UsersRepository

logger = logging.getLogger(__name__)
CHINA_TZ = ZoneInfo("Asia/Shanghai")

# 项目阶段码从唯一权威源 status_catalog.py 派生，禁止本地硬编码。
STAGES = frozenset(_PROJECT_STAGE_CATALOG.keys())
# 健康度/风险/记录类型同样从唯一权威源派生。
HEALTHS = frozenset(_PROJECT_HEALTH_CATALOG.keys())
RISKS = frozenset(_PROJECT_RISK_CATALOG.keys())
NOTE_KINDS = frozenset(_PROJECT_NOTE_KIND_CATALOG.keys())
WORK_ITEM_KINDS = frozenset({"task", "issue", "change", "risk", "follow_up", "help", "appeasement", "delay", "delivery"})
DONE_STATUSES = frozenset({"completed", "resolved", "closed", "approved", "delivered"})

def _normalize_work_item_status(kind: str, status: str | None) -> str:
    """工作项只保留进行中/完成态；历史状态继续兼容并映射到简洁状态。"""
    if status in DONE_STATUSES:
        return "resolved" if kind in {"issue", "help", "risk", "delay"} else "completed"
    return "completed" if kind in {"appeasement", "delivery"} else "processing"

# CS 默认可写；ops/admin 额外可写金额与商务负责人
CS_PATCH_FIELDS = {
    "name",
    "stage",
    "health",
    "risk_level",
    "biz_owner",
    "biz_owner_user_id",
    "project_manager",
    "project_manager_user_id",
    "project_leader",
    "executor",
    "executor_user_id",
    "content_ops",
    "content_ops_user_id",
    "contact_info",
    "team_name",
    "office",
    "customer_level",
    "customer_tags",
    "assistant_members",
    "execution_members",
    "detection_platforms",
    "renewal_status",
    "start_date",
    "planned_start_date",
    "actual_delivery_date",
    "delay_reason",
    "remediation_plan",
    "delay_customer_note",
    "project_types",
    "optimization_intent_count",
    "monitoring_intent_count",
    "platforms",
    "acceptance_criteria",
    "kpi_notes",
    "clear_start_date",
    "clear_planned_start_date",
    "clear_actual_delivery_date",
}
OPS_EXTRA_FIELDS = {"biz_owner", "biz_owner_user_id", "contract_amount"}
# 交付目标允许项目团队直接维护；销售发起的重大变更仍由 SOW 版本接口留痕。
SOW_VERSION_FIELDS: set[str] = set()


def _china_today() -> date:
    return datetime.now(CHINA_TZ).date()


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x) for x in value if str(x).strip()]


def compute_project_fields(row: Project, *, today: date | None = None) -> dict[str, Any]:
    day = today or _china_today()
    intent_total = int(row.intent_brand or 0) + int(row.intent_content or 0) + int(row.intent_search or 0)
    days_to_sow_end: int | None = None
    delay_duration_days: int | None = None
    renewal_warning = False
    overdue = False
    delivery_deadline = row.latest_delivery_date or row.sow_end_date
    if delivery_deadline:
        days_to_sow_end = (delivery_deadline - day).days
        if days_to_sow_end < 0:
            overdue = True
            delay_duration_days = -days_to_sow_end
        else:
            delay_duration_days = 0
            if 0 <= days_to_sow_end <= 30 and row.stage not in ARCHIVE_STAGES:
                renewal_warning = True
    baseline = row.original_delivery_date or row.sow_end_date
    actual_or_latest = row.actual_delivery_date or row.latest_delivery_date
    delivery_delay_days = 0
    if baseline and actual_or_latest and actual_or_latest > baseline:
        delivery_delay_days = (actual_or_latest - baseline).days
    elif baseline and not row.actual_delivery_date and day > baseline and row.stage not in ARCHIVE_STAGES:
        delivery_delay_days = (day - baseline).days
    return {
        "intent_total": intent_total,
        "days_to_sow_end": days_to_sow_end,
        "delay_duration_days": delay_duration_days,
        "renewal_warning": renewal_warning,
        "overdue": overdue,
        "delivery_delay_days": delivery_delay_days,
    }


def should_ensure_project(prev: dict[str, Any] | None, doc: dict[str, Any], *, is_create: bool) -> bool:
    """主触发：合同变为 signed；辅触发：已签订且 projectStatus 变为 not_started。"""
    status = str(doc.get("status") or "")
    prev_status = str((prev or {}).get("status") or "")
    ps = str(doc.get("projectStatus") or "")
    prev_ps = str((prev or {}).get("projectStatus") or "")
    if status == "signed" and (is_create or prev_status != "signed"):
        return True
    return status == "signed" and ps == "not_started" and prev_ps != "not_started"


class ProjectsService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = ProjectsRepository(db)
        self.crm = CrmRepository(db)
        self.users = UsersRepository(db)

    def _assert_section(self, user: AuthUser) -> None:
        if not user_has_permission(user, "section:projects"):
            raise PermissionDeniedError("无项目管理访问权限")

    def _assert_write(self, user: AuthUser) -> None:
        if not user_has_permission(user, "projects:write"):
            raise PermissionDeniedError("无项目管理编辑权限")

    def _is_ops_admin(self, user: AuthUser) -> bool:
        scope = user_data_scope(user)
        return scope == "all" or user_has_permission(user, "section:settings")

    def _team_empty(self, row: Project) -> bool:
        return (
            not (row.project_manager or "").strip()
            and not (row.executor or "").strip()
            and not (row.content_ops or "").strip()
            and not row.project_manager_user_id
            and not row.executor_user_id
            and not row.content_ops_user_id
        )

    def _user_on_team(self, user: AuthUser, row: Project) -> bool:
        uid = user.id
        name = (user.name or "").strip()
        if uid and uid in {
            row.project_manager_user_id,
            row.executor_user_id,
            row.content_ops_user_id,
            row.biz_owner_user_id,
        }:
            return True
        return bool(
            name
            and name
            in {
                (row.project_manager or "").strip(),
                (row.executor or "").strip(),
                (row.content_ops or "").strip(),
                (row.biz_owner or "").strip(),
            }
        )

    async def _resolve_rows_geo(self, rows: Sequence[Project]) -> dict[str, str]:
        """批量解析项目归属：绑定需求 → 商机/合同 stamp → 列 stamp；避免列表 N+1。"""
        from app.modules.requests.repository import RequestRepository

        if not rows:
            return {}

        contract_ids = list(
            dict.fromkeys(r.source_contract_id for r in rows if (r.source_contract_id or "").strip())
        )
        contracts = await self.crm.list_contracts_by_ids(contract_ids)
        contract_by_id = {c.id: c for c in contracts}

        opp_ids: list[str] = []
        for row in rows:
            cid = (row.source_contract_id or "").strip()
            contract = contract_by_id.get(cid) if cid else None
            if contract:
                oid = str(contract.opportunity_id or row.opportunity_id or "").strip()
            else:
                oid = str(row.opportunity_id or "").strip()
            if oid:
                opp_ids.append(oid)
        opp_rows = await self.crm.list_opportunities_by_ids(list(dict.fromkeys(opp_ids)))
        opp_by_id = {o.id: o for o in opp_rows}
        opp_children = await self.crm.list_opportunity_children([o.id for o in opp_rows])

        all_rids: list[str] = []
        for opp in opp_rows:
            all_rids.extend(
                str(x).strip()
                for x in (opp_children.get(opp.id, {}).get("requestIds") or [])
                if str(x).strip()
            )
        request_geo: dict[str, str] = {}
        if all_rids:
            req_rows = await RequestRepository(self.db).list_by_ids(list(dict.fromkeys(all_rids)))
            req_children = await RequestRepository(self.db).list_request_children(
                [r.id for r in req_rows]
            )
            for req in req_rows:
                meta = req_children.get(req.id, {}).get("importMeta")
                request_geo[req.id] = resolve_request_geo_source(
                    code=req.code,
                    data={"importMeta": meta} if meta else None,
                )

        out: dict[str, str] = {}
        for row in rows:
            cid = (row.source_contract_id or "").strip()
            contract = contract_by_id.get(cid) if cid else None
            oid = str((contract.opportunity_id if contract else None) or row.opportunity_id or "").strip()
            linked: str | None = None
            if oid and oid in opp_by_id:
                odoc = {
                    "requestIds": opp_children.get(oid, {}).get("requestIds") or [],
                    "geoSource": getattr(opp_by_id[oid], "geo_source", None),
                }
                linked = opportunity_geo_from_request_map(odoc, request_geo)
            out[row.id] = coalesce_geo_sources(
                linked,
                resolve_document_geo_source({"geoSource": getattr(contract, "geo_source", None)}),
                normalize_geo_source(getattr(row, "geo_source", None)),
            )
        return out

    async def _resolve_row_geo(self, row: Project) -> str:
        resolved = await self._resolve_rows_geo([row])
        return resolved.get(row.id, "manual")

    async def _resolve_opportunity_geo_id(self, opportunity_id: str) -> str | None:
        """商机：绑定需求优先，再 stamp（与 CRM 一致）。"""
        from app.modules.requests.repository import RequestRepository

        opp = await self.crm.get_opportunity(opportunity_id)
        if not opp:
            return None
        children = await self.crm.get_opportunity_children(opportunity_id)
        ids = [str(x).strip() for x in (children.get("requestIds") or []) if str(x).strip()]
        request_geo: dict[str, str] = {}
        if ids:
            rows = await RequestRepository(self.db).list_by_ids(ids)
            req_children = await RequestRepository(self.db).list_request_children(
                [r.id for r in rows]
            )
            for req in rows:
                meta = req_children.get(req.id, {}).get("importMeta")
                request_geo[req.id] = resolve_request_geo_source(
                    code=req.code,
                    data={"importMeta": meta} if meta else None,
                )
        return opportunity_geo_from_request_map(
            {
                "requestIds": children.get("requestIds") or [],
                "geoSource": getattr(opp, "geo_source", None),
            },
            request_geo,
        )

    async def _assert_geo_visible(self, user: AuthUser, row: Project) -> None:
        forced = forced_geo_source(user)
        if not forced:
            return
        geo = await self._resolve_row_geo(row)
        if not matches_forced_geo(forced, geo):
            raise PermissionDeniedError("无权查看非海外归属的项目")

    async def _assert_row_visible(self, user: AuthUser, row: Project) -> None:
        await self._assert_geo_visible(user, row)
        if self._is_ops_admin(user) or user_data_scope(user) == "all":
            return
        if self._user_on_team(user, row):
            return
        assistant_items = await self.repo.list_string_items([row.id])
        project_people = (
            (assistant_items.get(row.id, {}).get("assistant_members") or [])
            + (assistant_items.get(row.id, {}).get("project_leader") or [])
            + (assistant_items.get(row.id, {}).get("content_ops_members") or [])
        )
        if (user.name or "").strip() in project_people:
            return
        # 未分配人员：有写权限的 CS 可见，便于认领
        if self._team_empty(row) and user_has_permission(user, "projects:write"):
            return
        scope = user_data_scope(user)
        if scope == "department":
            peer_ids = await self.users.get_department_peer_user_ids(
                user.id, user.department_names
            )
            if any(
                x and x in peer_ids
                for x in (
                    row.project_manager_user_id,
                    row.executor_user_id,
                    row.content_ops_user_id,
                    row.biz_owner_user_id,
                )
            ):
                return
        raise PermissionDeniedError("无权查看该项目")

    def _to_record(
        self,
        row: Project,
        *,
        geo_source: str | None = None,
        string_items: dict[str, list[str]] | None = None,
    ) -> ProjectRecord:
        string_items = string_items or {}
        computed = compute_project_fields(row)
        amount = _as_float(row.contract_amount)
        return ProjectRecord(
            id=row.id,
            name=row.name or "",
            customer_id=row.customer_id or "",
            customer_name=row.customer_name or "",
            source_contract_id=row.source_contract_id,
            opportunity_id=row.opportunity_id,
            geo_source=geo_source if geo_source is not None else normalize_geo_source(getattr(row, "geo_source", None)),
            stage=row.stage,  # type: ignore[arg-type]
            health=row.health,  # type: ignore[arg-type]
            risk_level=row.risk_level,  # type: ignore[arg-type]
            biz_owner=row.biz_owner or "",
            biz_owner_user_id=row.biz_owner_user_id,
            project_manager=row.project_manager or "",
            project_manager_user_id=row.project_manager_user_id,
            project_leader=(string_items.get("project_leader") or [""])[0],
            executor=row.executor or "",
            executor_user_id=row.executor_user_id,
            content_ops=row.content_ops or "",
            content_ops_user_id=row.content_ops_user_id,
            content_ops_members=string_items.get("content_ops_members") or [],
            contract_amount=amount,
            customer_industry=row.customer_industry or "",
            customer_type=row.customer_type or "",
            customer_region=row.customer_region or "",
            contact_info=row.contact_info or "",
            team_name=row.team_name or "",
            content_team_name=(string_items.get("content_team_name") or [""])[0],
            office=row.office or "",
            customer_level=row.customer_level or "",
            customer_tags=string_items.get("customer_tags") or [],
            assistant_members=string_items.get("assistant_members") or [],
            execution_members=string_items.get("execution_members") or ([row.executor] if row.executor else []),
            acceptance_criteria=row.acceptance_criteria or "",
            project_types=string_items.get("project_types") or [],
            intent_brand=int(row.intent_brand or 0),
            intent_content=int(row.intent_content or 0),
            intent_search=int(row.intent_search or 0),
            platforms=string_items.get("platforms") or [],
            detection_platforms=string_items.get("detection_platforms") or [],
            monitoring_intent_count=int(row.intent_content or 0),
            renewal_status=(string_items.get("renewal_status") or [""])[0],
            kpi_notes=row.kpi_notes or "",
            start_date=row.start_date.isoformat() if row.start_date else None,
            planned_start_date=row.planned_start_date.isoformat() if row.planned_start_date else None,
            sow_end_date=row.sow_end_date.isoformat() if row.sow_end_date else None,
            original_delivery_date=row.original_delivery_date.isoformat() if row.original_delivery_date else None,
            latest_delivery_date=row.latest_delivery_date.isoformat() if row.latest_delivery_date else None,
            actual_delivery_date=row.actual_delivery_date.isoformat() if row.actual_delivery_date else None,
            delay_reason=row.delay_reason or "",
            remediation_plan=row.remediation_plan or "",
            delay_customer_note=row.delay_customer_note or "",
            created_at=format_legacy_time(row.created_at),
            updated_at=format_legacy_time(row.updated_at),
            created_by=row.created_by,
            updated_by=row.updated_by,
            archived_at=format_legacy_time(row.archived_at) if row.archived_at else None,
            **computed,
        )

    def _note_to_item(self, row: ProjectNote) -> ProjectNoteItem:
        return ProjectNoteItem(
            id=row.id,
            project_id=row.project_id,
            kind=row.kind,  # type: ignore[arg-type]
            content=row.content or "",
            created_at=format_legacy_time(row.created_at),
            created_by=row.created_by or "",
            created_by_user_id=row.created_by_user_id,
        )

    def _work_item_to_record(self, row: ProjectWorkItem) -> ProjectWorkItemRecord:
        try:
            data = json.loads(row.document_json or "{}")
            if not isinstance(data, dict):
                data = {}
        except (TypeError, ValueError):
            data = {}
        overdue = bool(
            row.due_date
            and row.due_date < _china_today()
            and (row.status or "") not in DONE_STATUSES
        )
        return ProjectWorkItemRecord(
            id=row.id,
            project_id=row.project_id,
            kind=row.kind,  # type: ignore[arg-type]
            title=row.title or "",
            description=row.description or "",
            category=row.category or "",
            status=row.status or "pending",
            owner=row.owner or "",
            owner_user_id=row.owner_user_id,
            due_date=row.due_date.isoformat() if row.due_date else None,
            priority=row.priority or "medium",
            risk_level=row.risk_level or "low",
            solution=row.solution or "",
            occurred_at=format_legacy_time(row.occurred_at) if row.occurred_at else None,
            resolved_at=format_legacy_time(row.resolved_at) if row.resolved_at else None,
            data=data,
            created_by=row.created_by or "",
            created_by_user_id=row.created_by_user_id,
            created_at=format_legacy_time(row.created_at),
            updated_at=format_legacy_time(row.updated_at),
            overdue=overdue,
        )

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise ValidationError("时间格式无效")

    @staticmethod
    def _parse_date(value: Any) -> date | None:
        text = str(value or "").strip()[:10]
        if not text:
            return None
        try:
            return date.fromisoformat(text)
        except ValueError:
            raise ValidationError("日期格式无效")

    async def _scope_kwargs(self, user: AuthUser, *, mine_only: bool) -> dict[str, Any]:
        if mine_only:
            return {"mine_user_id": user.id, "mine_name": (user.name or "").strip() or None}
        if self._is_ops_admin(user) or user_data_scope(user) == "all":
            return {}
        scope = user_data_scope(user)
        include_unassigned = user_has_permission(user, "projects:write")
        if scope == "department":
            peer_ids = list(
                await self.users.get_department_peer_user_ids(user.id, user.department_names)
            )
            if user.id and user.id not in peer_ids:
                peer_ids.append(user.id)
            names = [(user.name or "").strip()] if (user.name or "").strip() else []
            return {
                "scope_user_ids": peer_ids,
                "scope_names": names,
                "include_unassigned": include_unassigned,
            }
        # own
        return {
            "scope_user_ids": [user.id] if user.id else [],
            "scope_names": [(user.name or "").strip()] if (user.name or "").strip() else [],
            "include_unassigned": include_unassigned,
        }

    async def list_projects(
        self,
        user: AuthUser,
        *,
        view: str = "active",
        keyword: str | None = None,
        stage: str | None = None,
        health: str | None = None,
        risk_level: str | None = None,
        office: str | None = None,
        renewal_warning: bool = False,
        mine_only: bool = False,
        amount_min: float | None = None,
        amount_max: float | None = None,
        sow_from: str | None = None,
        sow_to: str | None = None,
        updated_from: str | None = None,
        updated_to: str | None = None,
        due_days_min: int | None = None,
        due_days_max: int | None = None,
    ) -> ProjectListResponse:
        self._assert_section(user)
        kwargs = await self._scope_kwargs(user, mine_only=mine_only)
        rows = await self.repo.list_projects(
            view=view if view in {"active", "archive"} else "active",
            keyword=keyword,
            stage=stage,
            health=health,
            risk_level=risk_level,
            office=office,
            renewal_warning_only=renewal_warning,
            amount_min=amount_min,
            amount_max=amount_max,
            sow_from=sow_from,
            sow_to=sow_to,
            updated_from=updated_from,
            updated_to=updated_to,
            due_days_min=due_days_min,
            due_days_max=due_days_max,
            today=_china_today(),
            **kwargs,
        )
        forced = forced_geo_source(user)
        geo_by_id = await self._resolve_rows_geo(rows)
        string_items = await self.repo.list_string_items([r.id for r in rows])
        items: list[ProjectRecord] = []
        for r in rows:
            geo = geo_by_id.get(r.id, "manual")
            if forced and not matches_forced_geo(forced, geo):
                continue
            items.append(
                self._to_record(
                    r,
                    geo_source=geo,
                    string_items=string_items.get(r.id),
                )
            )
        return ProjectListResponse(items=items, total=len(items))

    async def stats(self, user: AuthUser, *, view: str = "active") -> ProjectStatsResponse:
        self._assert_section(user)
        listed = await self.list_projects(user, view=view)
        items = listed.items
        return ProjectStatsResponse(
            active=sum(1 for p in items if p.stage == "active"),
            delayed=sum(1 for p in items if p.delivery_delay_days > 0),
            renewal_warning=sum(1 for p in items if p.renewal_warning),
            unhealthy=sum(1 for p in items if p.health == "unhealthy"),
            completed=sum(1 for p in items if p.stage == "completed"),
        )

    async def get_project(self, user: AuthUser, project_id: str) -> ProjectRecord:
        self._assert_section(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        geo = await self._resolve_row_geo(row)
        string_items = await self.repo.list_string_items([row.id])
        return self._to_record(row, geo_source=geo, string_items=string_items.get(row.id))

    @staticmethod
    def _attachment_to_item(row: Any) -> ProjectAttachmentItem:
        return ProjectAttachmentItem(
            id=row.id,
            name=row.name or row.id,
            size=int(row.size or 0),
            url=row.url or f"/api/crm/attachments/{row.id}",
            content_type=row.content_type or "application/pdf",
            storage_path=row.storage_path,
            uploaded_at=format_legacy_time(row.uploaded_at) if row.uploaded_at else "",
            uploaded_by=row.uploaded_by or "",
        )

    async def list_attachments(
        self, user: AuthUser, project_id: str
    ) -> ProjectAttachmentsResponse:
        self._assert_section(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        attachments = await self.repo.list_project_attachments(project_id)
        return ProjectAttachmentsResponse(
            items=[self._attachment_to_item(item) for item in attachments]
        )

    async def add_attachments(
        self,
        user: AuthUser,
        project_id: str,
        records: list[dict[str, Any]],
    ) -> ProjectAttachmentsResponse:
        self._assert_section(user)
        self._assert_write(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        if not records:
            raise ValidationError("请选择要上传的 PDF 附件")
        if any(str(item.get("contentType") or "").lower() != "application/pdf" for item in records):
            raise ValidationError("项目附件仅支持 PDF 文件")

        added = await self.repo.add_project_attachments(
            project_id,
            records,
            uploaded_by=user.name or user.id,
        )
        names = "、".join(item.name for item in added[:3])
        if len(added) > 3:
            names += f" 等 {len(added)} 个文件"
        await self.repo.add_note(
            project_id=project_id,
            kind="other",
            content=f"上传项目附件：{names}",
            created_by=user.name or user.id,
            created_by_user_id=user.id,
        )
        row.updated_by = user.name or user.id
        await self.repo.save(row)
        await self.db.commit()
        return ProjectAttachmentsResponse(
            items=[self._attachment_to_item(item) for item in added]
        )

    @staticmethod
    def _project_sow_snapshot(
        row: Project, string_items: dict[str, list[str]] | None
    ) -> dict[str, Any]:
        values = string_items or {}
        return {
            "projectTypes": list(values.get("project_types") or []),
            "platforms": list(values.get("platforms") or []),
            "optimizationIntentCount": int(row.intent_brand or 0)
            + int(row.intent_content or 0)
            + int(row.intent_search or 0),
            "optimizationTarget": row.kpi_notes or "",
            "acceptanceCriteria": row.acceptance_criteria or "",
            "clauses": [],
        }

    @staticmethod
    def _read_sow_snapshot(raw: str) -> dict[str, Any]:
        try:
            data = json.loads(raw or "{}")
            return data if isinstance(data, dict) else {}
        except (TypeError, ValueError):
            return {}

    @staticmethod
    def _sow_version_to_record(row: ProjectSowVersion) -> ProjectSowVersionRecord:
        snapshot = ProjectsService._read_sow_snapshot(row.snapshot_json)
        clauses = []
        for item in snapshot.get("clauses") or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            content = str(item.get("content") or "").strip()
            if title or content:
                clauses.append(ProjectSowClause(title=title, content=content))
        return ProjectSowVersionRecord(
            id=row.id,
            project_id=row.project_id,
            version_no=row.version_no,
            is_current=row.is_current,
            sow_end_date=row.sow_end_date.isoformat(),
            project_types=_str_list(snapshot.get("projectTypes")),
            platforms=_str_list(snapshot.get("platforms")),
            optimization_intent_count=max(0, int(snapshot.get("optimizationIntentCount") or 0)),
            optimization_target=str(snapshot.get("optimizationTarget") or ""),
            acceptance_criteria=str(snapshot.get("acceptanceCriteria") or ""),
            clauses=clauses,
            change_reason=row.change_reason or "",
            confirmer=row.confirmer or "",
            source_change_id=row.source_change_id,
            created_by=row.created_by or "",
            created_at=format_legacy_time(row.created_at),
        )

    @staticmethod
    def _virtual_sow_record(
        row: Project, snapshot: dict[str, Any]
    ) -> ProjectSowVersionRecord:
        return ProjectSowVersionRecord(
            id=f"{row.id}-sow-baseline",
            project_id=row.id,
            version_no=1,
            is_current=True,
            sow_end_date=row.sow_end_date.isoformat() if row.sow_end_date else "",
            project_types=_str_list(snapshot.get("projectTypes")),
            platforms=_str_list(snapshot.get("platforms")),
            optimization_intent_count=int(snapshot.get("optimizationIntentCount") or 0),
            optimization_target=str(snapshot.get("optimizationTarget") or ""),
            acceptance_criteria=str(snapshot.get("acceptanceCriteria") or ""),
            clauses=[],
            change_reason="项目初始 SOW（首次变更时自动固化留档）",
            created_by=row.created_by or "系统",
            created_at=format_legacy_time(row.created_at),
            virtual=True,
        )

    @staticmethod
    def _sow_change_lines(
        before_end_date: str,
        before: dict[str, Any],
        after_end_date: str,
        after: dict[str, Any],
    ) -> tuple[list[str], str, str]:
        fields = (
            ("sowEndDate", "SOW 截止时间", before_end_date, after_end_date),
            ("projectTypes", "项目类型", before.get("projectTypes") or [], after.get("projectTypes") or []),
            ("platforms", "覆盖平台", before.get("platforms") or [], after.get("platforms") or []),
            ("optimizationIntentCount", "优化意图数量", before.get("optimizationIntentCount") or 0, after.get("optimizationIntentCount") or 0),
            ("optimizationTarget", "优化目标", before.get("optimizationTarget") or "", after.get("optimizationTarget") or ""),
            ("acceptanceCriteria", "验收标准", before.get("acceptanceCriteria") or "", after.get("acceptanceCriteria") or ""),
            ("clauses", "其他 SOW 细则", before.get("clauses") or [], after.get("clauses") or []),
        )
        changed: list[str] = []
        before_lines: list[str] = []
        after_lines: list[str] = []
        for key, label, old, new in fields:
            if old == new:
                continue
            changed.append(label)
            if isinstance(old, list):
                old_text = "、".join(
                    str(x.get("title") or x.get("content") or "") if isinstance(x, dict) else str(x)
                    for x in old
                ) or "未设置"
                new_text = "、".join(
                    str(x.get("title") or x.get("content") or "") if isinstance(x, dict) else str(x)
                    for x in new
                ) or "未设置"
            else:
                old_text = str(old or "未设置")
                new_text = str(new or "未设置")
            before_lines.append(f"{label}：{old_text}")
            after_lines.append(f"{label}：{new_text}")
        return changed, "\n".join(before_lines), "\n".join(after_lines)

    async def list_sow_versions(
        self, user: AuthUser, project_id: str
    ) -> ProjectSowVersionsResponse:
        self._assert_section(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        versions = await self.repo.list_sow_versions(project_id)
        if versions:
            items = [self._sow_version_to_record(item) for item in versions]
            current = next((item for item in items if item.is_current), items[0])
            return ProjectSowVersionsResponse(current=current, items=items)
        strings = (await self.repo.list_string_items([project_id])).get(project_id)
        current = self._virtual_sow_record(row, self._project_sow_snapshot(row, strings))
        return ProjectSowVersionsResponse(current=current, items=[current])

    async def create_sow_version(
        self,
        user: AuthUser,
        project_id: str,
        body: CreateProjectSowVersionBody,
    ) -> ProjectSowVersionsResponse:
        self._assert_section(user)
        self._assert_write(user)
        project = await self.repo.get_for_update(project_id)
        if not project:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, project)
        change_type = (body.change_type or "").strip()
        allowed_change_types = {
            "客户需求变更", "内部方案调整", "SOW 交付范围调整", "KPI / 验收标准调整",
        }
        if change_type not in allowed_change_types:
            raise ValidationError("请选择有效的变更类型")
        reason = (body.change_reason or "").strip()
        if not reason:
            raise ValidationError("请填写变更原因")
        confirmer = (body.confirmer or "").strip()
        if not confirmer:
            raise ValidationError("请填写确认人")
        if body.optimization_intent_count < 0:
            raise ValidationError("优化意图数量不能为负数")
        clauses = [
            {"title": item.title.strip()[:128], "content": item.content.strip()[:5000]}
            for item in body.clauses[:50]
            if item.title.strip() or item.content.strip()
        ]
        snapshot = {
            "projectTypes": [str(x).strip() for x in body.project_types if str(x).strip()],
            "platforms": [str(x).strip() for x in body.platforms if str(x).strip()],
            "optimizationIntentCount": body.optimization_intent_count,
            "optimizationTarget": (body.optimization_target or "").strip(),
            "acceptanceCriteria": (body.acceptance_criteria or "").strip(),
            "clauses": clauses,
        }

        strings = (await self.repo.list_string_items([project_id])).get(project_id)
        existing = await self.repo.list_sow_versions(project_id)
        if existing:
            current_row = next((item for item in existing if item.is_current), existing[0])
            before_snapshot = self._read_sow_snapshot(current_row.snapshot_json)
            before_end = current_row.sow_end_date.isoformat()
            next_version = max(item.version_no for item in existing) + 1
            await self.repo.deactivate_sow_versions(project_id)
        else:
            before_snapshot = self._project_sow_snapshot(project, strings)
            before_end = project.sow_end_date.isoformat() if project.sow_end_date else ""
            baseline_end = project.sow_end_date or body.sow_end_date
            await self.repo.create_sow_version(
                project_id=project_id,
                version_no=1,
                is_current=False,
                sow_end_date=baseline_end,
                snapshot=before_snapshot,
                change_reason="项目初始 SOW（系统固化留档）",
                confirmer="",
                created_by=project.created_by or "系统",
                created_by_user_id=None,
            )
            next_version = 2

        changed, before_text, after_text = self._sow_change_lines(
            before_end,
            before_snapshot,
            body.sow_end_date.isoformat(),
            snapshot,
        )
        if not changed:
            raise ValidationError("SOW 内容未发生变化，无需创建新版本")

        now = china_now().replace(microsecond=0)
        change_item = await self.repo.create_work_item(
            project_id=project_id,
            fields={
                "kind": "change",
                "title": f"{change_type}：SOW V{next_version}（{'、'.join(changed)}）",
                "description": reason,
                "category": change_type,
                "status": "completed",
                "owner": user.name or user.id,
                "owner_user_id": user.id,
                "priority": "medium",
                "risk_level": "low",
                "occurred_at": now,
                "resolved_at": now,
                "document_json": json.dumps(
                    {
                        "beforeText": before_text,
                        "afterText": after_text,
                        "requester": user.name or user.id,
                        "confirmer": confirmer,
                        "changedFields": changed,
                        "sowVersion": next_version,
                        "changeType": change_type,
                        "attachments": [
                            {
                                "id": item.id,
                                "name": item.name,
                                "url": item.url,
                                "size": item.size,
                            }
                            for item in body.attachments
                        ],
                    },
                    ensure_ascii=False,
                ),
                "created_by": user.name or user.id,
                "created_by_user_id": user.id,
            },
        )
        current = await self.repo.create_sow_version(
            project_id=project_id,
            version_no=next_version,
            is_current=True,
            sow_end_date=body.sow_end_date,
            snapshot=snapshot,
            change_reason=reason,
            confirmer=confirmer[:128],
            source_change_id=change_item.id,
            created_by=user.name or user.id,
            created_by_user_id=user.id,
        )

        if project.original_delivery_date is None:
            project.original_delivery_date = project.sow_end_date or body.sow_end_date
        project.sow_end_date = body.sow_end_date
        project.latest_delivery_date = body.sow_end_date
        project.intent_brand = body.optimization_intent_count
        project.intent_content = 0
        project.intent_search = 0
        project.kpi_notes = snapshot["optimizationTarget"]
        project.acceptance_criteria = snapshot["acceptanceCriteria"]
        project.updated_by = user.name or user.id
        await self.repo.sync_string_items(
            project_id,
            project_types=snapshot["projectTypes"],
            platforms=snapshot["platforms"],
        )
        await self.repo.save(project)
        await self.db.commit()
        await self.db.refresh(current)
        versions = await self.repo.list_sow_versions(project_id)
        items = [self._sow_version_to_record(item) for item in versions]
        return ProjectSowVersionsResponse(
            current=next(item for item in items if item.is_current),
            items=items,
        )

    async def get_project_by_contract(self, user: AuthUser, contract_id: str) -> ProjectRecord:
        """按来源合同查交付项目，并复用项目行级可见性校验。"""
        self._assert_section(user)
        row = await self.repo.get_by_contract_id(contract_id)
        if not row:
            raise NotFoundError("该合同尚未生成交付项目")
        return await self.get_project(user, row.id)

    async def list_projects_by_customer(
        self, user: AuthUser, customer_id: str
    ) -> ProjectListResponse:
        """返回该用户可见的客户关联项目；不可见项目不泄露存在性。"""
        self._assert_section(user)
        rows = await self.repo.list_by_customer_id(customer_id)
        visible: list[Project] = []
        for row in rows:
            try:
                await self._assert_row_visible(user, row)
            except PermissionDeniedError:
                continue
            visible.append(row)
        geo_map = await self._resolve_rows_geo(visible)
        string_items = await self.repo.list_string_items([row.id for row in visible])
        items = [
            self._to_record(
                row,
                geo_source=geo_map.get(row.id),
                string_items=string_items.get(row.id),
            )
            for row in visible
        ]
        return ProjectListResponse(items=items, total=len(items))

    async def patch_project(self, user: AuthUser, project_id: str, body: PatchProjectBody) -> ProjectRecord:
        self._assert_section(user)
        self._assert_write(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)

        data = body.model_dump(exclude_unset=True)
        existing_strings = (await self.repo.list_string_items([row.id])).get(row.id, {})
        previous_renewal_status = (existing_strings.get("renewal_status") or [""])[0]
        allowed = set(CS_PATCH_FIELDS)
        if self._is_ops_admin(user):
            allowed |= OPS_EXTRA_FIELDS
        # 反归档：仅 ops/admin
        if (
            data.get("stage")
            and data["stage"] != "completed"
            and row.stage == "completed"
            and not self._is_ops_admin(user)
        ):
            raise PermissionDeniedError("仅运营/管理员可将归档项目恢复")

        for key in list(data.keys()):
            if key not in allowed:
                data.pop(key)

        if "stage" in data and data["stage"] not in STAGES:
            raise ValidationError("无效的项目阶段")
        if "health" in data and data["health"] not in HEALTHS:
            raise ValidationError("无效的健康度")
        if "risk_level" in data and data["risk_level"] not in RISKS:
            raise ValidationError("无效的风险级别")

        if data.get("latest_delivery_date") and not row.original_delivery_date and "original_delivery_date" not in data:
            data["original_delivery_date"] = data["latest_delivery_date"]

        if data.get("clear_start_date"):
            row.start_date = None
        if data.get("clear_planned_start_date"):
            row.planned_start_date = None
        if data.get("clear_sow_end_date"):
            row.sow_end_date = None
        if data.get("clear_original_delivery_date"):
            row.original_delivery_date = None
        if data.get("clear_latest_delivery_date"):
            row.latest_delivery_date = None
        if data.get("clear_actual_delivery_date"):
            row.actual_delivery_date = None

        for key, value in data.items():
            if key in {
                "clear_start_date", "clear_planned_start_date", "clear_sow_end_date", "clear_original_delivery_date",
                "clear_latest_delivery_date", "clear_actual_delivery_date",
            }:
                continue
            if key in {"project_types", "platforms", "customer_tags", "assistant_members", "project_leader", "execution_members", "content_ops_members", "content_team_name", "detection_platforms", "renewal_status"}:
                continue
            if key == "contract_amount":
                row.contract_amount = Decimal(str(value)) if value is not None else None
                continue
            if key in {"intent_brand", "intent_content", "intent_search"}:
                n = int(value or 0)
                if n < 0:
                    raise ValidationError("意图数不能为负数")
                setattr(row, key, n)
                continue
            if key == "optimization_intent_count":
                n = int(value or 0)
                if n < 0:
                    raise ValidationError("优化意图数量不能为负数")
                row.intent_brand = n
                row.intent_content = 0
                row.intent_search = 0
                continue
            if key == "monitoring_intent_count":
                n = int(value or 0)
                if n < 0:
                    raise ValidationError("监控意图数量不能为负数")
                row.intent_content = n
                continue
            setattr(row, key, value)

        if row.stage == "completed":
            if not row.archived_at:
                row.archived_at = china_now().replace(microsecond=0)
        else:
            row.archived_at = None

        row.updated_by = user.name or user.id
        await self.repo.save(row)
        field_labels = {
            "name": "项目名称", "stage": "项目状态", "health": "健康度",
            "risk_level": "风险等级", "project_manager": "项目经理",
            "project_leader": "项目负责人",
            "executor": "执行人", "content_ops": "内容运营", "office": "地点",
            "project_types": "项目类型", "optimization_intent_count": "优化意图数量",
            "monitoring_intent_count": "监控意图数量", "detection_platforms": "检测平台",
            "renewal_status": "续约确认", "execution_members": "项目执行成员",
            "content_ops_members": "内容运营成员", "content_team_name": "内容所属团队",
            "start_date": "项目启动时间", "planned_start_date": "计划启动时间",
            "latest_delivery_date": "计划交付时间", "actual_delivery_date": "实际交付时间",
            "delay_reason": "延期原因", "remediation_plan": "补救措施",
        }
        changed_labels = [field_labels[key] for key in data if key in field_labels]
        if changed_labels:
            await self.repo.add_note(
                project_id=row.id,
                kind="other",
                content=f"更新项目：{'、'.join(dict.fromkeys(changed_labels))}",
                created_by=user.name or user.id,
                created_by_user_id=user.id,
            )
        if any(key in data for key in ("project_types", "platforms", "customer_tags", "assistant_members", "project_leader", "execution_members", "content_ops_members", "content_team_name", "detection_platforms", "renewal_status")):
            await self.repo.sync_string_items(
                row.id,
                project_types=data.get("project_types") if "project_types" in data else None,
                platforms=data.get("platforms") if "platforms" in data else None,
                customer_tags=data.get("customer_tags") if "customer_tags" in data else None,
                assistant_members=data.get("assistant_members") if "assistant_members" in data else None,
                project_leader=([data.get("project_leader")] if data.get("project_leader") else []) if "project_leader" in data else None,
                execution_members=data.get("execution_members") if "execution_members" in data else None,
                content_ops_members=data.get("content_ops_members") if "content_ops_members" in data else None,
                content_team_name=([data.get("content_team_name")] if data.get("content_team_name") else []) if "content_team_name" in data else None,
                detection_platforms=data.get("detection_platforms") if "detection_platforms" in data else None,
                renewal_status=([data.get("renewal_status")] if data.get("renewal_status") else []) if "renewal_status" in data else None,
            )
        next_renewal_status = str(data.get("renewal_status") or "")
        if next_renewal_status in {"yes", "no"} and next_renewal_status != previous_renewal_status and row.biz_owner:
            await self.crm.create_notification(
                record_id=f"ntf-renewal-{uuid4().hex}",
                target_name=row.biz_owner,
                target_user_id=row.biz_owner_user_id,
                actor=user.name or user.id,
                actor_user_id=user.id,
                message=f"项目「{row.name}」已确认{'续约' if next_renewal_status == 'yes' else '不续约'}，请销售及时跟进",
                href=f"/projects/{row.id}",
            )
        await self.db.commit()
        await self.db.refresh(row)
        string_items = await self.repo.list_string_items([row.id])
        return self._to_record(row, string_items=string_items.get(row.id))

    async def list_notes(
        self, user: AuthUser, project_id: str, *, kind: str | None = None
    ) -> ProjectNotesResponse:
        self._assert_section(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        notes = await self.repo.list_notes(project_id, kind=kind)
        return ProjectNotesResponse(items=[self._note_to_item(n) for n in notes])

    async def add_note(self, user: AuthUser, project_id: str, body: CreateProjectNoteBody) -> ProjectNoteItem:
        self._assert_section(user)
        self._assert_write(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        content = (body.content or "").strip()
        if not content:
            raise ValidationError("记录内容不能为空")
        kind = body.kind if body.kind in NOTE_KINDS else "other"
        note = await self.repo.add_note(
            project_id=project_id,
            kind=kind,
            content=content,
            created_by=user.name or user.id,
            created_by_user_id=user.id,
        )
        row.updated_by = user.name or user.id
        await self.repo.save(row)
        await self.db.commit()
        await self.db.refresh(note)
        return self._note_to_item(note)

    async def delete_note(self, user: AuthUser, project_id: str, note_id: str) -> None:
        self._assert_section(user)
        self._assert_write(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        note = await self.repo.get_note(note_id)
        if not note or note.project_id != project_id:
            raise NotFoundError("记录不存在")
        if not self._is_ops_admin(user) and note.created_by_user_id and note.created_by_user_id != user.id:
            raise PermissionDeniedError("仅作者或运营可删除该记录")
        await self.repo.delete_note(note)
        await self.db.commit()

    async def list_work_items(
        self, user: AuthUser, project_id: str, *, kind: str | None = None
    ) -> ProjectWorkItemsResponse:
        self._assert_section(user)
        row = await self.repo.get(project_id)
        if not row:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, row)
        normalized_kind = kind if kind in WORK_ITEM_KINDS else None
        items = await self.repo.list_work_items([project_id], kind=normalized_kind)
        return ProjectWorkItemsResponse(items=[self._work_item_to_record(item) for item in items])

    async def create_work_item(
        self, user: AuthUser, project_id: str, body: ProjectWorkItemBody
    ) -> ProjectWorkItemRecord:
        self._assert_section(user)
        self._assert_write(user)
        project = await self.repo.get(project_id)
        if not project:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, project)
        data = body.model_dump(exclude_unset=True)
        kind = str(data.get("kind") or "")
        if kind not in WORK_ITEM_KINDS:
            raise ValidationError("请选择事项类型")
        if kind == "change":
            raise ValidationError("需求变更请从项目详情的需求变更页发起，系统会同步生成变更记录和新 SOW 版本")
        title = str(data.get("title") or "").strip()
        if not title:
            raise ValidationError("请填写标题")
        if kind in {"issue", "help"} and not str(data.get("category") or "").strip():
            raise ValidationError("新建问题时请选择问题类型")
        defaults = {
            "task": "processing", "issue": "processing", "change": "processing",
            "risk": "processing", "follow_up": "completed", "help": "processing",
            "appeasement": "completed", "delay": "processing", "delivery": "completed",
        }
        status = _normalize_work_item_status(kind, str(data.get("status") or defaults[kind]))
        now = china_now().replace(microsecond=0)
        priority = str(data.get("priority") or "medium")
        due_date = data.get("due_date")
        if kind in {"issue", "help"} and not due_date:
            raise ValidationError("请填写截止日期")
        owner = str(data.get("owner") or "").strip()
        if kind in {"issue", "help"} and not owner:
            owner = user.name or user.id
        fields = {
            **data,
            "kind": kind,
            "title": title,
            "description": str(data.get("description") or "").strip(),
            "category": str(data.get("category") or "").strip(),
            "status": status,
            "owner": owner,
            "due_date": due_date,
            "priority": priority,
            "risk_level": str(data.get("risk_level") or "low"),
            "solution": str(data.get("solution") or "").strip(),
            "occurred_at": self._parse_datetime(data.get("occurred_at")) or now,
            "resolved_at": self._parse_datetime(data.get("resolved_at")) or (now if status in DONE_STATUSES else None),
            "document_json": json.dumps(data.get("data") or {}, ensure_ascii=False),
            "created_by": user.name or user.id,
            "created_by_user_id": user.id,
        }
        item = await self.repo.create_work_item(project_id=project_id, fields=fields)

        if kind == "risk" and fields["risk_level"] == "high":
            project.risk_level = "high"
            project.health = "unhealthy"
        elif kind == "delay":
            project.stage = "active"
            project.risk_level = max(project.risk_level or "low", fields["risk_level"], key=lambda x: {"low": 0, "medium": 1, "high": 2}.get(x, 0))
            project.delay_reason = fields["description"] or title
            project.remediation_plan = fields["solution"]
        elif kind == "follow_up" and str((data.get("data") or {}).get("customerEmotion") or "") == "high_risk":
            project.health = "unhealthy"
            project.risk_level = "high"
        project.updated_by = user.name or user.id
        await self.repo.save(project)
        await self.db.commit()
        await self.db.refresh(item)
        return self._work_item_to_record(item)

    async def patch_work_item(
        self, user: AuthUser, project_id: str, item_id: str, body: ProjectWorkItemBody
    ) -> ProjectWorkItemRecord:
        self._assert_section(user)
        self._assert_write(user)
        project = await self.repo.get(project_id)
        if not project:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, project)
        item = await self.repo.get_work_item(item_id)
        if not item or item.project_id != project_id:
            raise NotFoundError("事项不存在")
        if item.kind == "change":
            try:
                change_data = json.loads(item.document_json or "{}")
            except (TypeError, ValueError):
                change_data = {}
            if isinstance(change_data, dict) and change_data.get("sowVersion"):
                raise ValidationError("SOW 版本生成的需求变更记录不可编辑")
        data = body.model_dump(exclude_unset=True)
        if data.get("clear_due_date"):
            item.due_date = None
        for key in (
            "title", "description", "category", "status", "owner", "owner_user_id",
            "due_date", "priority", "risk_level", "solution",
        ):
            if key in data:
                value = data[key]
                if isinstance(value, str):
                    value = value.strip()
                setattr(item, key, value)
        if "status" in data:
            item.status = _normalize_work_item_status(item.kind, str(data.get("status") or ""))
        if "occurred_at" in data:
            item.occurred_at = self._parse_datetime(data.get("occurred_at"))
        if "resolved_at" in data:
            item.resolved_at = self._parse_datetime(data.get("resolved_at"))
        if "data" in data:
            item.document_json = json.dumps(data.get("data") or {}, ensure_ascii=False)
        if item.kind == "help" and item.status in DONE_STATUSES:
            if not (item.solution or "").strip():
                raise ValidationError("疑难问题解决后请填写解决方案，系统将自动沉淀到问题池")
            try:
                help_data = json.loads(item.document_json or "{}")
                if not isinstance(help_data, dict):
                    help_data = {}
            except (TypeError, ValueError):
                help_data = {}
            help_data["originKind"] = "help"
            help_data["archivedToProblemPoolAt"] = format_legacy_time(china_now())
            item.document_json = json.dumps(help_data, ensure_ascii=False)
            item.kind = "issue"
            item.category = item.category or "疑难问题"
        if item.status in DONE_STATUSES and not item.resolved_at:
            item.resolved_at = china_now().replace(microsecond=0)
        elif item.status not in DONE_STATUSES:
            item.resolved_at = None
        await self.repo.save_work_item(item)
        project.updated_by = user.name or user.id
        await self.repo.save(project)
        await self.db.commit()
        await self.db.refresh(item)
        return self._work_item_to_record(item)

    async def delete_work_item(
        self, user: AuthUser, project_id: str, item_id: str
    ) -> None:
        self._assert_section(user)
        self._assert_write(user)
        project = await self.repo.get(project_id)
        if not project:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, project)
        item = await self.repo.get_work_item(item_id)
        if not item or item.project_id != project_id:
            raise NotFoundError("事项不存在")
        if item.kind == "change":
            try:
                change_data = json.loads(item.document_json or "{}")
            except (TypeError, ValueError):
                change_data = {}
            if isinstance(change_data, dict) and change_data.get("sowVersion"):
                raise ValidationError("SOW 版本生成的需求变更记录不可删除")
        if not self._is_ops_admin(user) and item.created_by_user_id and item.created_by_user_id != user.id:
            raise PermissionDeniedError("仅创建人或运营可删除该事项")
        await self.repo.delete_work_item(item)
        await self.db.commit()

    async def payment_summary(self, user: AuthUser, project_id: str) -> ProjectPaymentSummary:
        self._assert_section(user)
        project = await self.repo.get(project_id)
        if not project:
            raise NotFoundError("项目不存在")
        await self._assert_row_visible(user, project)
        rows = await self.crm.list_payment_plans([project.source_contract_id])
        planned = sum(float(row.planned_amount or 0) for row in rows)
        paid = sum(float(row.actual_amount or 0) for row in rows)
        overdue_amount = 0.0
        next_date: date | None = None
        plans: list[dict[str, Any]] = []
        for row in rows:
            planned_amount = float(row.planned_amount or 0)
            actual_amount = float(row.actual_amount or 0)
            outstanding = max(planned_amount - actual_amount, 0)
            status = "paid" if outstanding <= 0 else (
                "overdue" if row.planned_date and row.planned_date < _china_today() else (
                    "partial" if actual_amount > 0 else "pending"
                )
            )
            if status == "overdue":
                overdue_amount += outstanding
            if outstanding > 0 and row.planned_date and (next_date is None or row.planned_date < next_date):
                next_date = row.planned_date
            plans.append({
                "id": row.id,
                "periodName": row.period_name,
                "plannedAmount": planned_amount,
                "plannedDate": row.planned_date.isoformat() if row.planned_date else "",
                "actualAmount": actual_amount,
                "actualPaymentDate": row.actual_payment_date.isoformat() if row.actual_payment_date else "",
                "outstandingAmount": outstanding,
                "paymentStatus": status,
                "invoiceStatus": row.invoice_status or "uninvoiced",
            })
        outstanding_total = max(planned - paid, 0)
        overall = "overdue" if overdue_amount > 0 else ("paid" if planned > 0 and outstanding_total <= 0 else "normal")
        return ProjectPaymentSummary(
            contract_amount=float(project.contract_amount or 0),
            planned_amount=planned,
            paid_amount=paid,
            outstanding_amount=outstanding_total,
            overdue_amount=overdue_amount,
            next_payment_date=next_date.isoformat() if next_date else None,
            status=overall,
            plans=plans,
        )

    async def problem_pool(
        self, user: AuthUser, *, keyword: str | None = None
    ) -> ProjectWorkItemsResponse:
        """跨项目问题池：普通问题与已解决的疑难问题统一检索。"""
        self._assert_section(user)
        # 问题库是项目模块内的公共知识库，不随个人项目数据范围裁剪。
        # 仅返回问题内容，不返回项目合同/客户等其他业务数据。
        active = await self.repo.list_projects(view="active")
        archived = await self.repo.list_projects(view="archive")
        projects = active + archived
        names = {project.id: project.name for project in projects}
        rows = await self.repo.list_work_items(list(names))
        term = (keyword or "").strip().lower()
        records: list[ProjectWorkItemRecord] = []
        for row in rows:
            if row.kind != "issue" and not (row.kind == "help" and row.status in DONE_STATUSES):
                continue
            searchable = " ".join(
                [row.title or "", row.description or "", row.category or "", row.solution or ""]
            ).lower()
            if term and term not in searchable:
                continue
            record = self._work_item_to_record(row)
            record.data = {
                **record.data,
                "projectName": names.get(row.project_id, ""),
                "projectId": row.project_id,
            }
            records.append(record)
        return ProjectWorkItemsResponse(items=records)

    async def dashboard(self, user: AuthUser) -> ProjectDashboardResponse:
        self._assert_section(user)
        active = (await self.list_projects(user, view="active")).items
        archived = (await self.list_projects(user, view="archive")).items
        projects = active + archived
        project_ids = [p.id for p in projects]
        items = await self.repo.list_work_items(project_ids)
        issues = [item for item in items if item.kind in {"issue", "help"}]
        tasks = [item for item in items if item.kind == "task"]
        resolved_issues = [item for item in issues if item.status in DONE_STATUSES]
        completed_tasks = [item for item in tasks if item.status in DONE_STATUSES]
        today = _china_today()
        overdue_issues = [item for item in issues if item.due_date and item.due_date < today and item.status not in DONE_STATUSES]
        blockers = Counter((item.category or item.title or "其他") for item in issues if item.status not in DONE_STATUSES)
        office_counts = Counter(
            (
                p.office
                or (
                    "北京"
                    if "北京" in (p.customer_region or "")
                    else "厦门"
                    if "厦门" in (p.customer_region or "")
                    else "未设置"
                )
            )
            for p in projects
        )

        def normalized_customer_level(value: str) -> str:
            raw = (value or "").strip().upper()
            if raw in {"P0", "P1", "P2"}:
                return raw
            if raw in {"S", "A", "重点", "战略"}:
                return "P0"
            if raw in {"B", "普通"}:
                return "P1"
            return "P2"

        def normalized_team(project: ProjectRecord) -> str:
            raw = (project.team_name or "").strip()
            if resolved_office(project) == "厦门":
                return raw or "厦门组"
            aliases = {"交付一组": "A组", "一组": "A组", "交付二组": "B组", "二组": "B组", "交付三组": "C组", "三组": "C组"}
            return aliases.get(raw, raw if raw in {"A组", "B组", "C组"} else "A组")

        project_by_id = {project.id: project for project in projects}

        def resolved_office(project: ProjectRecord) -> str:
            return project.office or (
                "北京"
                if "北京" in (project.customer_region or "")
                else "厦门"
                if "厦门" in (project.customer_region or "")
                else "未设置"
            )

        def project_row(project: ProjectRecord) -> dict[str, Any]:
            return {
                "rowType": "project",
                "projectId": project.id,
                "projectName": project.name,
                "customerName": project.customer_name,
                "owner": project.project_manager or project.biz_owner or project.executor or "未设置",
                "office": resolved_office(project),
                "teamName": normalized_team(project),
                "customerLevel": normalized_customer_level(project.customer_level),
                "status": project.stage,
                "plannedStartDate": project.planned_start_date or project.start_date or "",
                "plannedDate": project.latest_delivery_date or project.original_delivery_date or project.sow_end_date or "",
                "actualDate": project.actual_delivery_date or "",
                "amount": float(project.contract_amount or 0),
                "delayDays": project.delivery_delay_days,
                "detail": project.delay_reason or project.remediation_plan or "",
            }

        def work_item_row(item: ProjectWorkItem) -> dict[str, Any]:
            project = project_by_id.get(item.project_id)
            record = self._work_item_to_record(item)
            metadata = record.data
            return {
                "rowType": "workItem",
                "projectId": item.project_id,
                "projectName": project.name if project else "",
                "customerName": project.customer_name if project else "",
                "title": item.title or "未命名事项",
                "category": item.category or "其他",
                "owner": item.owner or "未设置",
                "status": item.status or "processing",
                "date": (
                    item.due_date.isoformat()
                    if item.due_date
                    else format_legacy_time(item.occurred_at or item.created_at)
                ),
                "overdue": bool(
                    item.due_date and item.due_date < today and item.status not in DONE_STATUSES
                ),
                "detail": item.solution or item.description or "",
                "responder": str(metadata.get("responder") or metadata.get("repliedBy") or item.owner or "未设置"),
                "reviewer": str(metadata.get("reviewer") or metadata.get("auditor") or "未审核"),
                "leaderAnswered": str(metadata.get("leaderAnswered") or "").lower() == "true" or metadata.get("responderRole") == "leader",
            }

        contract_ids = [p.source_contract_id for p in projects if p.source_contract_id]
        payment_rows = await self.crm.list_payment_plans(contract_ids)
        planned_payment = sum(float(row.planned_amount or 0) for row in payment_rows)
        paid_amount = sum(float(row.actual_amount or 0) for row in payment_rows)
        overdue_payment = sum(
            max(float(row.planned_amount or 0) - float(row.actual_amount or 0), 0)
            for row in payment_rows
            if row.planned_date and row.planned_date < today and float(row.actual_amount or 0) < float(row.planned_amount or 0)
        )
        delayed = sum(1 for p in projects if p.stage == "paused" or p.delivery_delay_days > 0)
        level_counts = Counter(normalized_customer_level(project.customer_level) for project in projects)
        member_counts: Counter[tuple[str, str, str]] = Counter()
        for project in projects:
            members = list(dict.fromkeys([
                project.project_manager,
                *(project.execution_members or []),
            ]))
            for member in (name.strip() for name in members if name and name.strip()):
                member_counts[(resolved_office(project), normalized_team(project), member)] += 1
        team_member_distribution = [
            {"office": office, "team": team, "member": member, "count": count}
            for (office, team, member), count in sorted(member_counts.items())
        ]
        leader_answered_count = sum(1 for item in issues if work_item_row(item).get("leaderAnswered"))
        contract_project = {
            project.source_contract_id: project
            for project in projects
            if project.source_contract_id
        }

        payment_detail_rows: list[dict[str, Any]] = []
        for row in payment_rows:
            planned_amount = float(row.planned_amount or 0)
            actual_amount = float(row.actual_amount or 0)
            outstanding_amount = max(planned_amount - actual_amount, 0)
            payment_status = (
                "paid"
                if outstanding_amount <= 0
                else "overdue"
                if row.planned_date and row.planned_date < today
                else "partial"
                if actual_amount > 0
                else "pending"
            )
            project = contract_project.get(row.contract_id)
            payment_detail_rows.append({
                "rowType": "payment",
                "projectId": project.id if project else "",
                "projectName": project.name if project else "未关联项目",
                "customerName": project.customer_name if project else "",
                "periodName": row.period_name or "—",
                "plannedAmount": planned_amount,
                "actualAmount": actual_amount,
                "outstandingAmount": outstanding_amount,
                "plannedDate": row.planned_date.isoformat() if row.planned_date else "",
                "actualDate": row.actual_payment_date.isoformat() if row.actual_payment_date else "",
                "status": payment_status,
                "invoiceStatus": row.invoice_status or "uninvoiced",
            })

        drilldowns: dict[str, list[dict[str, Any]]] = {
            "projects:total": [project_row(project) for project in projects],
            "projects:pendingStart": [project_row(project) for project in projects if project.stage == "pending_start"],
            "projects:inTransit": [project_row(project) for project in projects if project.stage != "completed"],
            "projects:completed": [project_row(project) for project in projects if project.stage == "completed"],
            "projects:delayed": [project_row(project) for project in projects if project.stage == "paused" or project.delivery_delay_days > 0],
            "projects:highRisk": [project_row(project) for project in projects if project.risk_level == "high"],
            "quality:issues": [work_item_row(item) for item in issues],
            "quality:tasks": [work_item_row(item) for item in tasks],
            "quality:appeasements": [work_item_row(item) for item in items if item.kind == "appeasement"],
            "payments:planned": payment_detail_rows,
            "payments:paid": [row for row in payment_detail_rows if row["actualAmount"] > 0],
            "payments:outstanding": [row for row in payment_detail_rows if row["outstandingAmount"] > 0],
            "payments:overdue": [row for row in payment_detail_rows if row["status"] == "overdue"],
        }
        for office_name in office_counts:
            drilldowns[f"office:{office_name}"] = [
                project_row(project) for project in projects if resolved_office(project) == office_name
            ]
        for level in ("P0", "P1", "P2"):
            drilldowns[f"level:{level}"] = [
                project_row(project) for project in projects
                if normalized_customer_level(project.customer_level) == level
            ]
        for blocker_name, _count in blockers.most_common(5):
            drilldowns[f"blocker:{blocker_name}"] = [
                work_item_row(item)
                for item in issues
                if item.status not in DONE_STATUSES
                and (item.category or item.title or "其他") == blocker_name
            ]
        return ProjectDashboardResponse(
            total=len(projects),
            pending_start=sum(1 for p in projects if p.stage == "pending_start"),
            in_transit=sum(1 for p in projects if p.stage != "completed"),
            completed=sum(1 for p in projects if p.stage == "completed"),
            delayed=delayed,
            delay_rate=round(delayed * 100 / len(projects), 1) if projects else 0,
            office_distribution=dict(office_counts),
            customer_level_distribution={level: level_counts.get(level, 0) for level in ("P0", "P1", "P2")},
            team_member_distribution=team_member_distribution,
            appeasement_count=sum(1 for item in items if item.kind == "appeasement"),
            issue_total=len(issues),
            issue_resolved=len(resolved_issues),
            leader_answered_count=leader_answered_count,
            issue_resolution_rate=round(len(resolved_issues) * 100 / len(issues), 1) if issues else 0,
            open_issues=len(issues) - len(resolved_issues),
            overdue_issues=len(overdue_issues),
            high_risk_projects=sum(1 for p in projects if p.risk_level == "high"),
            task_total=len(tasks),
            task_completed=len(completed_tasks),
            task_completion_rate=round(len(completed_tasks) * 100 / len(tasks), 1) if tasks else 0,
            top_blockers=[{"name": name, "count": count} for name, count in blockers.most_common(5)],
            planned_payment_amount=planned_payment,
            paid_amount=paid_amount,
            outstanding_amount=max(planned_payment - paid_amount, 0),
            overdue_payment_amount=overdue_payment,
            drilldowns=drilldowns,
            generated_at=format_legacy_time(china_now()),
        )

    async def report(self, user: AuthUser, *, period: str) -> ProjectReportResponse:
        normalized = "month" if period == "month" else "week"
        dashboard = await self.dashboard(user)
        title = "项目交付月报" if normalized == "month" else "项目交付周报"
        top = "、".join(f"{item['name']}（{item['count']}）" for item in dashboard.top_blockers) or "暂无集中卡点"
        content = "\n".join([
            f"{title}｜{_china_today().isoformat()}",
            f"一、项目概况：项目共 {dashboard.total} 个，在途 {dashboard.in_transit} 个，完结 {dashboard.completed} 个，延期 {dashboard.delayed} 个，延期率 {dashboard.delay_rate}%。",
            f"二、区域分布：北京 {dashboard.office_distribution.get('北京', 0)} 个，厦门 {dashboard.office_distribution.get('厦门', 0)} 个，未设置 {dashboard.office_distribution.get('未设置', 0)} 个。",
            f"三、客户与问题：客户安抚 {dashboard.appeasement_count} 次；问题共 {dashboard.issue_total} 个，已解决 {dashboard.issue_resolved} 个，解决率 {dashboard.issue_resolution_rate}%，超期 {dashboard.overdue_issues} 个。",
            f"四、项目卡点 TOP：{top}。",
            f"五、回款：计划回款 {dashboard.planned_payment_amount:,.2f} 元，已回款 {dashboard.paid_amount:,.2f} 元，待回款 {dashboard.outstanding_amount:,.2f} 元，逾期 {dashboard.overdue_payment_amount:,.2f} 元。",
            f"六、风险提示：高风险项目 {dashboard.high_risk_projects} 个，未解决问题 {dashboard.open_issues} 个。",
        ])
        return ProjectReportResponse(
            period=normalized,
            title=title,
            generated_at=dashboard.generated_at,
            content=content,
        )

    async def ensure_from_contract_id(self, user: AuthUser, contract_id: str) -> ProjectRecord:
        """ops 补建入口。"""
        self._assert_section(user)
        if not self._is_ops_admin(user):
            raise PermissionDeniedError("仅运营/管理员可补建项目")
        contract = await self.crm.get_contract(contract_id)
        if not contract:
            raise NotFoundError("合同不存在")
        owners = (await self.crm.list_contract_owners([contract_id])).get(contract_id) or []
        attachments = await self.crm.get_contract_attachments(contract_id)
        from app.modules.crm.service.contracts import _contract_response

        contract_doc = _contract_response(
            contract,
            owners=list(owners),
            attachments=list(attachments),
        )
        if not contract_doc.get("id"):
            contract_doc["id"] = contract.id
        if not contract_doc.get("customerId"):
            contract_doc["customerId"] = str(getattr(contract, "customer_id", "") or "")
        row = await self.ensure_from_contract_document(
            contract_doc, actor=user.name or user.id, commit=True
        )
        if not row:
            raise ValidationError("无法根据该合同创建项目（请确认客户信息完整）")
        string_items = await self.repo.list_string_items([row.id])
        return self._to_record(row, string_items=string_items.get(row.id))

    async def ensure_from_contract_document(
        self,
        contract_doc: dict[str, Any],
        *,
        actor: str | None = None,
        commit: bool = False,
    ) -> Project | None:
        """幂等建项。失败时记录日志；commit=False 时由调用方统一提交。"""
        contract_id = str(contract_doc.get("id") or "").strip()
        if not contract_id:
            return None
        manager_request = contract_doc.get("projectManagerRequest") if isinstance(contract_doc.get("projectManagerRequest"), dict) else {}
        requested_manager = str(manager_request.get("projectManager") or "").strip()
        requested_start = self._parse_date(manager_request.get("requestedStartDate") or contract_doc.get("effectiveDate"))
        existing = await self.repo.get_by_contract_id(contract_id)
        if existing:
            if str(manager_request.get("status") or "") == "assigned" and requested_manager:
                existing.project_manager = requested_manager
                existing.planned_start_date = requested_start or existing.planned_start_date
                await self.repo.save(existing)
            return existing

        customer_id = str(contract_doc.get("customerId") or "").strip()
        customer_name = ""
        industry = type_ = region = ""
        if customer_id:
            customer = await self.crm.get_customer(customer_id)
            if customer:
                # 列权威：禁止读已删 document JSON
                customer_name = str(
                    getattr(customer, "company_name", None)
                    or contract_doc.get("company")
                    or ""
                ).strip()
                industry = str(
                    getattr(customer, "industry_l1", None)
                    or getattr(customer, "industry_l2", None)
                    or ""
                ).strip()
                type_ = ""
                region = str(
                    getattr(customer, "region", None)
                    or getattr(customer, "city", None)
                    or ""
                ).strip()

        if not customer_name:
            customer_name = str(contract_doc.get("company") or contract_doc.get("name") or "未命名客户")

        opportunity_id = str(contract_doc.get("opportunityId") or "").strip() or None
        project_types: list[str] = []
        if opportunity_id:
            opp = await self.crm.get_opportunity(opportunity_id)
            if opp:
                children = await self.crm.get_opportunity_children(opportunity_id)
                project_types = _str_list(children.get("projectTypes"))

        geo_source = coalesce_geo_sources(
            await self._resolve_opportunity_geo_id(opportunity_id) if opportunity_id else None,
            resolve_document_geo_source(contract_doc),
        )

        owners = contract_doc.get("owners")
        biz_owner = ""
        if isinstance(owners, list) and owners:
            biz_owner = str(owners[0] or "")
        if not biz_owner:
            biz_owner = str(contract_doc.get("owner") or "")

        amount = _as_float(contract_doc.get("amount"))
        name = f"{customer_name}-交付项目"

        try:
            async with self.db.begin_nested():
                row = await self.repo.create(
                    name=name,
                    customer_id=customer_id,
                    customer_name=customer_name,
                    source_contract_id=contract_id,
                    opportunity_id=opportunity_id,
                    geo_source=geo_source,
                    biz_owner=biz_owner,
                    project_manager=requested_manager,
                    planned_start_date=requested_start,
                    contract_amount=Decimal(str(amount)) if amount is not None else None,
                    customer_industry=industry,
                    customer_type=type_,
                    customer_region=region,
                    project_types=project_types,
                    created_by=actor,
                    updated_by=actor,
                )
                await self._write_created_audit(row, actor=actor or "system")
            if commit:
                await self.db.commit()
                await self.db.refresh(row)
            return row
        except IntegrityError:
            existing = await self.repo.get_by_contract_id(contract_id)
            if commit:
                await self.db.commit()
            return existing
        except Exception:
            logger.exception("ensure project from contract %s failed", contract_id)
            return None

    async def _write_created_audit(self, row: Project, *, actor: str) -> None:
        now = china_now().replace(microsecond=0)
        await self.crm.create_audit_record(
            record_id=f"audit-{int(now.timestamp() * 1000)}-{uuid4().hex[:4]}",
            module="项目",
            entity_type="项目",
            entity_id=row.id,
            related_entity_ids=[row.source_contract_id] if row.source_contract_id else None,
            entity_name=row.name or "",
            action="自动创建项目",
            actor=actor,
            actor_user_id=None,
            timestamp_at=now,
            changes=[
                {
                    "field": "sourceContractId",
                    "label": "来源合同",
                    "before": "",
                    "after": row.source_contract_id,
                },
                {
                    "field": "stage",
                    "label": "项目阶段",
                    "before": "",
                    "after": row.stage,
                },
            ],
        )
