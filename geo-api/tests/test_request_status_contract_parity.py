"""需求状态契约校验：后端 Literal ↔ status_catalog.py ↔ 生成产物必须一致。

2026-08 曾出现 approved 失配：后端保留旧枚举，前端类型缺失导致 API 返回 approved
时状态文案取 undefined。收口后唯一权威源为 status_catalog.py，本测试钉死三条链：
1. catalog 需求状态码 == requests/schemas.py 的 RequestStatus Literal（两端都在后端，
   防止 API 枚举与 catalog 漂移）；
2. 生成产物 RequestStatus union == catalog 状态码；
3. 生成产物 STATUS_META keys == catalog 状态码，且 approved 必须有中文 label。
"""

from __future__ import annotations

import re
from pathlib import Path

from app.modules.contracts.status_catalog import REQUEST_STATUS_META

ROOT = Path(__file__).resolve().parents[2]
BACKEND_SCHEMAS = ROOT / "geo-api/app/modules/requests/schemas.py"
GENERATED = ROOT / "geo-admin/modules/crm/lib/status-catalog.generated.ts"


def _backend_request_statuses() -> set[str]:
    source = BACKEND_SCHEMAS.read_text(encoding="utf-8")
    match = re.search(r"RequestStatus = Literal\[(.*?)\]\n", source, re.DOTALL)
    assert match, "未找到后端 RequestStatus Literal"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def _generated_request_statuses() -> set[str]:
    source = GENERATED.read_text(encoding="utf-8")
    start = source.index("export type RequestStatus =")
    end = source.index("export const STATUS_META", start)
    block = re.sub(r"//[^\n]*", "", source[start:end])
    return set(re.findall(r'"([^"]+)"', block))


def _generated_status_meta_keys() -> set[str]:
    source = GENERATED.read_text(encoding="utf-8")
    match = re.search(
        r"export const STATUS_META:\s*Record<[^>]+>\s*=\s*\{(.*?)\n\}",
        source,
        re.DOTALL,
    )
    assert match, "未找到生成产物 STATUS_META"
    return set(re.findall(r"^\s{2}([A-Za-z_]+):", match.group(1), re.MULTILINE))


def _catalog_request_statuses() -> set[str]:
    return set(REQUEST_STATUS_META.keys())


def test_backend_literal_matches_catalog():
    assert _backend_request_statuses() == _catalog_request_statuses()


def test_catalog_matches_generated_type():
    assert _catalog_request_statuses() == _generated_request_statuses()


def test_generated_type_matches_status_meta():
    assert _generated_request_statuses() == _generated_status_meta_keys()


def test_legacy_approved_has_label():
    assert REQUEST_STATUS_META["approved"]["label"] == "已确认"
    assert re.search(
        r"approved:\s*\{[^}]*label:\s*\"已确认\"",
        GENERATED.read_text(encoding="utf-8"),
    )
