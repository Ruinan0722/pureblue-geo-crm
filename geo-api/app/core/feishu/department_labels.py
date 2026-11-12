"""部门 open_department_id → 中文名 / 组织路径（飞书未返回 name 时的兜底）。

飞书应用需开通 contact:department.base:readonly 才能从 API 直接拿到部门名；
在此之前用本文件 + geo-admin/config/feishu-department-map.json 的 labels/breadcrumbs 兜底。
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

_STRIP_SUFFIX = re.compile(r"（[^）]*）$")
_ROOT_PREFIXES = ("PureblueAI > ", "PureblueAI>", "Pureblue AI > ")


def _short_label(raw: str) -> str:
    trimmed = (raw or "").strip()
    if not trimmed:
        return ""
    if ">" in trimmed:
        trimmed = trimmed.split(">")[-1].strip()
    return _STRIP_SUFFIX.sub("", trimmed).strip()


def strip_company_root_prefix(path: str) -> str:
    """去掉公司根前缀，保留业务组织路径。"""
    trimmed = (path or "").strip()
    if not trimmed:
        return ""
    for prefix in _ROOT_PREFIXES:
        if trimmed.startswith(prefix):
            return trimmed[len(prefix) :].strip()
    parts = [p.strip() for p in trimmed.split(">") if p.strip()]
    if len(parts) >= 2 and parts[0].replace(" ", "").lower() in {"pureblueai", "pureblue"}:
        return " > ".join(parts[1:])
    return trimmed


def _normalize_breadcrumb(raw: str) -> str:
    trimmed = (raw or "").strip()
    if not trimmed:
        return ""
    if ">" in trimmed:
        parts = [_STRIP_SUFFIX.sub("", p.strip()).strip() for p in trimmed.split(">")]
        parts = [p for p in parts if p]
        return strip_company_root_prefix(" > ".join(parts))
    short = _STRIP_SUFFIX.sub("", trimmed).strip()
    return short


def _load_map_file(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """返回 (short_labels, breadcrumbs)。"""
    if not path.is_file():
        return {}, {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, {}
    if not isinstance(data, dict):
        return {}, {}

    labels: dict[str, str] = {}
    breadcrumbs: dict[str, str] = {}

    raw_labels = data.get("labels") if "labels" in data else data
    if isinstance(raw_labels, dict):
        for dept_id, label in raw_labels.items():
            if not (isinstance(dept_id, str) and dept_id.startswith("od-") and isinstance(label, str)):
                continue
            short = _short_label(label)
            if short:
                labels[dept_id] = short
            bc = _normalize_breadcrumb(label)
            if bc and ">" in bc:
                breadcrumbs[dept_id] = bc

    raw_bc = data.get("breadcrumbs")
    if isinstance(raw_bc, dict):
        for dept_id, dept_path in raw_bc.items():
            if not (isinstance(dept_id, str) and dept_id.startswith("od-") and isinstance(dept_path, str)):
                continue
            bc = _normalize_breadcrumb(dept_path)
            if bc:
                breadcrumbs[dept_id] = bc
            short = _short_label(dept_path)
            if short and dept_id not in labels:
                labels[dept_id] = short

    return labels, breadcrumbs


def _iter_map_paths() -> list[Path]:
    settings = get_settings()
    paths: list[Path] = []
    # department_labels.py → feishu → core → app → geo-api
    api_root = Path(__file__).resolve().parents[3]
    # 默认内置：短名表 + 完整 breadcrumb map（Docker 需 COPY config/）
    paths.append(api_root / "config" / "feishu-department-labels.json")
    paths.append(api_root / "config" / "feishu-department-map.json")
    # 本机 monorepo：与 geo-admin 共用同一份 map
    paths.append(api_root.parent / "geo-admin" / "config" / "feishu-department-map.json")

    extra_path = (settings.feishu_department_labels_path or "").strip()
    if extra_path:
        paths.append(Path(extra_path))

    map_path = (settings.feishu_department_map_path or "").strip()
    if map_path:
        p = Path(map_path)
        if not p.is_absolute():
            # 兼容相对仓库根 / 相对 geo-api 两种写法
            candidates = [
                (api_root / p).resolve(),
                (api_root.parent / p).resolve(),
                Path.cwd() / p,
            ]
            for candidate in candidates:
                if candidate.is_file():
                    paths.append(candidate)
                    break
            else:
                paths.append((api_root / p).resolve())
        else:
            paths.append(p)
    return paths


@lru_cache
def get_department_id_labels() -> dict[str, str]:
    merged: dict[str, str] = {}
    for path in _iter_map_paths():
        labels, _ = _load_map_file(path)
        merged.update(labels)
    return merged


@lru_cache
def get_department_id_breadcrumbs() -> dict[str, str]:
    merged: dict[str, str] = {}
    for path in _iter_map_paths():
        _, breadcrumbs = _load_map_file(path)
        merged.update(breadcrumbs)
    return merged


def resolve_department_name(dept_id: str) -> str | None:
    """短名（末级部门）。"""
    name = get_department_id_labels().get(dept_id)
    return name if name else None


def resolve_department_breadcrumb(dept_id: str) -> str | None:
    """完整业务组织路径（含上级，已去掉公司根前缀）。"""
    oid = (dept_id or "").strip()
    if not oid or oid == "0":
        return None
    path = get_department_id_breadcrumbs().get(oid)
    if path:
        return path
    short = resolve_department_name(oid)
    return short if short else None


def resolve_department_display_path(dept_id: str, *, fallback: str | None = None) -> str:
    """人员展示用部门路径：优先完整面包屑，其次短名/兜底。"""
    oid = (dept_id or "").strip()
    if not oid or oid == "0":
        return (fallback or "").strip()
    return (
        resolve_department_breadcrumb(oid)
        or (fallback or "").strip()
        or resolve_department_name(oid)
        or oid
    )
