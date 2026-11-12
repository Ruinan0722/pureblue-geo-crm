from __future__ import annotations

from datetime import date, datetime
from typing import Any

from app.modules.crm.service.base import (
    CHINA_TZ,
)


def _china_today_iso() -> str:
    return datetime.now(CHINA_TZ).date().isoformat()

def _created_at_iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    return text[:10] if text else ""

def _doc(row) -> dict[str, Any]:
    """返回业务 document。

    JSON 列存在时直接返回 document/data；删列后按列重建标量（驼峰、日期格式化），
    数组字段由各调用方显式加载子表再合并。
    """
    raw = getattr(row, "document", None)
    if not isinstance(raw, dict):
        raw = getattr(row, "data", None)
    if isinstance(raw, dict):
        doc = dict(raw)
    else:
        doc = _row_to_column_doc(row)
    if not str(doc.get("createdAt") or "").strip():
        created = _created_at_iso(getattr(row, "created_at", None))
        if created:
            doc["createdAt"] = created
    return doc


_DOC_SKIP_COLUMNS = frozenset(
    {
        "owner_user_id",
        "created_at",
        "updated_at",
        "document",
        "data",
        "notes",
        "attachments",
        "changes",
        "related_entity_ids",
        "mentions",
        "attachment_ids",
        "department_names",
    }
)


def _row_to_column_doc(row) -> dict[str, Any]:
    """从 ORM 标量列重建业务 document（驼峰键）。"""
    out: dict[str, Any] = {}
    table = getattr(row, "__table__", None)
    if table is None:
        return out
    for column in table.columns:
        name = column.key
        if name in _DOC_SKIP_COLUMNS or name in ("id",):
            continue
        value = getattr(row, name, None)
        if value is None:
            continue
        key = _column_to_camel(name)
        if isinstance(value, datetime):
            if value.hour == 0 and value.minute == 0 and value.second == 0:
                out[key] = value.strftime("%Y-%m-%d")
            else:
                out[key] = value.strftime("%Y-%m-%d %H:%M:%S")
        elif isinstance(value, date):
            out[key] = value.strftime("%Y-%m-%d")
        elif isinstance(value, (bool, int, float)):
            out[key] = value
        else:
            out[key] = value
    row_id = getattr(row, "id", None)
    if row_id is not None:
        out["id"] = row_id
    return out


def _column_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])

def _days_since(date_str: Any) -> int:
    text = str(date_str or "").strip()
    if not text:
        return 0
    candidates = [text[:19].replace("T", " "), text[:10]]
    today = datetime.now(CHINA_TZ).replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0)
    for raw in candidates:
        normalized = raw.replace("-", "/")
        for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
            try:
                parsed = datetime.strptime(normalized, fmt)
                return max(0, int((today - parsed.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds() // 86400))
            except ValueError:
                continue
    return 0

def _follow_date_iso(value: Any) -> str | None:
    """提取下次计划跟进日 YYYY-MM-DD；无效则返回 None。"""
    text = str(value or "").strip()
    if len(text) < 10:
        return None
    day = text[:10]
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return None
    return day


def _follow_up_datetime(value: Any) -> datetime | None:
    """宽松解析跟进时间，供跨对接池统一排序。"""
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text[:19].replace("T", " ").replace("/", "-")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            continue
    return None


def _sort_follow_ups_newest_first(items: list[Any]) -> list[dict[str, Any]]:
    """按跟进时间全局倒序；无效时间置后，id 作为稳定兜底。"""
    valid = [item for item in items if isinstance(item, dict)]

    def key(item: dict[str, Any]) -> tuple[bool, datetime, str]:
        occurred_at = _follow_up_datetime(item.get("date"))
        return (
            occurred_at is not None,
            occurred_at or datetime.min,
            str(item.get("id") or ""),
        )

    return sorted(valid, key=key, reverse=True)

def _as_amount(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
