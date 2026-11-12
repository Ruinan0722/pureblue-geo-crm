from __future__ import annotations

import json

from sqlalchemy import text

from app.models.crm import ContractOwner, CrmAttachment, CrmPaymentPlan
from app.modules.crm.repository.base import (
    Any,
    CrmContract,
    Sequence,
    _doc_date,
    _doc_decimal,
    _doc_str,
    _format_dt,
    _now,
    delete,
    func,
    new_id,
    select,
    sync_attachments,
)


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


class ContractsRepositoryMixin:
    async def list_payment_plans(self, contract_ids: Sequence[str]) -> list[CrmPaymentPlan]:
        ids = [str(value) for value in contract_ids if str(value)]
        if not ids:
            return []
        result = await self.db.execute(
            select(CrmPaymentPlan)
            .where(CrmPaymentPlan.contract_id.in_(ids))
            .order_by(CrmPaymentPlan.planned_date, CrmPaymentPlan.period_index)
        )
        return list(result.scalars().all())

    async def get_payment_plan(self, payment_plan_id: str) -> CrmPaymentPlan | None:
        result = await self.db.execute(
            select(CrmPaymentPlan).where(CrmPaymentPlan.id == payment_plan_id).limit(1)
        )
        return result.scalar_one_or_none()

    async def create_payment_plan(
        self,
        *,
        contract_id: str,
        document: dict[str, Any],
        actor_user_id: str | None,
        actor_name: str,
    ) -> CrmPaymentPlan:
        now = _now()
        row = CrmPaymentPlan(
            id=new_id("pay-"),
            contract_id=contract_id,
            period_index=int(document.get("periodIndex") or 1),
            period_name=str(document.get("periodName") or "").strip(),
            planned_amount=float(document.get("plannedAmount") or 0),
            planned_date=_doc_date(document, "plannedDate"),
            invoice_status=str(document.get("invoiceStatus") or "uninvoiced"),
            invoice_date=_doc_date(document, "invoiceDate"),
            invoice_amount=_doc_decimal(document, "invoiceAmount"),
            invoice_attachment=json.dumps(document.get("invoiceAttachment"), ensure_ascii=False) if document.get("invoiceAttachment") else None,
            actual_payment_date=_doc_date(document, "actualPaymentDate"),
            actual_amount=float(document.get("actualAmount") or 0),
            receipt_attachment=json.dumps(document.get("receiptAttachment"), ensure_ascii=False) if document.get("receiptAttachment") else None,
            created_by_user_id=actor_user_id,
            created_by=actor_name,
            updated_by=actor_name,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def save_payment_plan(
        self, row: CrmPaymentPlan, document: dict[str, Any], *, actor_name: str
    ) -> CrmPaymentPlan:
        mapping = {
            "periodIndex": "period_index",
            "periodName": "period_name",
            "invoiceStatus": "invoice_status",
        }
        for key, column in mapping.items():
            if key in document:
                value = document[key]
                setattr(row, column, int(value) if key == "periodIndex" else str(value or "").strip())
        for key, column in (("plannedAmount", "planned_amount"), ("invoiceAmount", "invoice_amount"), ("actualAmount", "actual_amount")):
            if key in document:
                value = document[key]
                setattr(row, column, None if value is None and key == "invoiceAmount" else float(value or 0))
        for key, column in (("plannedDate", "planned_date"), ("invoiceDate", "invoice_date"), ("actualPaymentDate", "actual_payment_date")):
            if key in document:
                setattr(row, column, _doc_date(document, key))
        for key, column in (("invoiceAttachment", "invoice_attachment"), ("receiptAttachment", "receipt_attachment")):
            if key in document:
                value = document[key]
                setattr(row, column, json.dumps(value, ensure_ascii=False) if value else None)
        row.updated_by = actor_name
        row.updated_at = _now()
        await self.db.flush()
        return row

    async def delete_payment_plan(self, row: CrmPaymentPlan) -> None:
        await self.db.delete(row)
        await self.db.flush()

    async def find_contract_by_opportunity(self, opportunity_id: str) -> CrmContract | None:
            result = await self.db.execute(
                select(CrmContract).where(CrmContract.opportunity_id == opportunity_id).limit(1)
            )
            return result.scalar_one_or_none()

    async def list_contract_owners(
        self, contract_ids: Sequence[str]
    ) -> dict[str, list[str]]:
        ids = [str(x) for x in contract_ids if str(x)]
        out: dict[str, list[str]] = {cid: [] for cid in ids}
        if not ids:
            return out
        rows = (
            await self.db.execute(
                select(ContractOwner)
                .where(ContractOwner.contract_id.in_(ids))
                .order_by(ContractOwner.contract_id, ContractOwner.sort_order)
            )
        ).scalars().all()
        for item in rows:
            out.setdefault(item.contract_id, []).append(item.owner_name)
        return out

    async def list_contract_attachments(
        self, contract_ids: Sequence[str]
    ) -> dict[str, list[dict[str, Any]]]:
        ids = [str(x) for x in contract_ids if str(x)]
        out: dict[str, list[dict[str, Any]]] = {cid: [] for cid in ids}
        if not ids:
            return out
        rows = (
            await self.db.execute(
                select(CrmAttachment).where(
                    CrmAttachment.entity_type == "contract",
                    CrmAttachment.entity_id.in_(ids),
                )
            )
        ).scalars().all()
        for item in rows:
            out.setdefault(item.entity_id, []).append(_attachment_doc(item))
        return out

    async def get_contract_attachments(self, contract_id: str) -> list[dict[str, Any]]:
        return (await self.list_contract_attachments([contract_id])).get(contract_id, [])

    async def _sync_contract_owners(
        self, contract_id: str, document: dict[str, Any]
    ) -> None:
        owners_raw = document.get("owners")
        if not isinstance(owners_raw, list):
            owners_raw = []
        if not owners_raw:
            owner = str(document.get("owner") or "").strip()
            owners_raw = [owner] if owner else []
        await self.db.execute(delete(ContractOwner).where(ContractOwner.contract_id == contract_id))
        for index, name in enumerate(owners_raw):
            name = str(name or "").strip()
            if not name:
                continue
            self.db.add(
                ContractOwner(
                    id=f"{contract_id}-ow-{index}",
                    contract_id=contract_id,
                    owner_name=name,
                    sort_order=index,
                )
            )

    async def list_contracts(
        self, owner_ids: list[str] | None, *, include_unassigned: bool = False
    ) -> Sequence[CrmContract]:
            return await self._list_by_owners(
                CrmContract, owner_ids, include_unassigned=include_unassigned
            )

    async def count_contracts_by_customer_ids(
            self,
            customer_ids: Sequence[str],
            *,
            owner_ids: list[str] | None = None,
        ) -> dict[str, int]:
            """按客户 ID 批量统计合同数（列表页用；可按对接池可见 owner 过滤）。"""
            ids = [cid for cid in customer_ids if cid]
            if not ids:
                return {}
            if owner_ids is not None and not owner_ids:
                return {cid: 0 for cid in ids}
            stmt = (
                select(CrmContract.customer_id, func.count())
                .where(CrmContract.customer_id.in_(ids))
                .group_by(CrmContract.customer_id)
            )
            if owner_ids is not None:
                stmt = stmt.where(CrmContract.owner_user_id.in_(owner_ids))
            rows = (await self.db.execute(stmt)).all()
            return {str(customer_id): int(count or 0) for customer_id, count in rows}

    async def get_contract(self, contract_id: str) -> CrmContract | None:
            return await self.db.get(CrmContract, contract_id)

    async def next_contract_code(self) -> str:
            """Allocate the next PBA code; caller transaction provides rollback semantics."""
            await self.db.execute(
                text(
                    "SELECT current_value FROM crm_number_sequences "
                    "WHERE name = 'contract_pba' FOR UPDATE"
                )
            )
            await self.db.execute(
                text(
                    "UPDATE crm_number_sequences SET current_value = current_value + 1 "
                    "WHERE name = 'contract_pba'"
                )
            )
            value = (
                await self.db.execute(
                    text(
                        "SELECT current_value FROM crm_number_sequences "
                        "WHERE name = 'contract_pba'"
                    )
                )
            ).scalar_one()
            return f"PBA{int(value):05d}"

    async def list_contracts_by_ids(self, contract_ids: Sequence[str]) -> Sequence[CrmContract]:
            ids = [cid for cid in contract_ids if cid]
            if not ids:
                return []
            result = await self.db.execute(select(CrmContract).where(CrmContract.id.in_(ids)))
            return list(result.scalars().all())

    async def create_contract(
            self,
            *,
            document: dict[str, Any],
            owner_user_id: str | None,
        ) -> CrmContract:
            contract_id = str(document.get("id") or new_id("ct-"))
            document = {**document, "id": contract_id}
            now = _now()
            row = CrmContract(
                id=contract_id,
                owner_user_id=owner_user_id,
                customer_id=str(document.get("customerId") or ""),
                status=str(document.get("status") or "pending"),
                amount=_doc_decimal(document, "amount"),
                project_status=_doc_str(document, "projectStatus"),
                type=_doc_str(document, "type"),
                sign_type=_doc_str(document, "signType"),
                source=_doc_str(document, "source"),
                status_reason=_doc_str(document, "statusReason"),
                code=_doc_str(document, "code"),
                name=_doc_str(document, "name"),
                company=_doc_str(document, "company"),
                region=_doc_str(document, "region"),
                city=_doc_str(document, "city"),
                geo_source=_doc_str(document, "geoSource"),
                signer=_doc_str(document, "signer"),
                sign_subject=_doc_str(document, "signSubject"),
                our_sign_subject=_doc_str(document, "ourSignSubject"),
                customer_sign_subject=_doc_str(document, "customerSignSubject"),
                signer_manager=_doc_str(document, "signerManager"),
                dept=_doc_str(document, "dept"),
                valid_months=(
                    None
                    if document.get("validMonths") is None
                    else int(document.get("validMonths"))
                ),
                effective_date=_doc_date(document, "effectiveDate"),
                dual_sign_date=_doc_date(document, "dualSignDate"),
                end_date=_doc_date(document, "endDate"),
                opportunity_id=_doc_str(document, "opportunityId"),
                owner=_doc_str(document, "owner"),
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
            from app.core.exceptions import ValidationError

            if "attachments" not in document or not isinstance(document.get("attachments"), list):
                raise ValidationError("合同保存缺少集合字段 attachments，须先 compose+merge")
            if "owners" not in document or not isinstance(document.get("owners"), list):
                raise ValidationError("合同保存缺少集合字段 owners，须先 compose+merge")
            await sync_attachments(
                self.db, "contract", row.id, list(document.get("attachments") or [])
            )
            await self._sync_contract_owners(row.id, document)
            return row

    async def save_contract(self, row: CrmContract, document: dict[str, Any]) -> CrmContract:
            document = {**document, "id": row.id}
            row.customer_id = str(document.get("customerId") or row.customer_id)
            row.status = str(document.get("status") or row.status)
            row.amount = _doc_decimal(document, "amount")
            row.project_status = _doc_str(document, "projectStatus")
            row.type = _doc_str(document, "type")
            row.sign_type = _doc_str(document, "signType")
            row.source = _doc_str(document, "source")
            row.status_reason = _doc_str(document, "statusReason")
            row.code = _doc_str(document, "code")
            row.name = _doc_str(document, "name")
            row.company = _doc_str(document, "company")
            row.region = _doc_str(document, "region")
            row.city = _doc_str(document, "city")
            row.geo_source = _doc_str(document, "geoSource")
            row.signer = _doc_str(document, "signer")
            row.sign_subject = _doc_str(document, "signSubject")
            row.our_sign_subject = _doc_str(document, "ourSignSubject")
            row.customer_sign_subject = _doc_str(document, "customerSignSubject")
            row.signer_manager = _doc_str(document, "signerManager")
            row.dept = _doc_str(document, "dept")
            if document.get("validMonths") is not None:
                row.valid_months = int(document.get("validMonths"))
            row.effective_date = _doc_date(document, "effectiveDate")
            row.dual_sign_date = _doc_date(document, "dualSignDate")
            row.end_date = _doc_date(document, "endDate")
            row.opportunity_id = _doc_str(document, "opportunityId")
            row.owner = _doc_str(document, "owner")
            row.project_manager_request_json = (
                json.dumps(document.get("projectManagerRequest"), ensure_ascii=False)
                if isinstance(document.get("projectManagerRequest"), dict)
                else None
            )
            row.created_day = _doc_date(document, "createdAt")
            row.updated_at = _now()
            await self.db.flush()
            from app.core.exceptions import ValidationError

            if "attachments" not in document or not isinstance(document.get("attachments"), list):
                raise ValidationError("合同保存缺少集合字段 attachments，须先 compose+merge")
            if "owners" not in document or not isinstance(document.get("owners"), list):
                raise ValidationError("合同保存缺少集合字段 owners，须先 compose+merge")
            await sync_attachments(
                self.db, "contract", row.id, list(document.get("attachments") or [])
            )
            await self._sync_contract_owners(row.id, document)
            return row
