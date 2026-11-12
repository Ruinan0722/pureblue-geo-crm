from __future__ import annotations

from app.models.crm import CrmAuditRelatedEntity
from app.modules.crm.repository.base import (
    Any,
    CrmAttachment,
    CrmAuditRecord,
    Select,
    Sequence,
    _now,
    and_,
    datetime,
    delete,
    or_,
    select,
    sync_audit_changes,
)


class AuditRepositoryMixin:
    async def get_attachment_storage_id(self, attachment_id: str) -> str:
            """逻辑附件记录 → 物理文件 id；转客户/转商机附件共享来源文件。"""
            aid = (attachment_id or "").strip()
            if not aid:
                return ""
            row = await self.db.get(CrmAttachment, aid)
            if row is None:
                return aid
            return str(
                row.source_lead_attachment_id
                or row.source_request_attachment_id
                or row.id
                or aid
            ).strip()

    async def find_entities_for_attachment(self, attachment_id: str) -> list[tuple[str, str]]:
            """按统一附件表定位全部父实体（lead|coverage|opportunity|contract|request）。

            返回 [(kind, entity_id), ...]，kind ∈ lead|customer|opportunity|contract|request。
            同一附件可能挂在线索与转客户后的客户上，调用方按「任一可读」判定即可。
            """
            aid = (attachment_id or "").strip()
            if not aid:
                return []
            rows = (
                await self.db.execute(
                    select(CrmAttachment.entity_type, CrmAttachment.entity_id).where(
                        CrmAttachment.id == aid
                    )
                )
            ).all()
            return [(str(kind), str(entity_id)) for kind, entity_id in rows]

    async def get_audit_record(self, record_id: str) -> CrmAuditRecord | None:
            return await self.db.get(CrmAuditRecord, record_id)

    async def create_audit_record(
            self,
            *,
            record_id: str,
            module: str,
            entity_type: str,
            entity_id: str,
            related_entity_ids: list[str] | None,
            entity_name: str,
            action: str,
            actor: str,
            actor_user_id: str | None,
            timestamp_at: datetime,
            changes: list[dict[str, Any]],
        ) -> CrmAuditRecord:
            row = CrmAuditRecord(
                id=record_id,
                module=module,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_name=entity_name,
                action=action,
                actor=actor,
                actor_user_id=actor_user_id,
                timestamp_at=timestamp_at,
                created_at=_now(),
            )
            self.db.add(row)
            await self.db.flush()
            await sync_audit_changes(self.db, record_id, changes)
            await self.db.execute(
                delete(CrmAuditRelatedEntity).where(
                    CrmAuditRelatedEntity.audit_id == record_id
                )
            )
            for index, eid in enumerate(related_entity_ids or []):
                self.db.add(
                    CrmAuditRelatedEntity(
                        id=f"{record_id}-re-{index}",
                        audit_id=record_id,
                        entity_id=str(eid),
                    )
                )
            return row

    async def list_audit_records(
            self,
            *,
            entity_id: str | None = None,
            also_entity_ids: Sequence[str] | None = None,
            module: str | None = None,
            limit: int = 500,
        ) -> Sequence[CrmAuditRecord]:
            limit = max(1, min(int(limit or 500), 500))
            stmt: Select[Any] = select(CrmAuditRecord).order_by(CrmAuditRecord.timestamp_at.desc()).limit(limit)
            clauses: list[Any] = []
            entity = (entity_id or "").strip()
            extra_ids = [str(x).strip() for x in (also_entity_ids or []) if str(x).strip() and str(x).strip() != entity]
            if entity or extra_ids:
                match_ids = ([entity] if entity else []) + extra_ids
                id_clauses: list[Any] = []
                for eid in match_ids:
                    related_match = (
                        select(CrmAuditRelatedEntity.id)
                        .where(
                            CrmAuditRelatedEntity.audit_id == CrmAuditRecord.id,
                            CrmAuditRelatedEntity.entity_id == eid,
                        )
                        .exists()
                    )
                    id_clauses.append(or_(CrmAuditRecord.entity_id == eid, related_match))
                clauses.append(or_(*id_clauses))
            mod = (module or "").strip()
            if mod:
                clauses.append(CrmAuditRecord.module == mod)
            if clauses:
                stmt = stmt.where(and_(*clauses))
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def append_related_entity_to_audits(self, *, source_entity_id: str, related_entity_id: str) -> int:
            """把 related_entity_id 写入 source 实体全部审计的 related_entity_ids（转客户带入）。"""
            source = (source_entity_id or "").strip()
            related = (related_entity_id or "").strip()
            if not source or not related or source == related:
                return 0
            stmt = select(CrmAuditRecord).where(CrmAuditRecord.entity_id == source)
            result = await self.db.execute(stmt)
            rows = list(result.scalars().all())
            updated = 0
            for row in rows:
                existing = (
                    await self.db.execute(
                        select(CrmAuditRelatedEntity.entity_id).where(
                            CrmAuditRelatedEntity.audit_id == row.id
                        )
                    )
                ).scalars().all()
                existing_ids = [str(x) for x in existing if str(x).strip()]
                if related in existing_ids:
                    continue
                self.db.add(
                    CrmAuditRelatedEntity(
                        id=f"{row.id}-re-{len(existing_ids)}",
                        audit_id=row.id,
                        entity_id=related,
                    )
                )
                updated += 1
            if updated:
                await self.db.flush()
            return updated
