"""国内 / 海外业务归属（需求、商机、合同、项目）。

海外运营：data_scope=all + 模块内 forced_geo_source=overseas
→ 可见全部海外归属数据，不可见国内；其它角色暂不按 geo 反向隔离。
"""

from __future__ import annotations

from typing import Any, Literal

from app.modules.auth.schemas import AuthUser
from app.modules.contracts.status_catalog import REQUEST_GEO_SOURCES as _GEO_SOURCE_CATALOG

GeoSource = Literal["domestic", "overseas", "mestbo", "manual"]
# GEO 来源常量与飞书映射从唯一权威源 status_catalog.py 派生。
VALID_GEO_SOURCES: frozenset[str] = frozenset(_GEO_SOURCE_CATALOG.keys())

_SOURCE_BY_FEISHU: dict[str, GeoSource] = {
    meta["feishuSource"]: code
    for code, meta in _GEO_SOURCE_CATALOG.items()
    if meta["feishuSource"]
}

_FEISHU_BY_VARIANT: dict[str, str] = {
    code: meta["feishuSource"]
    for code, meta in _GEO_SOURCE_CATALOG.items()
    if meta["feishuSource"]
}


def forced_geo_source(user: AuthUser | None) -> str | None:
    """海外运营强制海外归属；其它角色不强制。"""
    if user is None:
        return None
    return "overseas" if (user.role or "") == "overseas" else None


def normalize_geo_source(raw: Any) -> str | None:
    key = str(raw or "").strip().lower()
    return key if key in VALID_GEO_SOURCES else None


def apply_intake_geo_stamp(data: dict[str, Any], variant: str) -> dict[str, Any]:
    """按海外/国内变体强制写入 importMeta.source（覆盖客户端伪造）。"""
    key = (variant or "").strip().lower()
    source = _FEISHU_BY_VARIANT.get(key)
    if not source:
        return dict(data or {})
    out = dict(data or {})
    meta = dict(out.get("importMeta") or {}) if isinstance(out.get("importMeta"), dict) else {}
    meta["source"] = source
    out["importMeta"] = meta
    return out


def resolve_request_geo_source(
    *,
    code: str | None = None,
    data: dict[str, Any] | None = None,
) -> GeoSource:
    meta = (data or {}).get("importMeta") if isinstance(data, dict) else None
    source = ""
    if isinstance(meta, dict):
        source = str(meta.get("source") or "").strip()
    from_meta = _SOURCE_BY_FEISHU.get(source)
    if from_meta:
        return from_meta
    upper = (code or "").strip().upper()
    if upper.startswith("GEO-CN"):
        return "domestic"
    if upper.startswith("GEO-OV"):
        return "overseas"
    if upper.startswith("GEO-MS"):
        return "mestbo"
    return "manual"


def resolve_document_geo_source(document: dict[str, Any] | None) -> str | None:
    """读取实体 document 上的显式 geoSource（未 stamp 时返回 None）。"""
    if not isinstance(document, dict):
        return None
    return normalize_geo_source(document.get("geoSource"))


def prefer_linked_geo(
    *,
    linked: str | None,
    stamped: str | None,
    default: str = "manual",
) -> str:
    """读/写统一：绑定溯源优先于 document stamp，避免客户端伪造 stamp 穿透隔离。"""
    linked_norm = normalize_geo_source(linked) if linked else None
    if linked_norm and linked_norm != "manual":
        return linked_norm
    stamped_norm = normalize_geo_source(stamped) if stamped else None
    if stamped_norm and stamped_norm != "manual":
        return stamped_norm
    if linked_norm == "manual" or stamped_norm == "manual":
        return "manual"
    return default


def coalesce_geo_sources(*candidates: str | None) -> str:
    """按优先级取首个具体归属（跳过空值与 manual）；全无则 manual。"""
    for raw in candidates:
        norm = normalize_geo_source(raw) if raw else None
        if not norm or norm == "manual":
            continue
        return norm
    return "manual"


def opportunity_geo_from_request_map(
    doc: dict[str, Any] | None,
    request_geo_by_id: dict[str, str],
) -> str:
    """商机归属：绑定需求（跳过 manual）→ document.geoSource → manual。"""
    stamped = resolve_document_geo_source(doc if isinstance(doc, dict) else None)
    linked: list[str | None] = []
    raw_ids = (doc or {}).get("requestIds") if isinstance(doc, dict) else None
    if isinstance(raw_ids, list):
        for rid in (str(x).strip() for x in raw_ids if str(x).strip()):
            if rid in request_geo_by_id:
                linked.append(request_geo_by_id[rid])
    return coalesce_geo_sources(*linked, stamped)


def matches_forced_geo(forced: str | None, entity_geo: str | None) -> bool:
    if not forced:
        return True
    return (entity_geo or "") == forced
