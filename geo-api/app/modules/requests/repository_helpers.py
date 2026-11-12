from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.core.time_utils import format_legacy_time
from app.models import Request
from app.modules.requests.schemas import NoteItem, RequestAttachmentItem, RequestRecord

DUPLICATE_WINDOW_MS = 60_000

# 内部列表默认可见状态（与前端 VISIBLE_STATUSES 对齐）
LIST_VISIBLE_STATUSES: tuple[str, ...] = ("submitted", "pending_review", "confirmed", "in_project")

EMPTY_REQUEST_STATS: dict[str, int] = {
    "total": 0,
    "submitted": 0,
    "pending": 0,
    "confirmed": 0,
    "in_project": 0,
    "supplement": 0,
}

_LIST_KIND_KEYS = {
    "platforms": "platforms",
    "brand_aliases": "brandAliases",
    "brand_competitors": "brandCompetitors",
    "feishu_links": "feishuLinks",
}


def _form_str(data: dict[str, Any] | None, key: str) -> str | None:
    """表单 data 内字符串字段（空 → None）。"""
    if not isinstance(data, dict):
        return None
    value = str(data.get(key) or "").strip()
    return value or None


def _parse_dt(value: Any) -> datetime | None:
    """需求跟进 createdAt 字符串 → datetime（容错）。"""
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def _form_date(data: dict[str, Any] | None, key: str):
    """表单 data 内日期字段（YYYY-MM-DD / YYYY/MM/DD）→ date。"""
    text = _form_str(data, key)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


def _form_column_values(data: dict[str, Any] | None) -> dict[str, Any]:
    """表单 data 标量字段 → requests 新列值（空值归一 NULL）。"""
    data = data if isinstance(data, dict) else {}
    out: dict[str, Any] = {}
    for column, key in (
        ("scope_type", "scopeType"),
        ("has_overseas_site", "hasOverseasSite"),
        ("overseas_site_url", "overseasSiteUrl"),
        ("target_customer", "targetCustomer"),
        ("optimize_background", "optimizeBackground"),
        ("intent_type", "intentType"),
        ("intent_rough", "intentRough"),
        ("optimize_period", "optimizePeriod"),
        ("optimize_period_custom", "optimizePeriodCustom"),
        ("strength_market", "strengthMarket"),
        ("strength_tech", "strengthTech"),
        ("strength_brand", "strengthBrand"),
        ("strength_ecosystem", "strengthEcosystem"),
        ("strength_other", "strengthOther"),
        ("contact_name", "contactName"),
        ("contact_phone", "contactPhone"),
        ("contact_title", "contactTitle"),
        ("budget", "budget"),
        ("period", "period"),
        ("website", "website"),
        ("competitors", "competitors"),
        ("customer_no", "customerNo"),
        ("feishu_code", "feishuCode"),
        ("project_stage", "projectStage"),
        ("city", "city"),
        ("industry", "industry"),
        ("budget_range", "budgetRange"),
    ):
        out[column] = _form_str(data, key)
    out["expected_start_date"] = _form_date(data, "expectedStartDate")
    out["expected_start"] = _form_date(data, "expectedStart")
    return out


def derive_geo_source(code: str, data: dict[str, Any] | None) -> str:
    """按 importMeta.source / 编号前缀派生 GEO 归属（与 geo_scope.resolve_request_geo_source 一致）。"""
    source = ""
    if isinstance(data, dict):
        meta = data.get("importMeta")
        if isinstance(meta, dict):
            source = str(meta.get("source") or "").strip()
    code = (code or "").upper()
    if source == "国内GEO需求" or code.startswith("GEO-CN"):
        return "domestic"
    if source == "海外GEO需求" or code.startswith("GEO-OV"):
        return "overseas"
    if source == "麦思博GEO需求" or code.startswith("GEO-MS"):
        return "mestbo"
    return "manual"


def _dt_to_str(value: datetime | str | None) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        return value
    return format_legacy_time(value)


def _empty_request_children() -> dict[str, Any]:
    return {
        "regions": [],
        "goals": [],
        "products": [],
        "intentQuestions": [],
        "intentRoughItems": [],
        "platforms": [],
        "brandAliases": [],
        "brandCompetitors": [],
        "feishuLinks": [],
        "importMeta": None,
        "notes": [],
        "attachments": [],
    }


def _assemble_request_data(row: Request, children: dict[str, Any]) -> dict[str, Any]:
    """从列 + 子表组装 data（前端 data 契约保持）。"""
    data: dict[str, Any] = {}
    for column, key in (
        ("company_name", "companyName"),
        ("brand_name", "brandName"),
        ("goal", "goal"),
        ("scope_type", "scopeType"),
        ("has_overseas_site", "hasOverseasSite"),
        ("overseas_site_url", "overseasSiteUrl"),
        ("target_customer", "targetCustomer"),
        ("optimize_background", "optimizeBackground"),
        ("intent_type", "intentType"),
        ("intent_rough", "intentRough"),
        ("optimize_period", "optimizePeriod"),
        ("optimize_period_custom", "optimizePeriodCustom"),
        ("strength_market", "strengthMarket"),
        ("strength_tech", "strengthTech"),
        ("strength_brand", "strengthBrand"),
        ("strength_ecosystem", "strengthEcosystem"),
        ("strength_other", "strengthOther"),
        ("contact_name", "contactName"),
        ("contact_phone", "contactPhone"),
        ("contact_title", "contactTitle"),
        ("budget", "budget"),
        ("period", "period"),
        ("website", "website"),
        ("competitors", "competitors"),
        ("customer_no", "customerNo"),
        ("feishu_code", "feishuCode"),
        ("project_stage", "projectStage"),
        ("city", "city"),
        ("industry", "industry"),
        ("budget_range", "budgetRange"),
    ):
        value = getattr(row, column, None)
        data[key] = value if value is not None else ""
    for column, key in (("expected_start_date", "expectedStartDate"), ("expected_start", "expectedStart")):
        value = getattr(row, column, None)
        data[key] = value.strftime("%Y-%m-%d") if value is not None else ""
    if children.get("importMeta") is not None:
        data["importMeta"] = children["importMeta"]
    for key in (
        "regions",
        "goals",
        "products",
        "intentQuestions",
        "intentRoughItems",
        "platforms",
        "brandAliases",
        "brandCompetitors",
        "feishuLinks",
    ):
        data[key] = children.get(key) or []
    return data


def _row_to_record(
    row: Request, children: dict[str, Any] | None = None
) -> RequestRecord:
    if children is not None:
        data = _assemble_request_data(row, children)
        notes_raw = children.get("notes") or []
        attachments_raw = children.get("attachments") or []
    else:
        data = getattr(row, "data", None)
        data = data if isinstance(data, dict) else {}
        notes_raw = getattr(row, "notes", None)
        notes_raw = notes_raw if isinstance(notes_raw, list) else json.loads(notes_raw or "[]")
        attachments_raw = getattr(row, "attachments", None)
        attachments_raw = (
            attachments_raw
            if isinstance(attachments_raw, list)
            else json.loads(attachments_raw or "[]")
        )
    notes: list[NoteItem] = []
    for n in notes_raw:
        if not isinstance(n, dict):
            continue
        try:
            notes.append(NoteItem.model_validate(n))
        except Exception:  # noqa: BLE001, S112  单条脏数据跳过，不影响整单序列化
                continue
    attachments: list[RequestAttachmentItem] = []
    for item in attachments_raw:
        if not isinstance(item, dict):
            continue
        try:
            attachments.append(RequestAttachmentItem.model_validate(item))
        except Exception:  # noqa: BLE001, S112  单条脏数据跳过，不影响整单序列化
                continue
    return RequestRecord(
        id=row.id,
        code=row.code,
        status=row.status,  # type: ignore[arg-type]
        submitted_at=_dt_to_str(row.submitted_at),
        updated_at=_dt_to_str(row.updated_at),
        owner=row.owner,
        staff_user_id=row.staff_user_id,
        invite_id=row.invite_id,
        opportunity_id=None,
        data=data,
        notes=notes,
        attachments=attachments,
    )
