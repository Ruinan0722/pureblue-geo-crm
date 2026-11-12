from __future__ import annotations

from app.models.crm import CrmLead
from app.modules.crm.repository.base import (
    EMPTY_LEAD_STATS,
    Any,
    CrmAttachment,
    CrmLeadImportMeta,
    LeadNote,
    Select,
    Sequence,
    _doc_date,
    _doc_str,
    _format_dt,
    _format_note_date,
    _mentions_list,
    _now,
    _split_filter_values,
    and_,
    case,
    func,
    new_id,
    or_,
    select,
    sync_attachments,
    sync_lead_import_meta,
    sync_lead_notes,
)


def _empty_lead_children() -> dict[str, Any]:
    return {"importMeta": None, "notes": [], "attachments": []}


def _attachment_doc(item: CrmAttachment) -> dict[str, Any]:
    doc: dict[str, Any] = {
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
    }
    if item.origin:
        doc["origin"] = item.origin
    if item.source_lead_id:
        doc["sourceLeadId"] = item.source_lead_id
    if item.source_lead_attachment_id:
        doc["sourceLeadAttachmentId"] = item.source_lead_attachment_id
    if item.source_request_id:
        doc["sourceRequestId"] = item.source_request_id
    if item.source_request_attachment_id:
        doc["sourceRequestAttachmentId"] = item.source_request_attachment_id
    return doc

class LeadsRepositoryMixin:
    def _lead_filter_clauses(
            self,
            *,
            name: str | None = None,
            contact_name: str | None = None,
            sdr: str | None = None,
            sales: str | None = None,
            status: str | None = None,
            source: str | None = None,
            source_detail: str | None = None,
            level: str | None = None,
            region: str | None = None,
            first_contact_from: str | None = None,
            first_contact_to: str | None = None,
            transfer_from: str | None = None,
            transfer_to: str | None = None,
            created_from: str | None = None,
            created_to: str | None = None,
        ) -> list[Any]:
            clauses: list[Any] = []
            name_kw = (name or "").strip()
            if name_kw:
                like = f"%{name_kw}%"
                clauses.append(
                    or_(
                        CrmLead.company_name.like(like),
                        func.coalesce(CrmLead.brand_name, "").like(like),
                    )
                )
            contact_kw = (contact_name or "").strip()
            if contact_kw:
                clauses.append(CrmLead.contact_name.like(f"%{contact_kw}%"))
            sdr_kw = (sdr or "").strip()
            if sdr_kw:
                clauses.append(func.coalesce(CrmLead.sdr, "").like(f"%{sdr_kw}%"))
            sales_kw = (sales or "").strip()
            if sales_kw:
                clauses.append(func.coalesce(CrmLead.sales, "").like(f"%{sales_kw}%"))
            if status and status != "all":
                statuses = _split_filter_values(status)
                if len(statuses) == 1:
                    clauses.append(CrmLead.status == statuses[0])
                elif statuses:
                    clauses.append(CrmLead.status.in_(statuses))
            if source and source != "all":
                sources = _split_filter_values(source)
                if len(sources) == 1:
                    clauses.append(CrmLead.source == sources[0])
                elif sources:
                    clauses.append(CrmLead.source.in_(sources))
            if source_detail and source_detail != "all":
                details = _split_filter_values(source_detail)
                if len(details) == 1:
                    clauses.append(CrmLead.source_detail == details[0])
                elif details:
                    clauses.append(CrmLead.source_detail.in_(details))
            if level and level != "all":
                levels = _split_filter_values(level)
                unset_token = "__unset__"
                include_unset = unset_token in levels
                rated = [x for x in levels if x != unset_token]
                level_expr = func.coalesce(CrmLead.level, "")
                level_parts: list[Any] = []
                if rated:
                    level_parts.append(level_expr.in_(rated) if len(rated) > 1 else level_expr == rated[0])
                if include_unset:
                    level_parts.append(level_expr == "")
                if level_parts:
                    clauses.append(or_(*level_parts) if len(level_parts) > 1 else level_parts[0])
            if region and region != "all":
                regions = _split_filter_values(region)
                if len(regions) == 1:
                    clauses.append(CrmLead.region == regions[0])
                elif regions:
                    clauses.append(CrmLead.region.in_(regions))
            from_day = (first_contact_from or "").strip()[:10]
            to_day = (first_contact_to or "").strip()[:10]
            if from_day:
                clauses.append(CrmLead.first_contact_date >= from_day)
            if to_day:
                clauses.append(CrmLead.first_contact_date <= to_day)
            transfer_date = func.coalesce(CrmLead.transfer_date, "")
            transfer_from_day = (transfer_from or "").strip()[:10]
            transfer_to_day = (transfer_to or "").strip()[:10]
            if transfer_from_day:
                clauses.append(transfer_date >= transfer_from_day)
            if transfer_to_day:
                clauses.append(and_(transfer_date != "", transfer_date <= transfer_to_day))
            created_day = self._lead_created_day_expr()
            created_from_day = (created_from or "").strip()[:10]
            created_to_day = (created_to or "").strip()[:10]
            if created_from_day:
                clauses.append(created_day >= created_from_day)
            if created_to_day:
                clauses.append(and_(created_day != "", created_day <= created_to_day))
            return clauses

    async def list_leads(
            self, owner_ids: list[str] | None, *, include_unassigned: bool = False
        ) -> Sequence[CrmLead]:
            return await self._list_by_owners(
                CrmLead, owner_ids, include_unassigned=include_unassigned
            )

    async def search_leads(
            self,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
            sdr_pool_names: list[str] | None = None,
            name: str | None = None,
            contact_name: str | None = None,
            sdr: str | None = None,
            sales: str | None = None,
            status: str | None = None,
            source: str | None = None,
            source_detail: str | None = None,
            level: str | None = None,
            region: str | None = None,
            first_contact_from: str | None = None,
            first_contact_to: str | None = None,
            transfer_from: str | None = None,
            transfer_to: str | None = None,
            created_from: str | None = None,
            created_to: str | None = None,
            page: int = 1,
            page_size: int = 10,
        ) -> tuple[Sequence[CrmLead], int]:
            """按条件在 MySQL 分页查询线索；返回 (rows, total)。"""
            if owner_ids is not None and not owner_ids and not include_unassigned:
                return [], 0

            page = max(1, int(page or 1))
            page_size = min(100, max(1, int(page_size or 10)))
            offset = (page - 1) * page_size

            filters = self._lead_filter_clauses(
                name=name,
                contact_name=contact_name,
                sdr=sdr,
                sales=sales,
                status=status,
                source=source,
                source_detail=source_detail,
                level=level,
                region=region,
                first_contact_from=first_contact_from,
                first_contact_to=first_contact_to,
                transfer_from=transfer_from,
                transfer_to=transfer_to,
                created_from=created_from,
                created_to=created_to,
            )
            owner_clause = self._lead_owner_clause(
                owner_ids, include_unassigned=include_unassigned
            )
            owner_clause = self._lead_pool_clause(owner_clause, sdr_pool_names)
            where_parts = ([owner_clause] if owner_clause is not None else []) + filters

            created_day = self._lead_created_day_expr()
            count_stmt = select(func.count()).select_from(CrmLead)
            # 默认按创建时间倒序，便于按时间回溯
            list_stmt: Select[Any] = select(CrmLead).order_by(
                created_day.desc(), CrmLead.created_at.desc()
            )
            if where_parts:
                count_stmt = count_stmt.where(and_(*where_parts))
                list_stmt = list_stmt.where(and_(*where_parts))
            list_stmt = list_stmt.offset(offset).limit(page_size)

            total = int((await self.db.execute(count_stmt)).scalar_one() or 0)
            rows = (await self.db.execute(list_stmt)).scalars().all()
            return rows, total

    async def aggregate_lead_stats(
            self,
            owner_ids: list[str] | None,
            *,
            today: str,
            include_unassigned: bool = False,
            sdr_pool_names: list[str] | None = None,
        ) -> dict[str, int]:
            """按数据范围在 MySQL 聚合线索顶部统计（总数 / 今日新增 / 各状态）。"""
            if owner_ids is not None and not owner_ids and not include_unassigned:
                return dict(EMPTY_LEAD_STATS)

            # 优先 document.createdAt，否则回退 DATE(created_at)
            created_day = self._lead_created_day_expr()
            stmt = select(
                func.count().label("total"),
                func.coalesce(func.sum(case((created_day == today, 1), else_=0)), 0).label("today"),
                func.coalesce(func.sum(case((CrmLead.status == "untouched", 1), else_=0)), 0).label("untouched"),
                func.coalesce(func.sum(case((CrmLead.status == "touched", 1), else_=0)), 0).label("touched"),
                func.coalesce(func.sum(case((CrmLead.status == "converted", 1), else_=0)), 0).label("converted"),
                func.coalesce(func.sum(case((CrmLead.status == "invalid", 1), else_=0)), 0).label("invalid"),
            )
            owner_clause = self._lead_owner_clause(
                owner_ids, include_unassigned=include_unassigned
            )
            owner_clause = self._lead_pool_clause(owner_clause, sdr_pool_names)
            if owner_clause is not None:
                stmt = stmt.where(owner_clause)

            row = (await self.db.execute(stmt)).one()
            return {
                "total": int(row.total or 0),
                "today": int(row.today or 0),
                "untouched": int(row.untouched or 0),
                "touched": int(row.touched or 0),
                "converted": int(row.converted or 0),
                "invalid": int(row.invalid or 0),
            }

    async def get_lead(self, lead_id: str) -> CrmLead | None:
            return await self.db.get(CrmLead, lead_id)

    async def get_lead_children(self, lead_id: str) -> dict[str, Any]:
        """线索子表数据（导入元数据 / 跟进），供序列化组装。"""
        return (await self.list_lead_children([lead_id])).get(
            lead_id,
            _empty_lead_children(),
        )

    async def list_lead_children(
        self, lead_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        """批量读取线索子表（避免列表 N+1）。"""
        ids = [str(x) for x in lead_ids if str(x)]
        out: dict[str, dict[str, Any]] = {
            oid: _empty_lead_children() for oid in ids
        }
        if not ids:
            return out
        notes = (
            await self.db.execute(
                select(LeadNote)
                .where(LeadNote.lead_id.in_(ids))
                .order_by(LeadNote.lead_id, LeadNote.sort_order)
            )
        ).scalars().all()
        for item in notes:
            bucket = out.setdefault(item.lead_id, _empty_lead_children())
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
            bucket["notes"].append(note)
        metas = (
            await self.db.execute(
                select(CrmLeadImportMeta).where(CrmLeadImportMeta.lead_id.in_(ids))
            )
        ).scalars().all()
        for item in metas:
            bucket = out.setdefault(item.lead_id, _empty_lead_children())
            meta: dict[str, Any] = {}
            if item.imported_at is not None:
                meta["importedAt"] = _format_dt(item.imported_at)
            if item.feishu_lead_no is not None:
                meta["feishuLeadNo"] = item.feishu_lead_no
            if item.created_by_name is not None:
                meta["createdByName"] = item.created_by_name
            if item.feishu_record_id is not None:
                meta["feishuRecordId"] = item.feishu_record_id
            if item.landingpage_raw is not None:
                meta["landingpageRaw"] = item.landingpage_raw
            if item.utm_source is not None:
                meta["utmSource"] = item.utm_source
            if getattr(item, "utm_medium", None) is not None:
                meta["utmMedium"] = item.utm_medium
            if getattr(item, "utm_campaign", None) is not None:
                meta["utmCampaign"] = item.utm_campaign
            if item.platform is not None:
                meta["platform"] = item.platform
            if item.external_record_id is not None:
                meta["externalRecordId"] = item.external_record_id
            if getattr(item, "last_event_id", None) is not None:
                meta["lastEventId"] = item.last_event_id
            if getattr(item, "occurred_at", None) is not None:
                meta["occurredAt"] = _format_dt(item.occurred_at)
            if item.operator_name is not None or getattr(item, "operator_id", None) is not None:
                meta["operator"] = {
                    key: value
                    for key, value in {
                        "id": getattr(item, "operator_id", None),
                        "name": item.operator_name,
                    }.items()
                    if value is not None
                }
            bucket["importMeta"] = meta or None
        attachments = (
            await self.db.execute(
                select(CrmAttachment).where(
                    CrmAttachment.entity_type == "lead",
                    CrmAttachment.entity_id.in_(ids),
                )
            )
        ).scalars().all()
        for item in attachments:
            bucket = out.setdefault(item.entity_id, _empty_lead_children())
            bucket["attachments"].append(_attachment_doc(item))
        return out

    async def create_lead(
            self,
            *,
            document: dict[str, Any],
            owner_user_id: str | None,
        ) -> CrmLead:
            lead_id = str(document.get("id") or new_id("l"))
            document = {**document, "id": lead_id}
            now = _now()
            row = CrmLead(
                id=lead_id,
                owner_user_id=owner_user_id,
                status=str(document.get("status") or "untouched"),
                company_name=str(document.get("companyName") or ""),
                source=_doc_str(document, "source"),
                source_detail=_doc_str(document, "sourceDetail"),
                level=_doc_str(document, "level"),
                region=_doc_str(document, "region"),
                first_contact_date=_doc_date(document, "firstContactDate"),
                contact_name=_doc_str(document, "contactName"),
                follow_state=_doc_str(document, "followState"),
                brand_name=_doc_str(document, "brandName"),
                sdr=_doc_str(document, "sdr"),
                sales=_doc_str(document, "sales"),
                transfer_date=_doc_date(document, "transferDate"),
                created_day=_doc_date(document, "createdAt"),
                contact_title=_doc_str(document, "contactTitle"),
                contact_department=_doc_str(document, "contactDepartment"),
                contact_phone=_doc_str(document, "contactPhone"),
                contact_wechat=_doc_str(document, "contactWechat"),
                email=_doc_str(document, "email"),
                website=_doc_str(document, "website"),
                requirements=_doc_str(document, "requirements"),
                city=_doc_str(document, "city"),
                invalid_reason=_doc_str(document, "invalidReason"),
                wechat_added=(
                    None if document.get("wechatAdded") is None else bool(document.get("wechatAdded"))
                ),
                converted_customer_id=_doc_str(document, "convertedCustomerId"),
                converted_coverage_id=_doc_str(document, "convertedCoverageId"),
                source_customer_id=_doc_str(document, "sourceCustomerId"),
                lead_type=_doc_str(document, "leadType"),
                industry=_doc_str(document, "industry"),
                channel_type=_doc_str(document, "channelType"),
                signing_method=_doc_str(document, "signingMethod"),
                duplicate_key=_doc_str(document, "duplicateKey"),
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
            await self.db.flush()
            from app.core.exceptions import ValidationError

            missing = [
                key
                for key in ("notes", "attachments")
                if key not in document or not isinstance(document.get(key), list)
            ]
            if missing:
                raise ValidationError(
                    f"线索保存缺少集合字段 {', '.join(missing)}，须先 compose+merge"
                )
            await sync_attachments(
                self.db, "lead", lead_id, list(document.get("attachments") or [])
            )
            await sync_lead_notes(self.db, lead_id, list(document.get("notes") or []))
            if "importMeta" in document:
                await sync_lead_import_meta(self.db, lead_id, document.get("importMeta"))
            return row

    async def save_lead(self, row: CrmLead, document: dict[str, Any]) -> CrmLead:
            document = {**document, "id": row.id}
            row.status = str(document.get("status") or row.status)
            row.company_name = str(document.get("companyName") or row.company_name)
            row.source = _doc_str(document, "source")
            row.source_detail = _doc_str(document, "sourceDetail")
            row.level = _doc_str(document, "level")
            row.region = _doc_str(document, "region")
            row.first_contact_date = _doc_date(document, "firstContactDate")
            row.contact_name = _doc_str(document, "contactName")
            row.follow_state = _doc_str(document, "followState")
            row.brand_name = _doc_str(document, "brandName")
            row.sdr = _doc_str(document, "sdr")
            row.sales = _doc_str(document, "sales")
            row.transfer_date = _doc_date(document, "transferDate")
            row.created_day = _doc_date(document, "createdAt") or row.created_day
            row.contact_title = _doc_str(document, "contactTitle")
            row.contact_department = _doc_str(document, "contactDepartment")
            row.contact_phone = _doc_str(document, "contactPhone")
            row.contact_wechat = _doc_str(document, "contactWechat")
            row.email = _doc_str(document, "email")
            row.website = _doc_str(document, "website")
            row.requirements = _doc_str(document, "requirements")
            row.city = _doc_str(document, "city")
            row.invalid_reason = _doc_str(document, "invalidReason")
            if document.get("wechatAdded") is not None:
                row.wechat_added = bool(document.get("wechatAdded"))
            row.converted_customer_id = _doc_str(document, "convertedCustomerId")
            row.converted_coverage_id = _doc_str(document, "convertedCoverageId")
            row.source_customer_id = _doc_str(document, "sourceCustomerId")
            row.updated_at = _now()
            await self.db.flush()
            from app.core.exceptions import ValidationError

            missing = [
                key
                for key in ("notes", "attachments")
                if key not in document or not isinstance(document.get(key), list)
            ]
            if missing:
                raise ValidationError(
                    f"线索保存缺少集合字段 {', '.join(missing)}，须先 compose+merge"
                )
            await sync_attachments(
                self.db, "lead", row.id, list(document.get("attachments") or [])
            )
            await sync_lead_notes(self.db, row.id, list(document.get("notes") or []))
            if "importMeta" in document:
                await sync_lead_import_meta(self.db, row.id, document.get("importMeta"))
            return row
