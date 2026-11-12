from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import china_now
from app.models.crm import CrmAttachment
from app.models.project import Project, ProjectNote, ProjectSowVersion, ProjectStringItem, ProjectWorkItem


def new_project_id() -> str:
    return f"p{uuid4().hex[:16]}"


def new_note_id() -> str:
    return f"pn{uuid4().hex[:16]}"


def new_work_item_id() -> str:
    return f"pw{uuid4().hex[:16]}"


def new_sow_version_id() -> str:
    return f"ps{uuid4().hex[:16]}"


ACTIVE_STAGES = ("pending_start", "active", "paused")
ARCHIVE_STAGES = ("completed",)


class ProjectsRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, project_id: str) -> Project | None:
        return await self.db.get(Project, project_id)

    async def get_for_update(self, project_id: str) -> Project | None:
        stmt = select(Project).where(Project.id == project_id).with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_sow_versions(self, project_id: str) -> list[ProjectSowVersion]:
        stmt = (
            select(ProjectSowVersion)
            .where(ProjectSowVersion.project_id == project_id)
            .order_by(ProjectSowVersion.version_no.desc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def deactivate_sow_versions(self, project_id: str) -> None:
        rows = await self.list_sow_versions(project_id)
        for row in rows:
            row.is_current = False
        await self.db.flush()

    async def create_sow_version(
        self,
        *,
        project_id: str,
        version_no: int,
        is_current: bool,
        sow_end_date: date,
        snapshot: dict[str, Any],
        change_reason: str,
        confirmer: str,
        created_by: str,
        created_by_user_id: str | None,
        source_change_id: str | None = None,
    ) -> ProjectSowVersion:
        row = ProjectSowVersion(
            id=new_sow_version_id(),
            project_id=project_id,
            version_no=version_no,
            is_current=is_current,
            sow_end_date=sow_end_date,
            snapshot_json=json.dumps(snapshot, ensure_ascii=False),
            change_reason=change_reason,
            confirmer=confirmer,
            source_change_id=source_change_id,
            created_by=created_by,
            created_by_user_id=created_by_user_id,
            created_at=china_now().replace(microsecond=0),
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def get_by_contract_id(self, contract_id: str) -> Project | None:
        stmt = select(Project).where(Project.source_contract_id == contract_id).limit(1)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_by_customer_id(self, customer_id: str) -> list[Project]:
        stmt = (
            select(Project)
            .where(Project.customer_id == customer_id)
            .order_by(Project.updated_at.desc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def list_project_attachments(self, project_id: str) -> list[CrmAttachment]:
        stmt = (
            select(CrmAttachment)
            .where(
                CrmAttachment.entity_type == "project",
                CrmAttachment.entity_id == project_id,
                CrmAttachment.content_type == "application/pdf",
            )
            .order_by(CrmAttachment.uploaded_at.desc(), CrmAttachment.created_at.desc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def add_project_attachments(
        self,
        project_id: str,
        records: list[dict[str, Any]],
        *,
        uploaded_by: str,
    ) -> list[CrmAttachment]:
        now = china_now().replace(microsecond=0)
        rows: list[CrmAttachment] = []
        for item in records:
            attachment_id = str(item.get("id") or "").strip()
            if not attachment_id:
                continue
            row = CrmAttachment(
                id=attachment_id,
                entity_type="project",
                entity_id=project_id,
                name=str(item.get("name") or item.get("originalName") or attachment_id)[:512],
                size=int(item.get("size") or 0),
                url=str(item.get("url") or f"/api/crm/attachments/{attachment_id}"),
                storage_path=str(item.get("storagePath") or "") or None,
                content_type="application/pdf",
                uploaded_by=uploaded_by[:128],
                uploaded_at=now,
                created_at=now,
            )
            self.db.add(row)
            rows.append(row)
        await self.db.flush()
        return rows

    async def list_projects(
        self,
        *,
        view: str = "active",
        keyword: str | None = None,
        stage: str | None = None,
        health: str | None = None,
        risk_level: str | None = None,
        office: str | None = None,
        renewal_warning_only: bool = False,
        amount_min: float | None = None,
        amount_max: float | None = None,
        sow_from: str | None = None,
        sow_to: str | None = None,
        updated_from: str | None = None,
        updated_to: str | None = None,
        due_days_min: int | None = None,
        due_days_max: int | None = None,
        mine_user_id: str | None = None,
        mine_name: str | None = None,
        scope_user_ids: Sequence[str] | None = None,
        scope_names: Sequence[str] | None = None,
        include_unassigned: bool = False,
        today: date | None = None,
    ) -> list[Project]:
        stmt: Select[Any] = select(Project).order_by(Project.updated_at.desc())
        if view == "archive":
            stmt = stmt.where(Project.stage.in_(list(ARCHIVE_STAGES)))
        else:
            stmt = stmt.where(Project.stage.in_(list(ACTIVE_STAGES)))

        if stage:
            stmt = stmt.where(Project.stage == stage)
        if health:
            stmt = stmt.where(Project.health == health)
        if risk_level:
            stmt = stmt.where(Project.risk_level == risk_level)
        if office:
            if office == "未设置":
                stmt = stmt.where(or_(Project.office == "", Project.office.is_(None)))
            else:
                stmt = stmt.where(Project.office == office)
        if amount_min is not None:
            stmt = stmt.where(Project.contract_amount >= amount_min)
        if amount_max is not None:
            stmt = stmt.where(Project.contract_amount <= amount_max)
        sow_from_day = (sow_from or "").strip()[:10]
        if sow_from_day:
            stmt = stmt.where(Project.sow_end_date >= sow_from_day)
        sow_to_day = (sow_to or "").strip()[:10]
        if sow_to_day:
            stmt = stmt.where(Project.sow_end_date <= sow_to_day)
        updated_from_day = (updated_from or "").strip()[:10]
        if updated_from_day:
            stmt = stmt.where(Project.updated_at >= updated_from_day)
        updated_to_day = (updated_to or "").strip()[:10]
        if updated_to_day:
            stmt = stmt.where(Project.updated_at < (updated_to_day + " 23:59:59"))
        if due_days_min is not None:
            stmt = stmt.where(func.datediff(Project.sow_end_date, func.curdate()) >= due_days_min)
        if due_days_max is not None:
            stmt = stmt.where(func.datediff(Project.sow_end_date, func.curdate()) <= due_days_max)

        kw = (keyword or "").strip()
        if kw:
            like = f"%{kw}%"
            stmt = stmt.where(
                or_(
                    Project.name.like(like),
                    Project.customer_name.like(like),
                    Project.project_manager.like(like),
                    Project.executor.like(like),
                    Project.content_ops.like(like),
                    Project.biz_owner.like(like),
                )
            )

        if mine_user_id or mine_name:
            mine_clauses = []
            if mine_user_id:
                mine_clauses.extend(
                    [
                        Project.project_manager_user_id == mine_user_id,
                        Project.executor_user_id == mine_user_id,
                        Project.content_ops_user_id == mine_user_id,
                    ]
                )
            if mine_name:
                mine_clauses.extend(
                    [
                        Project.project_manager == mine_name,
                        Project.executor == mine_name,
                        Project.content_ops == mine_name,
                    ]
                )
                mine_clauses.append(
                    select(ProjectStringItem.id)
                    .where(
                        # projects was created with utf8mb4_unicode_ci while the
                        # newer project_string_items table uses utf8mb4_0900_ai_ci.
                        # Make the cross-table comparison explicit; otherwise
                        # MySQL raises 1267 (Illegal mix of collations) and the
                        # whole project list/dashboard returns 500.
                        ProjectStringItem.project_id.collate("utf8mb4_unicode_ci") == Project.id,
                        ProjectStringItem.kind == "assistant_members",
                        ProjectStringItem.value == mine_name,
                    )
                    .exists()
                )
            stmt = stmt.where(or_(*mine_clauses))
        elif scope_user_ids is not None or scope_names is not None:
            # None means unrestricted (all); empty means no access
            uid_list = list(scope_user_ids or [])
            name_list = list(scope_names or [])
            if not uid_list and not name_list and not include_unassigned:
                return []
            clauses = []
            if uid_list:
                clauses.extend(
                    [
                        Project.project_manager_user_id.in_(uid_list),
                        Project.executor_user_id.in_(uid_list),
                        Project.content_ops_user_id.in_(uid_list),
                        Project.biz_owner_user_id.in_(uid_list),
                    ]
                )
            if name_list:
                clauses.extend(
                    [
                        Project.project_manager.in_(name_list),
                        Project.executor.in_(name_list),
                        Project.content_ops.in_(name_list),
                        Project.biz_owner.in_(name_list),
                    ]
                )
                clauses.append(
                    select(ProjectStringItem.id)
                    .where(
                        ProjectStringItem.project_id.collate("utf8mb4_unicode_ci") == Project.id,
                        ProjectStringItem.kind == "assistant_members",
                        ProjectStringItem.value.in_(name_list),
                    )
                    .exists()
                )
            if include_unassigned:
                clauses.append(
                    (Project.project_manager == "")
                    & (Project.executor == "")
                    & (Project.content_ops == "")
                    & (Project.project_manager_user_id.is_(None))
                    & (Project.executor_user_id.is_(None))
                    & (Project.content_ops_user_id.is_(None))
                )
            if not clauses:
                return []
            stmt = stmt.where(or_(*clauses))

        rows = list((await self.db.execute(stmt)).scalars().all())

        if renewal_warning_only:
            day = today or china_now().date()
            filtered: list[Project] = []
            for row in rows:
                if not row.sow_end_date:
                    continue
                delta = (row.sow_end_date - day).days
                if 0 <= delta <= 30 and row.stage not in ARCHIVE_STAGES:
                    filtered.append(row)
            return filtered
        return rows

    async def create(self, **fields: Any) -> Project:
        now = china_now().replace(microsecond=0)
        row = Project(
            id=fields.get("id") or new_project_id(),
            name=str(fields.get("name") or ""),
            customer_id=str(fields.get("customer_id") or ""),
            customer_name=str(fields.get("customer_name") or ""),
            source_contract_id=str(fields["source_contract_id"]),
            opportunity_id=fields.get("opportunity_id"),
            geo_source=fields.get("geo_source"),
            stage=str(fields.get("stage") or "pending_start"),
            health=str(fields.get("health") or "healthy"),
            risk_level=str(fields.get("risk_level") or "low"),
            biz_owner=str(fields.get("biz_owner") or ""),
            biz_owner_user_id=fields.get("biz_owner_user_id"),
            project_manager=str(fields.get("project_manager") or ""),
            project_manager_user_id=fields.get("project_manager_user_id"),
            executor="",
            executor_user_id=None,
            content_ops="",
            content_ops_user_id=None,
            contract_amount=fields.get("contract_amount"),
            customer_industry=str(fields.get("customer_industry") or ""),
            customer_type=str(fields.get("customer_type") or ""),
            customer_region=str(fields.get("customer_region") or ""),
            contact_info=str(fields.get("contact_info") or ""),
            team_name=str(fields.get("team_name") or ""),
            office=str(fields.get("office") or ""),
            customer_level=str(fields.get("customer_level") or ""),
            acceptance_criteria=str(fields.get("acceptance_criteria") or ""),
            intent_brand=int(fields.get("intent_brand") or 0),
            intent_content=int(fields.get("intent_content") or 0),
            intent_search=int(fields.get("intent_search") or 0),
            kpi_notes=str(fields.get("kpi_notes") or ""),
            start_date=fields.get("start_date"),
            planned_start_date=fields.get("planned_start_date") or fields.get("start_date"),
            sow_end_date=fields.get("sow_end_date"),
            original_delivery_date=fields.get("original_delivery_date") or fields.get("sow_end_date"),
            latest_delivery_date=fields.get("latest_delivery_date") or fields.get("sow_end_date"),
            actual_delivery_date=fields.get("actual_delivery_date"),
            delay_reason="",
            remediation_plan="",
            delay_customer_note="",
            created_at=now,
            updated_at=now,
            created_by=fields.get("created_by"),
            updated_by=fields.get("updated_by"),
            archived_at=None,
        )
        self.db.add(row)
        await self.db.flush()
        await self.sync_string_items(
            row.id,
            project_types=fields.get("project_types") or [],
            platforms=fields.get("platforms") or [],
            customer_tags=fields.get("customer_tags") or [],
            assistant_members=fields.get("assistant_members") or [],
            project_leader=fields.get("project_leader") or [],
            execution_members=fields.get("execution_members") or [],
            detection_platforms=fields.get("detection_platforms") or [],
            renewal_status=fields.get("renewal_status") or [],
        )
        return row

    async def sync_string_items(
        self,
        project_id: str,
        *,
        project_types: list[Any] | None = None,
        platforms: list[Any] | None = None,
        customer_tags: list[Any] | None = None,
        assistant_members: list[Any] | None = None,
        project_leader: list[Any] | None = None,
        execution_members: list[Any] | None = None,
        content_ops_members: list[Any] | None = None,
        content_team_name: list[Any] | None = None,
        detection_platforms: list[Any] | None = None,
        renewal_status: list[Any] | None = None,
    ) -> None:
        """把项目多值字段同步到子表（写穿式，幂等；None=不触碰该 kind）。"""
        for kind, items in (
            ("project_types", project_types),
            ("platforms", platforms),
            ("customer_tags", customer_tags),
            ("assistant_members", assistant_members),
            ("project_leader", project_leader),
            ("execution_members", execution_members),
            ("content_ops_members", content_ops_members),
            ("content_team_name", content_team_name),
            ("detection_platforms", detection_platforms),
            ("renewal_status", renewal_status),
        ):
            if items is None:
                continue
            await self.db.execute(
                delete(ProjectStringItem).where(
                    ProjectStringItem.project_id == project_id,
                    ProjectStringItem.kind == kind,
                )
            )
            for index, value in enumerate(items):
                value = str(value or "").strip()
                if not value:
                    continue
                self.db.add(
                    ProjectStringItem(
                        id=f"{project_id}-{kind[:2]}-{index}",
                        project_id=project_id,
                        kind=kind,
                        value=value[:128],
                        sort_order=index,
                    )
                )

    async def list_string_items(
        self, project_ids: Sequence[str]
    ) -> dict[str, dict[str, list[str]]]:
        """批量读取项目字符串子表（避免列表 N+1）。"""
        ids = [str(x) for x in project_ids if str(x)]
        out: dict[str, dict[str, list[str]]] = {
            pid: {"project_types": [], "platforms": [], "customer_tags": [], "assistant_members": [], "project_leader": [], "execution_members": [], "content_ops_members": [], "content_team_name": [], "detection_platforms": [], "renewal_status": []} for pid in ids
        }
        if not ids:
            return out
        rows = (
            await self.db.execute(
                select(ProjectStringItem)
                .where(ProjectStringItem.project_id.in_(ids))
                .order_by(
                    ProjectStringItem.project_id,
                    ProjectStringItem.kind,
                    ProjectStringItem.sort_order,
                )
            )
        ).scalars().all()
        for item in rows:
            bucket = out.setdefault(
                item.project_id, {"project_types": [], "platforms": [], "customer_tags": [], "assistant_members": [], "project_leader": [], "execution_members": [], "content_ops_members": [], "content_team_name": [], "detection_platforms": [], "renewal_status": []}
            )
            if item.kind in bucket:
                bucket[item.kind].append(item.value)
        return out

    async def save(self, row: Project) -> Project:
        row.updated_at = china_now().replace(microsecond=0)
        await self.db.flush()
        return row

    async def list_notes(self, project_id: str, *, kind: str | None = None) -> list[ProjectNote]:
        stmt = select(ProjectNote).where(ProjectNote.project_id == project_id).order_by(ProjectNote.created_at.desc())
        if kind:
            stmt = stmt.where(ProjectNote.kind == kind)
        return list((await self.db.execute(stmt)).scalars().all())

    async def add_note(
        self,
        *,
        project_id: str,
        kind: str,
        content: str,
        created_by: str,
        created_by_user_id: str | None,
    ) -> ProjectNote:
        now = china_now().replace(microsecond=0)
        row = ProjectNote(
            id=new_note_id(),
            project_id=project_id,
            kind=kind,
            content=content,
            created_at=now,
            created_by=created_by,
            created_by_user_id=created_by_user_id,
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def get_note(self, note_id: str) -> ProjectNote | None:
        return await self.db.get(ProjectNote, note_id)

    async def delete_note(self, row: ProjectNote) -> None:
        await self.db.delete(row)
        await self.db.flush()

    async def list_work_items(
        self, project_ids: Sequence[str], *, kind: str | None = None
    ) -> list[ProjectWorkItem]:
        ids = [str(x) for x in project_ids if str(x)]
        if not ids:
            return []
        stmt = (
            select(ProjectWorkItem)
            .where(ProjectWorkItem.project_id.in_(ids))
            .order_by(ProjectWorkItem.updated_at.desc(), ProjectWorkItem.created_at.desc())
        )
        if kind:
            stmt = stmt.where(ProjectWorkItem.kind == kind)
        return list((await self.db.execute(stmt)).scalars().all())

    async def get_work_item(self, item_id: str) -> ProjectWorkItem | None:
        return await self.db.get(ProjectWorkItem, item_id)

    async def create_work_item(self, *, project_id: str, fields: dict[str, Any]) -> ProjectWorkItem:
        now = china_now().replace(microsecond=0)
        row = ProjectWorkItem(
            id=new_work_item_id(),
            project_id=project_id,
            kind=str(fields.get("kind") or "task"),
            title=str(fields.get("title") or ""),
            description=str(fields.get("description") or ""),
            category=str(fields.get("category") or ""),
            status=str(fields.get("status") or "pending"),
            owner=str(fields.get("owner") or ""),
            owner_user_id=fields.get("owner_user_id"),
            due_date=fields.get("due_date"),
            priority=str(fields.get("priority") or "medium"),
            risk_level=str(fields.get("risk_level") or "low"),
            solution=str(fields.get("solution") or ""),
            occurred_at=fields.get("occurred_at"),
            resolved_at=fields.get("resolved_at"),
            document_json=str(fields.get("document_json") or "{}"),
            created_by=str(fields.get("created_by") or ""),
            created_by_user_id=fields.get("created_by_user_id"),
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def save_work_item(self, row: ProjectWorkItem) -> ProjectWorkItem:
        row.updated_at = china_now().replace(microsecond=0)
        await self.db.flush()
        return row

    async def delete_work_item(self, row: ProjectWorkItem) -> None:
        await self.db.delete(row)
        await self.db.flush()
