from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from app.core.deps import (
    user_data_scope,
)
from app.core.exceptions import (
    PermissionDeniedError,
    ValidationError,
)
from app.core.time_utils import china_now, format_legacy_time
from app.models.crm import CrmAuditChangeItem, CrmAuditRelatedEntity
from app.modules.auth.schemas import AuthUser
from app.modules.crm.schemas import (
    AuditChangeItem,
    AuditRecordCreateBody,
    AuditRecordResponse,
)

from .helpers_common import (
    _doc,
)


class BaseAuditMixin:
    async def _audit_children_map(
        self, rows: list[Any]
    ) -> dict[str, dict[str, Any]]:
        """批量读取审计变更项与关联实体子表。"""
        ids = [str(r.id) for r in rows]
        out: dict[str, dict[str, Any]] = {
            rid: {"changes": [], "related": []} for rid in ids
        }
        if not ids:
            return out
        change_rows = (
            await self.db.execute(
                select(CrmAuditChangeItem)
                .where(CrmAuditChangeItem.audit_id.in_(ids))
                .order_by(CrmAuditChangeItem.audit_id, CrmAuditChangeItem.sort_order)
            )
        ).scalars().all()
        raw_changes: list[dict[str, Any]] = []
        for item in change_rows:
            raw_changes.append(
                {
                    "audit_id": item.audit_id,
                    "field": item.field,
                    "label": item.field,
                    "before": item.before_value or "",
                    "after": item.after_value or "",
                }
            )
        for item in await self._resolve_audit_change_id_labels(raw_changes):
            out.setdefault(item["audit_id"], {"changes": [], "related": []})["changes"].append(
                {
                    "field": item["field"],
                    "label": item["label"],
                    "before": item["before"],
                    "after": item["after"],
                }
            )
        related_rows = (
            await self.db.execute(
                select(CrmAuditRelatedEntity).where(
                    CrmAuditRelatedEntity.audit_id.in_(ids)
                )
            )
        ).scalars().all()
        for item in related_rows:
            out.setdefault(item.audit_id, {"changes": [], "related": []})["related"].append(
                item.entity_id
            )
        return out

    async def _resolve_audit_change_id_labels(
        self, changes: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """把审计变更值里的需求/商机原始 ID 替换为可读标识（需求编号 / 商机名称）。

        覆盖 requestIds（商机管理）与 opportunityId（需求/合同等）；一个值可能包含
        多个 ID（以「、」连接）。历史记录与新记录统一在此层转换，前端无需感知原始 ID。
        """
        request_ids: set[str] = set()
        opp_ids: set[str] = set()
        for c in changes:
            field = str(c.get("field") or "").strip()
            if field not in ("requestIds", "opportunityId"):
                continue
            bucket = request_ids if field == "requestIds" else opp_ids
            for key in ("before", "after"):
                for part in (p.strip() for p in str(c.get(key) or "").split("、")):
                    if part and part != "—":
                        bucket.add(part)

        request_labels: dict[str, str] = {}
        if request_ids:
            from app.modules.requests.repository import RequestRepository

            rows = await RequestRepository(self.db).list_by_ids(list(request_ids))
            request_labels = {str(r.id): str(r.code or "") for r in rows}

        opp_labels: dict[str, str] = {}
        if opp_ids:
            rows = await self.repo.list_opportunities_by_ids(list(opp_ids))
            opp_labels = {str(r.id): str(r.name or "") for r in rows}

        if not request_labels and not opp_labels:
            return changes

        def resolve(field: str, value: str) -> str:
            labels = request_labels if field == "requestIds" else opp_labels
            parts = [labels.get(p.strip(), p.strip()) for p in value.split("、")]
            return "、".join(parts)

        resolved: list[dict[str, Any]] = []
        for c in changes:
            field = str(c.get("field") or "").strip()
            if field not in ("requestIds", "opportunityId"):
                resolved.append(c)
                continue
            resolved.append(
                {
                    **c,
                    "before": resolve(field, str(c.get("before") or "")),
                    "after": resolve(field, str(c.get("after") or "")),
                }
            )
        return resolved

    async def _audit_to_response(
        self,
        row: Any,
        *,
        origin: str | None = None,
        children: dict[str, Any] | None = None,
    ) -> AuditRecordResponse:
        if children is None:
            children = (await self._audit_children_map([row])).get(row.id, {})
        changes: list[AuditChangeItem] = []
        for item in children.get("changes") or []:
            changes.append(
                AuditChangeItem(
                    field=str(item.get("field") or ""),
                    label=str(item.get("label") or item.get("field") or ""),
                    before=str(item.get("before") or ""),
                    after=str(item.get("after") or ""),
                )
            )
        related = children.get("related")
        return AuditRecordResponse(
            id=row.id,
            module=row.module,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            related_entity_ids=[str(x) for x in related] if related else None,
            entity_name=row.entity_name or "",
            action=row.action,
            actor=row.actor,
            timestamp=format_legacy_time(row.timestamp_at),
            changes=changes,
            origin=origin,
        )

    def _parse_client_timestamp(self, value: str | None) -> datetime:
                text = (value or "").strip()
                if not text:
                    return china_now().replace(microsecond=0)
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                    try:
                        return datetime.strptime(text[:19], fmt)
                    except ValueError:
                        continue
                return china_now().replace(microsecond=0)

    async def create_audit(self, user: AuthUser, body: AuditRecordCreateBody) -> AuditRecordResponse:
                if not (body.changes or []):
                    raise ValidationError("审计变更不能为空")
                module = (body.module or "").strip()
                entity_type = (body.entity_type or "").strip()
                entity_id = (body.entity_id or "").strip()
                action = (body.action or "").strip()
                if not module or not entity_type or not entity_id or not action:
                    raise ValidationError("审计字段不完整")

                record_id = (body.id or "").strip() or f"audit-{int(china_now().timestamp() * 1000)}-{uuid4().hex[:4]}"
                actor = (body.actor or "").strip() or user.name
                timestamp_at = self._parse_client_timestamp(body.timestamp)
                changes = [
                    {
                        "field": item.field,
                        "label": item.label or item.field,
                        "before": item.before,
                        "after": item.after,
                    }
                    for item in body.changes
                ]
                related = [str(x).strip() for x in (body.related_entity_ids or []) if str(x).strip()] or None

                existing = await self.repo.get_audit_record(record_id[:64])
                if existing:
                    return await self._audit_to_response(existing)

                row = await self.repo.create_audit_record(
                    record_id=record_id[:64],
                    module=module[:32],
                    entity_type=entity_type[:32],
                    entity_id=entity_id[:64],
                    related_entity_ids=related,
                    entity_name=(body.entity_name or "")[:255],
                    action=action[:128],
                    actor=actor[:128],
                    actor_user_id=user.id,
                    timestamp_at=timestamp_at,
                    changes=changes,
                )
                await self.db.commit()
                return await self._audit_to_response(row)

    async def list_audits(
                self,
                user: AuthUser,
                *,
                entity_id: str | None = None,
                module: str | None = None,
                limit: int = 500,
            ) -> list[AuditRecordResponse]:
                eid = (entity_id or "").strip() or None
                if not eid:
                    if user_data_scope(user) != "all":
                        raise PermissionDeniedError("请指定实体后查看操作历史")
                else:
                    await self._assert_audit_entity_readable(user, eid)

                source_lead_id: str | None = None
                source_request_ids: list[str] = []
                customer_row = None
                if eid:
                    customer_row = await self.repo.get_customer(eid)
                    if customer_row:
                        raw_lead = _doc(customer_row).get("sourceLeadId")
                        trimmed = str(raw_lead).strip() if raw_lead else ""
                        source_lead_id = trimmed or None
                    else:
                        opp_row = await self.repo.get_opportunity(eid)
                        if opp_row:
                            opp_children = await self.repo.get_opportunity_children(eid)
                            source_request_ids = [
                                str(x).strip()
                                for x in (opp_children.get("requestIds") or [])
                                if str(x).strip()
                            ]

                also_ids = ([source_lead_id] if source_lead_id else []) + source_request_ids
                rows = await self.repo.list_audit_records(
                    entity_id=eid,
                    also_entity_ids=also_ids or None,
                    module=module,
                    limit=limit,
                )
                # 客户是共享主档：经营类审计按操作人的数据范围过滤，
                # 防止同一客户多对接池/无池销售串看他人操作记录。
                # 线索/需求带入（origin）记录与无操作人（系统/遗留）记录保留。
                allowed_actor_ids: list[str] | None = None
                if customer_row is not None:
                    allowed_actor_ids = await self._owner_filter(user)
                if allowed_actor_ids is not None:
                    also_ids_set = set(also_ids or [])
                    rows = [
                        r
                        for r in rows
                        if (
                            (r.actor_user_id or "") in allowed_actor_ids
                            or (also_ids and (r.entity_id or "") in also_ids_set)
                            or not (r.actor_user_id or "")
                        )
                    ]
                request_id_set = set(source_request_ids)
                children_map = await self._audit_children_map(rows)
                items: list[AuditRecordResponse] = []
                for row in rows:
                    origin = "lead" if source_lead_id and row.entity_id == source_lead_id else None
                    if origin is None and eid and row.entity_id != eid and (row.module or "") == "线索管理":
                        origin = "lead"
                    if origin is None and row.entity_id in request_id_set:
                        origin = "request"
                    if origin is None and eid and row.entity_id != eid and (row.module or "") == "需求管理":
                        origin = "request"
                    items.append(
                        await self._audit_to_response(
                            row, origin=origin, children=children_map.get(row.id)
                        )
                    )
                return items
