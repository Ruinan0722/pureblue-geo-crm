"""飞书「线索管理表」记录 → CRM Lead document 映射。"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.modules.contracts.status_catalog import (
    LEAD_LEVEL_META as _LEAD_LEVEL_CATALOG,
)
from app.modules.contracts.status_catalog import (
    LEAD_SOURCES as _LEAD_SOURCES_CATALOG,
)
from app.modules.contracts.status_catalog import (
    LEGACY_LEAD_SOURCE_MAP as _LEGACY_LEAD_SOURCE_CATALOG,
)
from app.modules.contracts.status_catalog import (
    REGIONS as _REGIONS_CATALOG,
)
from app.modules.crm.follow_up_notes import build_follow_up_notes

CHINA_TZ = timezone(timedelta(hours=8))

# 来源/等级/区域常量一律从唯一权威源 status_catalog.py 派生，禁止本地硬编码。
LEAD_SOURCES = frozenset(_LEAD_SOURCES_CATALOG)
SOURCE_ALIASES = dict(_LEGACY_LEAD_SOURCE_CATALOG)
LEVELS = frozenset(_LEAD_LEVEL_CATALOG.keys())
REGIONS = frozenset(_REGIONS_CATALOG)

# 飞书占位文本：URL 等字段视为空（如空官网被存成 "*用户未填写"）
EMPTY_TEXT_PLACEHOLDERS = {"*用户未填写", "无", "暂无", "-", "—", "/", "null", "none"}


def clean_website_value(value: Any) -> str:
    """官网字段清洗：飞书占位文本一律视为空。"""
    text = flatten_feishu_value(value) or ""
    low = text.strip().lower()
    if low in EMPTY_TEXT_PLACEHOLDERS or "未填写" in low or "暂无" in low:
        return ""
    return text.strip()


def flatten_feishu_value(value: Any) -> str | None:
    """把飞书 bitable 字段值压成可读字符串。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        if isinstance(value, int) and value > 1_000_000_000_000:
            try:
                return datetime.fromtimestamp(value / 1000, CHINA_TZ).strftime("%Y-%m-%d %H:%M:%S")
            except (OverflowError, OSError, ValueError):
                return str(value)
        return str(value)
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        if not value:
            return None
        parts: list[str] = []
        all_text = True
        for item in value:
            if isinstance(item, dict):
                if "text" in item:
                    parts.append(str(item.get("text") or ""))
                elif "name" in item:
                    all_text = False
                    parts.append(str(item.get("name") or ""))
                else:
                    all_text = False
                    parts.append(str(item))
            else:
                all_text = False
                parts.append(str(item))
        joined = "".join(parts) if all_text else " / ".join(p for p in parts if p)
        joined = joined.strip()
        return joined or None
    if isinstance(value, dict):
        if "link" in value:
            text = str(value.get("text") or value.get("link") or "").strip()
            return text or None
        if "name" in value:
            text = str(value.get("name") or "").strip()
            return text or None
        if "text" in value:
            text = str(value.get("text") or "").strip()
            return text or None
    return str(value).strip() or None


def to_date_iso(value: Any) -> str:
    """时间戳或字符串 → YYYY-MM-DD；无效则空串。"""
    raw = flatten_feishu_value(value)
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        return raw[:10]
    return ""


def map_source(landingpage: str | None, *, is_agent: bool) -> str:
    if is_agent:
        return "渠道伙伴"
    raw = (landingpage or "").strip()
    if not raw:
        return ""  # 飞书为空则置空，不默认成官网注册
    if raw in SOURCE_ALIASES:
        return SOURCE_ALIASES[raw]
    if raw in LEAD_SOURCES:
        return raw
    return raw  # 保留未知值，便于 dry-run 发现


def map_source_detail(landingpage: str | None, feishu_detail: str) -> str:
    """二级来源：优先飞书「来源二级」；为空时按外部入口默认（官网首页 / Mark / 36氪）。"""
    detail = (feishu_detail or "").strip()
    if detail:
        return detail
    raw = (landingpage or "").strip()
    if raw in ("Mark", "mark"):
        return "Mark"
    if raw in ("36Kr", "36kr", "36氪"):
        return "36氪"
    if raw in ("官网", "官网首页", "landing page", "Landing page", "Landing Page"):
        return "官网首页"
    return ""


def map_wechat_added(raw: str | None) -> bool | None:
    if not raw:
        return None
    text = raw.strip()
    if text in {"是"}:
        return True
    if text in {"否", "不加"}:
        return False
    return None


def feishu_lead_id(record_id: str) -> str:
    rid = (record_id or "").strip()
    lead_id = f"l-fs-{rid}"
    if len(lead_id) > 36:
        # varchar(36)：极端情况下截断 record_id
        lead_id = lead_id[:36]
    return lead_id


def map_feishu_record(
    record: dict[str, Any],
    *,
    imported_at: str | None = None,
) -> dict[str, Any] | None:
    """单条飞书记录 → Lead document；无公司名则返回 None。"""
    fields = record.get("fields") or {}
    record_id = str(record.get("record_id") or "").strip()
    if not record_id:
        return None

    brand = flatten_feishu_value(fields.get("品牌名称/公司名称"))
    company = flatten_feishu_value(fields.get("公司名称"))
    company_name = (company or brand or "").strip()
    if not company_name:
        return None

    brand_name = ""
    if brand and company and brand.strip() != company.strip():
        brand_name = brand.strip()
    elif brand and not company:
        brand_name = brand.strip() if brand.strip() != company_name else ""

    contact = flatten_feishu_value(fields.get("联系人"))
    customer_name = flatten_feishu_value(fields.get("客户姓名"))
    contact_name = (contact or customer_name or "").strip()

    level_raw = flatten_feishu_value(fields.get("线索等级"))
    is_agent = level_raw == "代理"
    is_overseas_level = level_raw == "海外"

    region = flatten_feishu_value(fields.get("区域")) or ""
    if region and region not in REGIONS:
        region = ""
    if is_overseas_level and not region:
        region = "海外"

    if level_raw in LEVELS:
        level = level_raw
    else:
        level = "B"

    follow_raw = flatten_feishu_value(fields.get("跟进状态"))
    if follow_raw == "无需跟进":
        follow_state = "no_need"
    elif follow_raw == "需要跟进":
        follow_state = "need"
    else:
        follow_state = "need"

    landingpage = flatten_feishu_value(fields.get("landingpage"))
    source = map_source(landingpage, is_agent=is_agent)

    first_contact = to_date_iso(fields.get("首次触达时间"))
    created_at = to_date_iso(fields.get("录入日期"))
    transfer_date = to_date_iso(fields.get("转出日期"))
    note_content = flatten_feishu_value(fields.get("跟进记录")) or ""
    interest = flatten_feishu_value(fields.get("你希望了解的重点方向"))
    if interest:
        note_content = f"{note_content}\n【重点方向】{interest}".strip()

    wechat_added = map_wechat_added(flatten_feishu_value(fields.get("是否加企微")))

    # 代理/海外保留飞书等级，不因等级合并为无效线索
    if first_contact or note_content or transfer_date:
        status = "touched"
        invalid_reason = None
    else:
        status = "untouched"
        invalid_reason = None

    sdr = flatten_feishu_value(fields.get("SDR")) or ""
    sales = flatten_feishu_value(fields.get("销售")) or ""
    created_by = flatten_feishu_value(fields.get("创建人")) or ""
    note_author = sdr or created_by
    note_date = first_contact or created_at or (imported_at or "")[:10]

    notes: list[dict[str, Any]] = []
    if note_content:
        notes = build_follow_up_notes(
            note_content,
            author=note_author,
            fallback_date=note_date,
            id_prefix=f"ln-fs-{record_id}"[:20],
        )
        if wechat_added is not None and notes:
            notes[0] = {**notes[0], "wechatAdded": wechat_added}

    imported = imported_at or datetime.now(CHINA_TZ).strftime("%Y-%m-%d %H:%M:%S")
    import_meta: dict[str, Any] = {
        "feishuRecordId": record_id,
        "importedAt": imported,
    }
    feishu_no = flatten_feishu_value(fields.get("id"))
    if feishu_no:
        import_meta["feishuLeadNo"] = feishu_no
    if landingpage:
        import_meta["landingpageRaw"] = landingpage
    utm = flatten_feishu_value(fields.get("utm_source"))
    if utm:
        import_meta["utmSource"] = utm
    if created_by:
        import_meta["createdByName"] = created_by

    doc: dict[str, Any] = {
        "id": feishu_lead_id(record_id),
        "createdAt": created_at,
        "firstContactDate": first_contact,
        "transferDate": transfer_date,
        "source": source,
        "sourceDetail": map_source_detail(landingpage, flatten_feishu_value(fields.get("来源二级"))),
        "companyName": company_name,
        "brandName": brand_name,
        "website": clean_website_value(fields.get("官网")),
        "city": flatten_feishu_value(fields.get("城市")) or "",
        "region": region,
        "contactName": contact_name,
        "contactTitle": flatten_feishu_value(fields.get("职务")) or "",
        "contactDepartment": flatten_feishu_value(fields.get("部门")) or "",
        "contactPhone": flatten_feishu_value(fields.get("电话")) or "",
        "email": flatten_feishu_value(fields.get("企业邮箱")) or "",
        "sdr": sdr,
        "sales": sales,
        "level": level,
        "followState": follow_state,
        "status": status,
        "notes": notes,
        "attachments": [],
        "importMeta": import_meta,
    }
    if invalid_reason:
        doc["invalidReason"] = invalid_reason
    if wechat_added is not None:
        doc["wechatAdded"] = wechat_added
    return doc


def build_dry_run_report(documents: list[dict[str, Any]], *, skipped: int) -> dict[str, Any]:
    by_status = Counter(str(d.get("status") or "") for d in documents)
    by_source = Counter(str(d.get("source") or "") for d in documents)
    by_level = Counter(str(d.get("level") or "") for d in documents)
    by_follow = Counter(str(d.get("followState") or "") for d in documents)
    unknown_sources = sorted(
        src for src in by_source if src and src not in LEAD_SOURCES
    )
    phone_dupes: Counter[str] = Counter()
    for d in documents:
        phone = str(d.get("contactPhone") or "").strip()
        if phone:
            phone_dupes[phone] += 1
    duplicate_phones = {p: c for p, c in phone_dupes.items() if c > 1}
    samples = documents[:5]
    return {
        "mapped": len(documents),
        "skipped_empty_company": skipped,
        "by_status": dict(by_status),
        "by_source": dict(by_source.most_common()),
        "by_level": dict(by_level),
        "by_follow_state": dict(by_follow),
        "unknown_sources": unknown_sources,
        "duplicate_phone_count": len(duplicate_phones),
        "duplicate_phones_sample": dict(list(duplicate_phones.items())[:10]),
        "samples": samples,
    }


def map_feishu_dump(
    dump: dict[str, Any],
    *,
    imported_at: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records = dump.get("records") or []
    documents: list[dict[str, Any]] = []
    skipped = 0
    for record in records:
        if not isinstance(record, dict):
            skipped += 1
            continue
        doc = map_feishu_record(record, imported_at=imported_at)
        if doc is None:
            skipped += 1
            continue
        documents.append(doc)
    report = build_dry_run_report(documents, skipped=skipped)
    return documents, report
