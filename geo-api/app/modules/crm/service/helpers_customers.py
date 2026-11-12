from __future__ import annotations

from typing import Any

from app.modules.crm.service.base import (
    _MATCH_TYPE_RANK,
    CUSTOMER_POOL_FIELDS,
    CUSTOMER_RESPONSE_META_FIELDS,
)
from app.modules.crm.service.helpers_common import _doc


def _strip_customer_master_document(document: dict[str, Any]) -> dict[str, Any]:
    """公司主档：去掉对接池经营字段与 API 响应元数据。"""
    out: dict[str, Any] = {}
    for key, value in (document or {}).items():
        if key in CUSTOMER_POOL_FIELDS or key in CUSTOMER_RESPONSE_META_FIELDS:
            continue
        out[key] = value
    # 主档不再承载经营状态 / 负责人展示名
    out.pop("status", None)
    out.pop("owner", None)
    return out


def _customer_master_columns(row, master: dict[str, Any]) -> dict[str, Any]:
    """客户主档已列化字段以列为权威源（前端契约保持，值空不覆盖 document）。"""
    for column, key in (
        ("company_uid", "companyUid"),
        ("website", "website"),
        ("city", "city"),
        ("industry_l2", "industryL2"),
        ("founded_date", "foundedDate"),
        ("registered_capital", "registeredCapital"),
        ("annual_revenue", "annualRevenue"),
        ("scale", "scale"),
        ("nature", "nature"),
        ("sdr_user_id", "sdrUserId"),
        ("sdr_transfer_date", "sdrTransferDate"),
        ("source", "source"),
        ("source_detail", "sourceDetail"),
        ("migration_status", "migrationStatus"),
        ("source_lead_id", "sourceLeadId"),
        ("sdr", "sdr"),
        ("isolation_version", "isolationVersion"),
    ):
        value = getattr(row, column, None)
        if value is None:
            continue
        if column == "isolation_version":
            master[key] = int(value)
            continue
        if column in ("founded_date", "sdr_transfer_date"):
            master[key] = value.strftime("%Y-%m-%d")
        elif column in ("registered_capital", "annual_revenue"):
            master[key] = float(value)
        else:
            master[key] = value
    created_day = getattr(row, "created_day", None)
    if created_day is not None:
        master["createdAt"] = created_day.strftime("%Y-%m-%d")
    return master

def _extract_pool_fields(document: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in CUSTOMER_POOL_FIELDS:
        if key in document:
            out[key] = document[key]
    return out


def _coverage_doc_with_children(
    doc: dict[str, Any], children: dict[str, Any] | None
) -> dict[str, Any]:
    """把对接池子表（联系人/跟进/附件/importMeta）合并进 document，避免删 JSON 列后丢失。"""
    merged = dict(doc)
    for key in ("contacts", "notes", "attachments"):
        value = (children or {}).get(key)
        if value is not None:
            merged[key] = value
    if children and "importMeta" in children:
        merged["importMeta"] = children.get("importMeta")
    return merged

def _pool_fields_have_operating_content(pool_fields: dict[str, Any]) -> bool:
    """判断前端整包 PATCH 里的池字段是否真有经营写入（排除空数组/空串行李）。"""
    if not pool_fields:
        return False
    contacts = pool_fields.get("contacts")
    if isinstance(contacts, list):
        for c in contacts:
            if isinstance(c, dict) and str(c.get("name") or "").strip():
                return True
    notes = pool_fields.get("notes")
    if isinstance(notes, list):
        for n in notes:
            if isinstance(n, dict) and str(n.get("content") or "").strip():
                return True
    attachments = pool_fields.get("attachments")
    if isinstance(attachments, list):
        for a in attachments:
            if isinstance(a, dict) and str(a.get("id") or a.get("name") or "").strip():
                return True
    if str(pool_fields.get("status") or "").strip():
        return True
    if str(pool_fields.get("lastFollowAt") or "").strip():
        return True
    if str(pool_fields.get("nextFollowAt") or "").strip():
        return True
    if str(pool_fields.get("clientDept") or "").strip():
        return True
    return pool_fields.get("isKey") is True

def _customer_update_write_codes(payload: dict[str, Any]) -> set[str]:
    """根据客户/对接池 PATCH 载荷推断所需细粒度写权限（空数组/空串行李不触发）。"""
    codes: set[str] = set()
    master_in = {
        k: v
        for k, v in payload.items()
        if k not in CUSTOMER_POOL_FIELDS
        and k not in CUSTOMER_RESPONSE_META_FIELDS
        and k not in ("id", "ownerName")
    }
    if master_in:
        codes.add("customers:master_edit")
    if (
        str(payload.get("status") or "").strip()
        or str(payload.get("owner") or "").strip()
        or str(payload.get("ownerName") or "").strip()
        or payload.get("isKey") is True
    ):
        codes.add("customers:status_change")
    contacts = payload.get("contacts")
    if isinstance(contacts, list) and contacts:
        codes.add("customers:contact_edit")
    notes = payload.get("notes")
    if isinstance(notes, list) and notes:
        codes.add("customers:follow_add")
    attachments = payload.get("attachments")
    if isinstance(attachments, list) and attachments:
        codes.add("customers:attachment_upload")
    if (
        str(payload.get("nextFollowAt") or "").strip()
        or str(payload.get("lastFollowAt") or "").strip()
        or str(payload.get("clientDept") or "").strip()
    ):
        codes.add("customers:follow_add")
    return codes

def _coverage_public_doc(row, *, can_edit: bool) -> dict[str, Any]:
    doc = _doc(row)
    return {
        "id": row.id,
        "customerId": row.customer_id,
        "ownerUserId": row.owner_user_id,
        "ownerName": str(doc.get("ownerName") or doc.get("owner") or ""),
        "status": row.status,
        "clientDept": str(getattr(row, "client_dept", None) or doc.get("clientDept") or ""),
        "contacts": doc.get("contacts") if isinstance(doc.get("contacts"), list) else [],
        "notes": doc.get("notes") if isinstance(doc.get("notes"), list) else [],
        "attachments": doc.get("attachments") if isinstance(doc.get("attachments"), list) else [],
        "lastFollowAt": str(doc.get("lastFollowAt") or ""),
        "nextFollowAt": str(doc.get("nextFollowAt") or ""),
        "isKey": bool(doc.get("isKey") or False),
        "sourceLeadId": str(getattr(row, "source_lead_id", None) or doc.get("sourceLeadId") or ""),
        "sdrName": str(getattr(row, "sdr_name", None) or doc.get("sdrName") or doc.get("sdr") or ""),
        "sdrTransferDate": str(
            getattr(row, "sdr_transfer_date", None) or doc.get("sdrTransferDate") or ""
        ),
        "canEdit": can_edit,
        "isolationVersion": int(
            getattr(row, "isolation_version", None) or doc.get("isolationVersion") or 1
        ),
    }

def _customer_match_summary(row, *, match_type: str = "exact") -> dict[str, Any]:
    doc = _doc(row)
    return {
        "id": row.id,
        "companyName": doc.get("companyName") or row.company_name or "",
        "brandName": doc.get("brandName") or "",
        "owner": doc.get("owner") or "",
        "region": doc.get("region") or "",
        "city": doc.get("city") or "",
        "creditCode": doc.get("creditCode") or "",
        "status": doc.get("status") or row.status or "",
        "matchType": match_type,
    }

def _sort_match_items(items: list[dict[str, Any]], credit_code: str = "") -> list[dict[str, Any]]:
    upper = (credit_code or "").strip().upper()

    def sort_key(x: dict[str, Any]) -> tuple[int, int]:
        mt = str(x.get("matchType") or "exact")
        credit_hit = 0 if upper and str(x.get("creditCode") or "").upper() == upper else 1
        return (_MATCH_TYPE_RANK.get(mt, 9), credit_hit)

    return sorted(items, key=sort_key)
