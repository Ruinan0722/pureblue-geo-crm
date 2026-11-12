"""选项/等级/GEO/动作常量契约校验：status_catalog.py ↔ 后端派生 ↔ 生成产物。

覆盖：线索等级、一级来源/会议来源/历史来源映射、区域、GEO 来源、需求状态前向动作、
填报端平台/周期/目标（与 geo-api 校验集合一致）。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from app.core.geo_scope import _SOURCE_BY_FEISHU, VALID_GEO_SOURCES, GeoSource
from app.modules.contracts.status_catalog import (
    COMPANY_NATURES,
    CONTRACT_SOURCES,
    CONTRACT_TYPES,
    INDUSTRIES,
    INTAKE_DOMESTIC_AI_PLATFORMS,
    INTAKE_DOMESTIC_GOALS,
    INTAKE_OPTIMIZE_PERIODS,
    INTAKE_OVERSEAS_GOALS,
    LEAD_LEVEL_META,
    LEAD_SOURCES,
    LEGACY_LEAD_SOURCE_MAP,
    LOST_REASON_OPTIONS,
    MEETING_PRIMARY_SOURCES,
    OPPORTUNITY_OPT_PERIODS,
    OPPORTUNITY_PROJECT_TYPES,
    PROJECT_PLATFORM_OPTIONS,
    PROJECT_TYPE_OPTIONS,
    REGIONS,
    REQUEST_GEO_SOURCES,
    REQUEST_STATUS_ACTIONS,
    SIGN_TYPES,
)
from app.modules.crm.feishu_lead_mapper import LEAD_SOURCES as BACKEND_LEAD_SOURCES
from app.modules.crm.feishu_lead_mapper import LEVELS, SOURCE_ALIASES
from app.modules.crm.feishu_lead_mapper import REGIONS as BACKEND_REGIONS
from app.modules.crm.opportunity_request_gate import (
    REQUEST_STATUS_TRANSITIONS_ALLOWED_WHEN_BOUND,
)
from app.modules.crm.service.base import MEETING_PRIMARY_SOURCES as BACKEND_MEETING_SOURCES
from app.modules.requests.validation import (
    _VALID_DOMESTIC_GOALS,
    _VALID_DOMESTIC_PERIODS,
    _VALID_DOMESTIC_PLATFORMS,
    _VALID_OVERSEAS_GOALS,
)

ROOT = Path(__file__).resolve().parents[2]
ADMIN_GENERATED = ROOT / "geo-admin/modules/crm/lib/status-catalog.generated.ts"
INTAKE_GENERATED = ROOT / "geo-intake/modules/requests/lib/status-catalog.generated.ts"


def _generated_union(name: str, terminator: str, source: str = "") -> set[str]:
    text = source or ADMIN_GENERATED.read_text(encoding="utf-8")
    start = text.index(f"export type {name} =")
    end = text.index(f"export const {terminator}", start)
    block = re.sub(r"//[^\n]*", "", text[start:end])
    return set(re.findall(r'"([^"]+)"', block))


def _generated_array(name: str, source: str = "") -> list[str]:
    text = source or ADMIN_GENERATED.read_text(encoding="utf-8")
    start = text.index(f"export const {name} = [")
    end = text.index("] as const", start)
    block = re.sub(r"//[^\n]*", "", text[start:end])
    return re.findall(r'"([^"]+)"', block)


def _generated_meta_keys(name: str, source: str = "") -> set[str]:
    text = source or ADMIN_GENERATED.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {name}:\s*Record<[^>]+>\s*=\s*\{{(.*?)\n\}}",
        text,
        re.DOTALL,
    )
    assert match, f"未找到生成产物 {name}"
    return set(re.findall(r"^ {2}([^:{}]+):", match.group(1), re.MULTILINE))


def _generated_record_keys(name: str, source: str = "") -> set[str]:
    text = source or ADMIN_GENERATED.read_text(encoding="utf-8")
    start = text.index(f"export const {name}")
    end = text.index("\n}", start)
    return set(re.findall(r'"([^"]+)":\s*"', text[start:end]))


def _generated_object_keys(name: str, source: str = "") -> set[str]:
    text = source or ADMIN_GENERATED.read_text(encoding="utf-8")
    start = text.index(f"export const {name}")
    brace = text.index("{", start)
    if name == "LOST_REASON_OPTIONS":
        end = text.index("\n} as const", brace)
    else:
        end = text.index("\n}", brace)
    return set(re.findall(r"^\s{2}([^:]+): \[", text[brace:end], re.MULTILINE))


def _generated_status_actions() -> dict[str, str]:
    text = ADMIN_GENERATED.read_text(encoding="utf-8")
    match = re.search(
        r"export const STATUS_ACTIONS:\s*Partial<Record<RequestStatus,.*?>>\s*=\s*\{(.*?)\n\}",
        text,
        re.DOTALL,
    )
    assert match, "未找到 STATUS_ACTIONS"
    return dict(
        re.findall(
            r"^\s{2}([A-Za-z_]+):\s*\{[^}]*next:\s*\"([^\"]+)\"",
            match.group(1),
            re.MULTILINE,
        )
    )


def _generated_option_values(name: str) -> list[str]:
    text = INTAKE_GENERATED.read_text(encoding="utf-8")
    start = text.index(f"export const {name} = [")
    end = text.index("] as const", start)
    block = re.sub(r"//[^\n]*", "", text[start:end])
    return re.findall(r'value:\s*"([^"]+)"', block)


def test_lead_levels_match_backend_and_generated():
    assert set(LEAD_LEVEL_META) == LEVELS
    assert set(LEAD_LEVEL_META) == _generated_union("LeadLevel", "LEAD_LEVELS")
    assert set(LEAD_LEVEL_META) == set(_generated_meta_keys("LEAD_LEVEL_META"))
    for label in LEAD_LEVEL_META.values():
        assert str(label or "").strip(), "线索等级缺少 label"


def test_lead_sources_match_backend_and_generated():
    assert set(LEAD_SOURCES) == BACKEND_LEAD_SOURCES
    assert set(LEAD_SOURCES) == set(_generated_array("LEAD_SOURCES"))
    assert set(MEETING_PRIMARY_SOURCES) == BACKEND_MEETING_SOURCES
    assert set(MEETING_PRIMARY_SOURCES) == set(_generated_array("MEETING_PRIMARY_SOURCES"))


def test_legacy_source_map_matches_backend_and_generated():
    assert dict(LEGACY_LEAD_SOURCE_MAP) == SOURCE_ALIASES
    assert set(LEGACY_LEAD_SOURCE_MAP) == _generated_record_keys("LEGACY_LEAD_SOURCE_MAP")
    for alias, standard in LEGACY_LEAD_SOURCE_MAP.items():
        assert standard in LEAD_SOURCES, f"来源映射目标不在合法来源内：{alias} → {standard}"


def test_regions_match_backend_and_generated():
    assert set(REGIONS) == BACKEND_REGIONS
    assert list(REGIONS) == _generated_array("REGIONS")


def test_geo_sources_match_backend_and_generated():
    assert set(REQUEST_GEO_SOURCES) == VALID_GEO_SOURCES
    assert set(REQUEST_GEO_SOURCES) == set(get_args(GeoSource))
    assert set(REQUEST_GEO_SOURCES) == _generated_union("RequestGeoSource", "REQUEST_GEO_SOURCE_META")
    assert set(REQUEST_GEO_SOURCES) == _generated_meta_keys("REQUEST_GEO_SOURCE_META")
    feishu_names = {meta["feishuSource"] for meta in REQUEST_GEO_SOURCES.values() if meta["feishuSource"]}
    assert feishu_names == set(_SOURCE_BY_FEISHU)
    for code, meta in REQUEST_GEO_SOURCES.items():
        assert str(meta["label"] or "").strip(), f"GEO 来源 {code} 缺少 label"


def test_status_actions_match_backend_gate_and_generated():
    expected_pairs = frozenset(
        (from_code, meta["next"]) for from_code, meta in REQUEST_STATUS_ACTIONS.items()
    )
    assert expected_pairs == REQUEST_STATUS_TRANSITIONS_ALLOWED_WHEN_BOUND
    expected_next = {code: meta["next"] for code, meta in REQUEST_STATUS_ACTIONS.items()}
    assert expected_next == _generated_status_actions()


def test_display_options_match_generated():
    cases = [
        (list(COMPANY_NATURES), "COMPANY_NATURES"),
        (list(OPPORTUNITY_PROJECT_TYPES), "PROJECT_TYPES"),
        (list(OPPORTUNITY_OPT_PERIODS), "OPT_PERIODS"),
        (list(CONTRACT_TYPES), "CONTRACT_TYPES"),
        (list(SIGN_TYPES), "SIGN_TYPES"),
        (list(CONTRACT_SOURCES), "CONTRACT_SOURCES"),
        (list(PROJECT_TYPE_OPTIONS), "PROJECT_TYPE_OPTIONS"),
        (list(PROJECT_PLATFORM_OPTIONS), "PROJECT_PLATFORM_OPTIONS"),
    ]
    for expected, name in cases:
        assert expected == _generated_array(name), f"生成产物 {name} 与 catalog 不一致"
    assert set(INDUSTRIES) == _generated_object_keys("INDUSTRIES")
    assert set(LOST_REASON_OPTIONS) == _generated_object_keys("LOST_REASON_OPTIONS")


def test_intake_options_match_backend_validation_and_generated():
    assert set(INTAKE_DOMESTIC_AI_PLATFORMS) == _VALID_DOMESTIC_PLATFORMS
    assert set(INTAKE_DOMESTIC_AI_PLATFORMS) == set(_generated_array("DOMESTIC_AI_PLATFORM_OPTIONS", INTAKE_GENERATED.read_text(encoding="utf-8")))

    period_values = {period["value"] for period in INTAKE_OPTIMIZE_PERIODS}
    assert period_values == _VALID_DOMESTIC_PERIODS
    assert period_values == set(_generated_option_values("DOMESTIC_OPTIMIZE_PERIODS"))

    domestic_goal_values = {goal["value"] for goal in INTAKE_DOMESTIC_GOALS}
    assert domestic_goal_values == _VALID_DOMESTIC_GOALS
    assert domestic_goal_values == set(_generated_option_values("DOMESTIC_OPTIMIZATION_GOALS"))

    assert set(INTAKE_OVERSEAS_GOALS) == _VALID_OVERSEAS_GOALS
    assert set(INTAKE_OVERSEAS_GOALS) == set(_generated_array("OPTIMIZATION_GOAL_VALUES", INTAKE_GENERATED.read_text(encoding="utf-8")))
