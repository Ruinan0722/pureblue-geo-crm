from __future__ import annotations

import json
from datetime import timedelta

from app.models.crm import CrmContact, CrmCoverageImportMeta, CrmSalesCoverage
from app.modules.crm.repository.base import (
    Any,
    CrmAttachment,
    CrmFollowUp,
    Sequence,
    _doc_date,
    _doc_datetime,
    _doc_str,
    _format_dt,
    _format_note_date,
    _mentions_list,
    _now,
    delete,
    new_id,
    select,
    sync_attachments,
    sync_coverage_import_meta,
)


class CoveragesRepositoryMixin:
    async def get_coverage_contact(
        self, *, customer_id: str, contact_id: str
    ) -> CrmContact | None:
        """按客户 + 联系人 id 定位联系人（用于改派时找源池）。"""
        result = await self.db.execute(
            select(CrmContact)
            .where(
                CrmContact.customer_id == customer_id,
                CrmContact.id == contact_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_coverage_children(
        self, coverage_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        """批量读取对接池子表（联系人 / 跟进 / 附件 / importMeta），供序列化与合并。"""
        ids = [str(x) for x in coverage_ids if str(x)]
        out: dict[str, dict[str, Any]] = {
            cid: {"contacts": [], "notes": [], "attachments": [], "importMeta": None}
            for cid in ids
        }
        if not ids:
            return out
        contacts = (
            await self.db.execute(
                select(CrmContact)
                .where(CrmContact.coverage_id.in_(ids))
                .order_by(CrmContact.coverage_id, CrmContact.created_at, CrmContact.id)
            )
        ).scalars().all()
        for item in contacts:
            bucket = out.setdefault(
                item.coverage_id,
                {"contacts": [], "notes": [], "attachments": [], "importMeta": None},
            )
            contact_doc: dict[str, Any] = {
                    "id": item.id,
                    "name": item.name,
                    "title": item.title,
                    "phone": item.phone,
                    "wechat": item.wechat,
                    "email": item.email,
                    "status": item.status,
                    "isPrimary": item.is_primary,
                    "active": item.active,
                    "wechatAdded": item.wechat_added,
                    "source": item.source,
                    "sourceDetail": item.source_detail,
                    "sourceLeadId": item.source_lead_id,
            }
            created = _format_note_date(item.created_at)
            if created:
                contact_doc["createdAt"] = created
            bucket["contacts"].append(contact_doc)
        notes = (
            await self.db.execute(
                select(CrmFollowUp)
                .where(CrmFollowUp.coverage_id.in_(ids))
                .order_by(
                    CrmFollowUp.coverage_id,
                    CrmFollowUp.created_at.desc(),
                    CrmFollowUp.id.desc(),
                )
            )
        ).scalars().all()
        for item in notes:
            bucket = out.setdefault(
                item.coverage_id,
                {"contacts": [], "notes": [], "attachments": [], "importMeta": None},
            )
            note: dict[str, Any] = {
                "id": item.id,
                "author": item.author,
                "content": item.content,
                "date": _format_note_date(item.created_at),
            }
            if item.follow_type is not None:
                note["followType"] = item.follow_type
            contact_id = (item.contact_id or "").strip()
            if contact_id:
                note["contactId"] = contact_id
            contact_name = (item.contact_name or "").strip()
            if contact_name:
                note["contactName"] = contact_name
            if item.wechat_added:
                note["wechatAdded"] = True
            mentions = _mentions_list(item.mentions)
            if mentions is not None:
                note["mentions"] = mentions
            if item.next_follow_at is not None:
                note["nextFollowAt"] = item.next_follow_at.strftime("%Y-%m-%d")
            if item.origin is not None:
                note["origin"] = item.origin
            if item.source_lead_id is not None:
                note["sourceLeadId"] = item.source_lead_id
            if item.source_lead_note_id is not None:
                note["sourceLeadNoteId"] = item.source_lead_note_id
            bucket["notes"].append(note)
        attachments = (
            await self.db.execute(
                select(CrmAttachment).where(
                    CrmAttachment.entity_type == "coverage",
                    CrmAttachment.entity_id.in_(ids),
                )
            )
        ).scalars().all()
        for item in attachments:
            att: dict[str, Any] = {
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
                "uploadedAt": (
                    item.uploaded_at.strftime("%Y-%m-%d %H:%M:%S")
                    if item.uploaded_at
                    else None
                ),
            }
            if item.origin:
                att["origin"] = item.origin
            if item.source_lead_id:
                att["sourceLeadId"] = item.source_lead_id
            if item.source_lead_attachment_id:
                att["sourceLeadAttachmentId"] = item.source_lead_attachment_id
            if item.source_request_id:
                att["sourceRequestId"] = item.source_request_id
            if item.source_request_attachment_id:
                att["sourceRequestAttachmentId"] = item.source_request_attachment_id
            out.setdefault(
                item.entity_id,
                {"contacts": [], "notes": [], "attachments": [], "importMeta": None},
            )["attachments"].append(att)
        metas = (
            await self.db.execute(
                select(CrmCoverageImportMeta).where(CrmCoverageImportMeta.coverage_id.in_(ids))
            )
        ).scalars().all()
        for item in metas:
            bucket = out.setdefault(
                item.coverage_id,
                {"contacts": [], "notes": [], "attachments": [], "importMeta": None},
            )
            meta: dict[str, Any] = {}
            if item.source is not None:
                meta["source"] = item.source
            if item.backfill is not None:
                meta["backfill"] = bool(item.backfill)
            if item.from_owner_user_id is not None:
                meta["fromOwnerUserId"] = item.from_owner_user_id
            if item.imported_at is not None:
                meta["importedAt"] = _format_dt(item.imported_at)
            bucket["importMeta"] = meta or None
        return out

    async def get_coverage(self, coverage_id: str) -> CrmSalesCoverage | None:
            return await self.db.get(CrmSalesCoverage, coverage_id)

    async def get_coverage_by_customer_owner(
            self, customer_id: str, owner_user_id: str
        ) -> CrmSalesCoverage | None:
            result = await self.db.execute(
                select(CrmSalesCoverage).where(
                    CrmSalesCoverage.customer_id == customer_id,
                    CrmSalesCoverage.owner_user_id == owner_user_id,
                )
            )
            return result.scalar_one_or_none()

    async def list_coverages_for_customer(
            self,
            customer_id: str,
            *,
            owner_ids: list[str] | None,
        ) -> list[CrmSalesCoverage]:
            stmt = select(CrmSalesCoverage).where(CrmSalesCoverage.customer_id == customer_id)
            if owner_ids is not None:
                if not owner_ids:
                    return []
                stmt = stmt.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
            stmt = stmt.order_by(CrmSalesCoverage.updated_at.desc())
            result = await self.db.execute(stmt)
            return list(result.scalars().all())

    async def create_coverage(
            self,
            *,
            customer_id: str,
            owner_user_id: str,
            document: dict[str, Any],
            status: str | None = None,
        ) -> CrmSalesCoverage:
            cov_id = str(document.get("id") or new_id("cv-"))
            status_val = str(status or document.get("status") or "awaiting_contact")
            document = {
                **document,
                "id": cov_id,
                "customerId": customer_id,
                "ownerUserId": owner_user_id,
                "status": status_val,
                "isolationVersion": 1,
            }
            now = _now()
            row = CrmSalesCoverage(
                id=cov_id,
                customer_id=customer_id,
                owner_user_id=owner_user_id,
                status=status_val,
                owner_name=_doc_str(document, "ownerName"),
                client_dept=_doc_str(document, "clientDept"),
                source_lead_id=_doc_str(document, "sourceLeadId"),
                sdr_name=_doc_str(document, "sdrName"),
                sdr_transfer_date=_doc_date(document, "sdrTransferDate"),
                isolation_version=(
                    None
                    if document.get("isolationVersion") is None
                    else int(document.get("isolationVersion"))
                ),
                last_follow_at=_doc_date(document, "lastFollowAt"),
                next_follow_at=_doc_date(document, "nextFollowAt"),
                is_key=None if document.get("isKey") is None else bool(document.get("isKey")),
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
            await self.db.flush()
            await self._sync_coverage_child_rows(row, document)
            if "importMeta" in document:
                meta = document.get("importMeta")
                await sync_coverage_import_meta(
                    self.db, row.id, meta if isinstance(meta, dict) else None
                )
            return row

    async def save_coverage(
            self,
            row: CrmSalesCoverage,
            document: dict[str, Any],
            *,
            status: str | None = None,
        ) -> CrmSalesCoverage:
            status_val = str(status or document.get("status") or row.status)
            document = {
                **document,
                "id": row.id,
                "customerId": row.customer_id,
                "ownerUserId": row.owner_user_id,
                "status": status_val,
            }
            row.status = status_val
            row.owner_name = _doc_str(document, "ownerName")
            row.client_dept = _doc_str(document, "clientDept")
            row.source_lead_id = _doc_str(document, "sourceLeadId")
            row.sdr_name = _doc_str(document, "sdrName")
            row.sdr_transfer_date = _doc_date(document, "sdrTransferDate")
            if document.get("isolationVersion") is not None:
                row.isolation_version = int(document.get("isolationVersion"))
            row.last_follow_at = _doc_date(document, "lastFollowAt")
            row.next_follow_at = _doc_date(document, "nextFollowAt")
            if document.get("isKey") is not None:
                row.is_key = bool(document.get("isKey"))
            row.updated_at = _now()
            await self.db.flush()
            await self._sync_coverage_child_rows(row, document)
            # 缺键跳过：禁止未 compose 时 DELETE importMeta
            if "importMeta" in document:
                meta = document.get("importMeta")
                await sync_coverage_import_meta(
                    self.db, row.id, meta if isinstance(meta, dict) else None
                )
            return row

    async def _sync_coverage_child_rows(
        self,
        coverage: CrmSalesCoverage,
        document: dict[str, Any] | None = None,
    ) -> None:
            """把对接池 contacts/notes/attachments 全量写穿到子表。

            调用方必须传入完整三集合；缺键 → ValidationError（禁止静默 refill / or []）。
            """
            from app.core.exceptions import ValidationError

            raw = getattr(coverage, "document", None)
            doc = dict(document) if isinstance(document, dict) else (
                dict(raw) if isinstance(raw, dict) else {}
            )
            missing = [
                key
                for key in ("contacts", "notes", "attachments")
                if key not in doc or not isinstance(doc.get(key), list)
            ]
            if missing:
                raise ValidationError(
                    f"对接池保存缺少集合字段 {', '.join(missing)}，须先 compose+merge"
                )
            contacts = list(doc.get("contacts") or [])
            notes = list(doc.get("notes") or [])
            await sync_attachments(
                self.db, "coverage", coverage.id, list(doc.get("attachments") or [])
            )
            await self.db.execute(delete(CrmContact).where(CrmContact.coverage_id == coverage.id))
            await self.db.execute(delete(CrmFollowUp).where(CrmFollowUp.coverage_id == coverage.id))
            now = _now()
            seen_contact_ids: set[str] = set()
            for index, contact in enumerate(contacts):
                if not isinstance(contact, dict):
                    continue
                raw_id = str(contact.get("id") or "").strip()
                contact_id = raw_id if raw_id and raw_id not in seen_contact_ids else new_id("ct")
                if contact_id in seen_contact_ids:
                    contact_id = new_id("ct")
                seen_contact_ids.add(contact_id)
                # 保留原 createdAt；否则按数组下标微秒错开，避免同秒写入后 ORDER BY created_at 乱序导致前端卡片跳动
                created_at = _doc_datetime(contact, "createdAt") or (
                    now.replace(microsecond=0) + timedelta(microseconds=index)
                )
                self.db.add(
                    CrmContact(
                        id=contact_id,
                        coverage_id=coverage.id,
                        customer_id=coverage.customer_id,
                        name=str(contact.get("name") or ""),
                        title=_doc_str(contact, "title"),
                        phone=_doc_str(contact, "phone"),
                        wechat=_doc_str(contact, "wechat"),
                        email=_doc_str(contact, "email"),
                        status=_doc_str(contact, "status") or "awaiting_contact",
                        is_primary=bool(contact.get("isPrimary")),
                        active=contact.get("active") is not False,
                        wechat_added=bool(contact.get("wechatAdded")),
                        source=_doc_str(contact, "source"),
                        source_detail=_doc_str(contact, "sourceDetail"),
                        source_lead_id=_doc_str(contact, "sourceLeadId"),
                        created_at=created_at,
                        updated_at=now,
                    )
                )
            for index, note in enumerate(notes):
                if not isinstance(note, dict):
                    continue
                self.db.add(
                    CrmFollowUp(
                        id=str(note.get("id") or new_id("fu")),
                        coverage_id=coverage.id,
                        customer_id=coverage.customer_id,
                        author=_doc_str(note, "author") or "",
                        content=_doc_str(note, "content") or "",
                        follow_type=_doc_str(note, "followType"),
                        contact_id=_doc_str(note, "contactId") or None,
                        contact_name=_doc_str(note, "contactName") or None,
                        wechat_added=bool(note.get("wechatAdded")),
                        mentions=(
                            json.dumps(note.get("mentions"), ensure_ascii=False)
                            if isinstance(note.get("mentions"), list)
                            else None
                        ),
                        next_follow_at=_doc_date(note, "nextFollowAt"),
                        origin=_doc_str(note, "origin"),
                        source_lead_id=_doc_str(note, "sourceLeadId"),
                        source_lead_note_id=_doc_str(note, "sourceLeadNoteId"),
                        # 跟进时间是统一时间线的业务排序键，必须保留时分秒；
                        # 无有效时间时按原数组位置错开，保证同批记录顺序稳定。
                        created_at=_doc_datetime(note, "date") or (
                            now.replace(microsecond=0) + timedelta(microseconds=index)
                        ),
                        updated_at=now,
                    )
                )

    async def customer_has_coverage_for_owners(
            self, customer_id: str, owner_ids: list[str] | None
        ) -> bool:
            if owner_ids is None:
                result = await self.db.execute(
                    select(CrmSalesCoverage.id).where(CrmSalesCoverage.customer_id == customer_id).limit(1)
                )
                return result.first() is not None
            if not owner_ids:
                return False
            result = await self.db.execute(
                select(CrmSalesCoverage.id)
                .where(
                    CrmSalesCoverage.customer_id == customer_id,
                    CrmSalesCoverage.owner_user_id.in_(owner_ids),
                )
                .limit(1)
            )
            return result.first() is not None

    async def list_coverages_for_customers(
            self,
            customer_ids: Sequence[str],
            *,
            owner_ids: list[str] | None,
        ) -> dict[str, list[CrmSalesCoverage]]:
            ids = [cid for cid in customer_ids if cid]
            if not ids:
                return {}
            stmt = select(CrmSalesCoverage).where(CrmSalesCoverage.customer_id.in_(ids))
            if owner_ids is not None:
                if not owner_ids:
                    return {cid: [] for cid in ids}
                stmt = stmt.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
            stmt = stmt.order_by(CrmSalesCoverage.updated_at.desc())
            rows = list((await self.db.execute(stmt)).scalars().all())
            out: dict[str, list[CrmSalesCoverage]] = {cid: [] for cid in ids}
            for row in rows:
                out.setdefault(row.customer_id, []).append(row)
            return out
