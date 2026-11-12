from __future__ import annotations

import json

from app.modules.crm.repository.base import (
    Any,
    CrmAttachment,
    CrmOpportunity,
    OpportunityNote,
    OpportunityProjectType,
    OpportunityRequestLink,
    OpportunityStageHistory,
    Sequence,
    _doc_date,
    _doc_decimal,
    _doc_str,
    _format_dt,
    _format_note_date,
    _mentions_list,
    _now,
    func,
    new_id,
    select,
    sync_attachments,
    sync_opportunity_links,
    sync_opportunity_notes,
    sync_stage_history,
)


def _empty_opportunity_children() -> dict[str, list[dict[str, Any]]]:
    return {
        "stageHistory": [],
        "attachments": [],
        "projectTypes": [],
        "requestIds": [],
        "notes": [],
        "advisorNotes": [],
    }


class OpportunitiesRepositoryMixin:
    async def list_opportunities(
            self, owner_ids: list[str] | None, *, include_unassigned: bool = False
        ) -> Sequence[CrmOpportunity]:
            return await self._list_by_owners(
                CrmOpportunity, owner_ids, include_unassigned=include_unassigned
            )

    async def count_opportunities_by_customer_ids(
            self,
            customer_ids: Sequence[str],
            *,
            exclude_lost: bool = True,
            owner_ids: list[str] | None = None,
        ) -> dict[str, int]:
            """按客户 ID 批量统计商机数（列表页用，默认不含输单；可按对接池可见 owner 过滤）。"""
            ids = [cid for cid in customer_ids if cid]
            if not ids:
                return {}
            if owner_ids is not None and not owner_ids:
                return {cid: 0 for cid in ids}
            stmt = (
                select(CrmOpportunity.customer_id, func.count())
                .where(CrmOpportunity.customer_id.in_(ids))
                .group_by(CrmOpportunity.customer_id)
            )
            if exclude_lost:
                stmt = stmt.where(CrmOpportunity.stage != "lost")
            if owner_ids is not None:
                stmt = stmt.where(CrmOpportunity.owner_user_id.in_(owner_ids))
            rows = (await self.db.execute(stmt)).all()
            return {str(customer_id): int(count or 0) for customer_id, count in rows}

    async def get_opportunity(self, opportunity_id: str) -> CrmOpportunity | None:
            return await self.db.get(CrmOpportunity, opportunity_id)

    async def get_opportunity_for_update(self, opportunity_id: str) -> CrmOpportunity | None:
            result = await self.db.execute(select(CrmOpportunity).where(CrmOpportunity.id == opportunity_id).with_for_update().execution_options(populate_existing=True))
            return result.scalars().first()

    async def find_active_opportunity_by_partner_name(self, partner_id: str, name: str) -> CrmOpportunity | None:
            result = await self.db.execute(select(CrmOpportunity).where(CrmOpportunity.partner_id == partner_id, CrmOpportunity.name == name, CrmOpportunity.stage != "lost").limit(1))
            return result.scalars().first()

    async def find_active_opportunity_by_customer_name(
            self, customer_id: str, name: str
        ) -> CrmOpportunity | None:
            """按客户 + 商机名称查重（排除输单），用于统一命名规则下的同名拦截。"""
            cid = (customer_id or "").strip()
            trimmed = (name or "").strip()
            if not cid or not trimmed:
                return None
            stmt = (
                select(CrmOpportunity)
                .where(
                    CrmOpportunity.customer_id == cid,
                    CrmOpportunity.name == trimmed,
                    CrmOpportunity.stage != "lost",
                )
                .limit(1)
            )
            return (await self.db.execute(stmt)).scalars().first()

    async def get_opportunity_children(
        self, opportunity_id: str
    ) -> dict[str, list[dict[str, Any]]]:
        """商机子表数据（阶段历史 / 附件），供序列化组装。"""
        return (await self.list_opportunity_children([opportunity_id])).get(
            opportunity_id,
            _empty_opportunity_children(),
        )

    async def list_opportunity_children(
        self, opportunity_ids: Sequence[str]
    ) -> dict[str, dict[str, list[dict[str, Any]]]]:
        """批量读取商机子表（避免列表 N+1）。"""
        ids = [str(x) for x in opportunity_ids if str(x)]
        out: dict[str, dict[str, list[dict[str, Any]]]] = {
            oid: _empty_opportunity_children() for oid in ids
        }
        if not ids:
            return out
        history = (
            await self.db.execute(
                select(OpportunityStageHistory)
                .where(OpportunityStageHistory.opportunity_id.in_(ids))
                .order_by(
                    OpportunityStageHistory.opportunity_id,
                    OpportunityStageHistory.sort_order,
                )
            )
        ).scalars().all()
        for item in history:
            out.setdefault(item.opportunity_id, _empty_opportunity_children())[
                "stageHistory"
            ].append(
                {
                    "stage": item.stage,
                    "enteredAt": _format_dt(item.entered_at),
                    "leftAt": _format_dt(item.left_at),
                    "reason": item.reason,
                    "changeType": item.change_type,
                }
            )
        attachments = (
            await self.db.execute(
                select(CrmAttachment).where(
                    CrmAttachment.entity_type == "opportunity",
                    CrmAttachment.entity_id.in_(ids),
                )
            )
        ).scalars().all()
        for item in attachments:
            out.setdefault(item.entity_id, _empty_opportunity_children())[
                "attachments"
            ].append(
                {
                    "id": item.id,
                    "name": item.name,
                    "size": item.size,
                    "kind": item.kind,
                    "url": item.url,
                    "storagePath": item.storage_path,
                    "contentType": item.content_type,
                    "description": item.description,
                    "checksum": item.checksum,
                    "uploadedBy": item.uploaded_by,
                    "uploadedAt": _format_dt(item.uploaded_at),
                    **({"origin": item.origin} if item.origin else {}),
                    **({"sourceLeadId": item.source_lead_id} if item.source_lead_id else {}),
                    **(
                        {"sourceLeadAttachmentId": item.source_lead_attachment_id}
                        if item.source_lead_attachment_id
                        else {}
                    ),
                    **(
                        {"sourceRequestId": item.source_request_id}
                        if item.source_request_id
                        else {}
                    ),
                    **(
                        {"sourceRequestAttachmentId": item.source_request_attachment_id}
                        if item.source_request_attachment_id
                        else {}
                    ),
                }
            )
        project_types = (
            await self.db.execute(
                select(OpportunityProjectType)
                .where(OpportunityProjectType.opportunity_id.in_(ids))
                .order_by(OpportunityProjectType.opportunity_id)
            )
        ).scalars().all()
        for item in project_types:
            out.setdefault(item.opportunity_id, _empty_opportunity_children())[
                "projectTypes"
            ].append(item.project_type)
        notes = (
            await self.db.execute(
                select(OpportunityNote)
                .where(OpportunityNote.opportunity_id.in_(ids))
                .order_by(
                    OpportunityNote.opportunity_id,
                    OpportunityNote.kind,
                    OpportunityNote.sort_order,
                )
            )
        ).scalars().all()
        for item in notes:
            bucket = out.setdefault(item.opportunity_id, _empty_opportunity_children())
            note: dict[str, Any] = {
                "id": item.id,
                "author": item.author,
                "content": item.content,
                "date": _format_note_date(item.date),
            }
            if item.follow_type is not None:
                note["followType"] = item.follow_type
            if item.wechat_added:
                note["wechatAdded"] = True
            mentions = _mentions_list(item.mentions)
            if mentions is not None:
                note["mentions"] = mentions
            if item.next_follow_at is not None:
                note["nextFollowAt"] = item.next_follow_at.strftime("%Y-%m-%d")
            if item.origin is not None:
                note["origin"] = item.origin
            if item.source_request_id is not None:
                note["sourceRequestId"] = item.source_request_id
            if item.source_request_note_id is not None:
                note["sourceRequestNoteId"] = item.source_request_note_id
            bucket["notes" if item.kind == "sales" else "advisorNotes"].append(note)
        return out

    async def list_opportunities_by_ids(self, opportunity_ids: Sequence[str]) -> Sequence[CrmOpportunity]:
            ids = [oid for oid in opportunity_ids if oid]
            if not ids:
                return []
            result = await self.db.execute(select(CrmOpportunity).where(CrmOpportunity.id.in_(ids)))
            return list(result.scalars().all())

    async def create_opportunity(
            self,
            *,
            document: dict[str, Any],
            owner_user_id: str | None,
        ) -> CrmOpportunity:
            opp_id = str(document.get("id") or new_id("o"))
            document = {**document, "id": opp_id}
            now = _now()
            row = CrmOpportunity(
                id=opp_id,
                owner_user_id=owner_user_id,
                customer_id=str(document.get("customerId") or ""),
                business_type=str(document.get("businessType") or "direct"),
                partner_id=_doc_str(document, "partnerId"),
                partner_name=_doc_str(document, "partnerName"),
                stage=str(document.get("stage") or "contact"),
                amount=_doc_decimal(document, "amount"),
                expected_sign_date=_doc_date(document, "expectedSignDate"),
                last_follow_at=_doc_date(document, "lastFollowAt"),
                next_follow_at=_doc_date(document, "nextFollowAt"),
                lost_reason=_doc_str(document, "lostReason"),
                name=_doc_str(document, "name"),
                brand_name=_doc_str(document, "brandName"),
                region=_doc_str(document, "region"),
                geo_source=_doc_str(document, "geoSource"),
                goal=_doc_str(document, "goal"),
                platform=_doc_str(document, "platform"),
                period=_doc_str(document, "period"),
                probability=(
                    int(document["probability"])
                    if document.get("probability") is not None
                    else None
                ),
                owner=_doc_str(document, "owner"),
                advisor=_doc_str(document, "advisor"),
                customer_success=_doc_str(document, "customerSuccess"),
                subsidiary_id=_doc_str(document, "subsidiaryId"),
                subsidiary_name=_doc_str(document, "subsidiaryName"),
                primary_contact_id=_doc_str(document, "primaryContactId"),
                lost_stage=_doc_str(document, "lostStage"),
                lost_reason_l1=_doc_str(document, "lostReasonL1"),
                lost_reason_l2=_doc_str(document, "lostReasonL2"),
                competitor=_doc_str(document, "competitor"),
                project_manager_request_json=(
                    json.dumps(document.get("projectManagerRequest"), ensure_ascii=False)
                    if isinstance(document.get("projectManagerRequest"), dict)
                    else None
                ),
                created_day=_doc_date(document, "createdAt"),
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
            await self.db.flush()
            await self._sync_opportunity_children(opp_id, document)
            return row

    async def _sync_opportunity_children(
        self, opportunity_id: str, document: dict[str, Any]
    ) -> None:
        """集合字段全量写穿：调用方必须传入已 compose+merge 的完整 document。

        缺键 → ValidationError（禁止静默 refill / or [] 掩盖漏 compose）。
        """
        from app.core.exceptions import ValidationError

        required = (
            "attachments",
            "stageHistory",
            "projectTypes",
            "requestIds",
            "notes",
            "advisorNotes",
        )
        missing = [
            key
            for key in required
            if key not in document or not isinstance(document.get(key), list)
        ]
        if missing:
            raise ValidationError(
                f"商机保存缺少集合字段 {', '.join(missing)}，须先 compose+merge"
            )
        await sync_attachments(
            self.db, "opportunity", opportunity_id, list(document.get("attachments") or [])
        )
        await sync_stage_history(
            self.db, opportunity_id, list(document.get("stageHistory") or [])
        )
        await sync_opportunity_links(
            self.db,
            opportunity_id,
            list(document.get("projectTypes") or []),
            list(document.get("requestIds") or []),
        )
        await sync_opportunity_notes(
            self.db,
            opportunity_id,
            list(document.get("notes") or []),
            list(document.get("advisorNotes") or []),
        )

    async def save_opportunity(self, row: CrmOpportunity, document: dict[str, Any]) -> CrmOpportunity:
            document = {**document, "id": row.id}
            row.customer_id = str(document.get("customerId") or row.customer_id)
            row.business_type = str(document.get("businessType") or row.business_type or "direct")
            row.partner_id = _doc_str(document, "partnerId")
            row.partner_name = _doc_str(document, "partnerName")
            row.stage = str(document.get("stage") or row.stage)
            row.amount = _doc_decimal(document, "amount")
            row.expected_sign_date = _doc_date(document, "expectedSignDate")
            row.last_follow_at = _doc_date(document, "lastFollowAt")
            row.next_follow_at = _doc_date(document, "nextFollowAt")
            row.lost_reason = _doc_str(document, "lostReason")
            row.name = _doc_str(document, "name")
            row.brand_name = _doc_str(document, "brandName")
            row.region = _doc_str(document, "region")
            row.geo_source = _doc_str(document, "geoSource")
            row.goal = _doc_str(document, "goal")
            row.platform = _doc_str(document, "platform")
            row.period = _doc_str(document, "period")
            if document.get("probability") is not None:
                row.probability = int(document["probability"])
            row.owner = _doc_str(document, "owner")
            row.advisor = _doc_str(document, "advisor")
            row.customer_success = _doc_str(document, "customerSuccess")
            row.subsidiary_id = _doc_str(document, "subsidiaryId")
            row.subsidiary_name = _doc_str(document, "subsidiaryName")
            row.primary_contact_id = _doc_str(document, "primaryContactId")
            row.lost_stage = _doc_str(document, "lostStage")
            row.lost_reason_l1 = _doc_str(document, "lostReasonL1")
            row.lost_reason_l2 = _doc_str(document, "lostReasonL2")
            row.competitor = _doc_str(document, "competitor")
            row.project_manager_request_json = (
                json.dumps(document.get("projectManagerRequest"), ensure_ascii=False)
                if isinstance(document.get("projectManagerRequest"), dict)
                else None
            )
            row.created_day = _doc_date(document, "createdAt")
            row.updated_at = _now()
            await self.db.flush()
            await self._sync_opportunity_children(row.id, document)
            return row
