#!/usr/bin/env python3
"""生成前端状态机/常量产物（同一后端权威源，多端产物）。

唯一权威源：geo-api/app/modules/contracts/status_catalog.py

产物：
- geo-admin/modules/crm/lib/status-catalog.generated.ts（完整 catalog）
- geo-intake/modules/requests/lib/status-catalog.generated.ts（需求状态段）

生成产物必须提交；`tests/test_status_catalog_generated_up_to_date.py` 会强制
“再生成后 diff = 0”，防止手改或绕过生成器。

用法：
    python3 geo-api/scripts/gen_frontend_status_catalog.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GEO_API_DIR = ROOT / "geo-api"
ADMIN_TARGET = ROOT / "geo-admin/modules/crm/lib/status-catalog.generated.ts"
INTAKE_TARGET = ROOT / "geo-intake/modules/requests/lib/status-catalog.generated.ts"

HEADER = """\
// 本文件由 geo-api/scripts/gen_frontend_status_catalog.py 自动生成，禁止手改。
// 唯一权威源：geo-api/app/modules/contracts/status_catalog.py
// 校验：cd geo-api && .venv/bin/python -m pytest tests/test_status_catalog_generated_up_to_date.py -q
"""


def _load_catalog() -> object:
    if str(GEO_API_DIR) not in sys.path:
        sys.path.insert(0, str(GEO_API_DIR))
    from app.modules.contracts import status_catalog

    return status_catalog


def _union_type(name: str, codes: list[str], legacy: frozenset[str], legacy_comment: str) -> str:
    lines = [f"export type {name} ="]
    for code in codes:
        if code in legacy:
            lines.append(f"  // {legacy_comment}")
        lines.append(f'  | "{code}"')
    return "\n".join(lines)


def _code_array(name: str, type_name: str, codes: list[str]) -> str:
    items = "".join(f'  "{code}",\n' for code in codes)
    return f"export const {name}: {type_name}[] = [\n{items}]"


def _meta_record(name: str, type_name: str, meta: dict[str, dict[str, str]], legacy: frozenset[str]) -> str:
    lines = [f"export const {name}: Record<{type_name}, {_meta_value_type(meta)}> = {{"]
    for code, fields in meta.items():
        if code in legacy:
            lines.append("  // 历史遗留/兼容值")
        inner = ", ".join(f'{key}: "{value}"' for key, value in fields.items())
        lines.append(f"  {code}: {{ {inner} }},")
    lines.append("}")
    return "\n".join(lines)


def _string_meta_record(name: str, type_name: str, meta: dict[str, str]) -> str:
    """仅 label（无 tone）的 Record<X, string>，如项目记录类型。"""
    lines = [f"export const {name}: Record<{type_name}, string> = {{"]
    for code, label in meta.items():
        lines.append(f'  {code}: "{label}",')
    lines.append("}")
    return "\n".join(lines)


def _string_array_dict(name: str, data: dict[str, list[str]]) -> str:
    """Record<string, string[]>，如行业一级 → 二级。"""
    lines = [f"export const {name}: Record<string, string[]> = {{"]
    for key, values in data.items():
        inner = ", ".join(f'"{value}"' for value in values)
        lines.append(f"  {key}: [{inner}],")
    lines.append("}")
    return "\n".join(lines)


def _const_object(name: str, data: dict[str, list[str]]) -> str:
    """as const 的对象，如输单原因树（key 需保留字面量类型）。"""
    lines = [f"export const {name} = {{"]
    for key, values in data.items():
        inner = ", ".join(f'"{value}"' for value in values)
        lines.append(f"  {key}: [{inner}],")
    lines.append("} as const")
    return "\n".join(lines)


def _option_pairs(name: str, options: list[dict[str, str]]) -> str:
    """as const 的 {value, label} 选项对，如填报周期/目标。"""
    items = "".join(
        f'  {{ value: "{opt["value"]}", label: "{opt["label"]}" }},\n' for opt in options
    )
    return f"export const {name} = [\n{items}] as const"


def _record_dict(name: str, type_annotation: str, data: dict[str, str]) -> str:
    """Record<string, X> 键值常量，如历史来源映射（键统一加引号）。"""
    lines = [f"export const {name}: {type_annotation} = {{"]
    for key, value in data.items():
        lines.append(f'  "{key}": "{value}",')
    lines.append("}")
    return "\n".join(lines)


def _status_actions_block(cat: object) -> str:
    lines = [
        "export const STATUS_ACTIONS: Partial<Record<RequestStatus, { label: string; next: RequestStatus }>> = {"
    ]
    for code, fields in cat.REQUEST_STATUS_ACTIONS.items():
        lines.append(f'  {code}: {{ label: "{fields["label"]}", next: "{fields["next"]}" }},')
    lines.append("}")
    return "\n".join(lines)


def _meta_value_type(meta: dict[str, dict[str, str]]) -> str:
    fields = next(iter(meta.values()))
    if set(fields) == {"label", "tone"}:
        return "{ label: string; tone: string }"
    return "{ " + "; ".join(f"{key}: string" for key in fields) + " }"


def _array_const(name: str, values: list[str]) -> str:
    items = "".join(f'  "{value}",\n' for value in values)
    return f"export const {name} = [\n{items}] as const"


def _render_request_status_section() -> str:
    cat = _load_catalog()
    request_codes = list(cat.REQUEST_STATUS_META.keys())
    request_meta = cat.REQUEST_STATUS_META
    tone_union = '"neutral" | "info" | "warning" | "success" | "muted"'

    status_meta_lines = [
        "export const STATUS_META: Record<RequestStatus, { label: string; description: string; tone: " + tone_union + " }> = {"
    ]
    for code, fields in request_meta.items():
        if code in cat.REQUEST_LEGACY_CODES:
            status_meta_lines.append("  // 历史遗留/兼容值")
        status_meta_lines.append(
            f'  {code}: {{ label: "{fields["label"]}", description: "{fields["description"]}", tone: "{fields["tone"]}" }},'
        )
    status_meta_lines.append("}")
    status_meta_block = "\n".join(status_meta_lines)

    return "\n".join(
        [
            "// ===== 需求状态（含历史遗留兼容值，仅保证渲染不崩，不进入筛选/动作） =====",
            _union_type(
                "RequestStatus",
                request_codes,
                cat.REQUEST_LEGACY_CODES,
                "历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）",
            ),
            "",
            status_meta_block,
            "",
            _status_actions_block(cat),
        ]
    )


def render_intake_catalog_ts() -> str:
    """geo-intake 产物：需求状态/动作 + 填报端表单值清单。"""
    cat = _load_catalog()
    geo_codes = list(cat.REQUEST_GEO_SOURCES.keys())
    sections = [
        _render_request_status_section(),
        "",
        "// ===== 需求业务归属（GEO 来源） =====",
        _union_type("RequestGeoSource", geo_codes, frozenset(), ""),
        "",
        _meta_record("REQUEST_GEO_SOURCE_META", "RequestGeoSource", cat.REQUEST_GEO_SOURCES, frozenset()),
        "",
        "// ===== 国内填报：AI 平台 =====",
        _array_const("DOMESTIC_AI_PLATFORM_OPTIONS", cat.INTAKE_DOMESTIC_AI_PLATFORMS),
        "",
        "// ===== 国内填报：优化周期 =====",
        _option_pairs("DOMESTIC_OPTIMIZE_PERIODS", cat.INTAKE_OPTIMIZE_PERIODS),
        "",
        "// ===== 国内填报：优化目标 =====",
        _option_pairs("DOMESTIC_OPTIMIZATION_GOALS", cat.INTAKE_DOMESTIC_GOALS),
        "",
        "// ===== 海外填报：优化目标值（label 在 i18n 翻译资源） =====",
        _array_const("OPTIMIZATION_GOAL_VALUES", cat.INTAKE_OVERSEAS_GOALS),
    ]
    return HEADER + "\n".join(sections) + "\n"


def render_status_catalog_ts() -> str:
    """geo-admin 产物：完整 catalog。"""
    cat = _load_catalog()
    opp_codes = list(cat.OPP_STAGE_META.keys())
    contract_codes = list(cat.CONTRACT_STATUS_META.keys())
    contract_project_codes = list(cat.CONTRACT_PROJECT_STATUS_META.keys())
    project_stage_codes = list(cat.PROJECT_STAGE_META.keys())
    project_health_codes = list(cat.PROJECT_HEALTH_META.keys())
    project_risk_codes = list(cat.PROJECT_RISK_META.keys())
    project_note_kind_codes = list(cat.PROJECT_NOTE_KIND_META.keys())
    customer_codes = list(cat.CUSTOMER_STATUS_META.keys())
    lead_codes = list(cat.LEAD_STATUS_META.keys())
    follow_state_codes = list(cat.FOLLOW_STATE_META.keys())

    sections = [
        _render_request_status_section(),
        "",
        "// ===== 商机阶段（9 正阶段 + demand/solution/quote 旧合并兼容值） =====",
        _union_type("OppStage", opp_codes, cat.OPP_LEGACY_CODES, "旧合并值兼容"),
        "",
        _code_array("OPP_STAGES", "OppStage", list(cat.OPP_STAGE_ORDER)),
        "",
        _meta_record("OPP_STAGE_META", "OppStage", cat.OPP_STAGE_META, cat.OPP_LEGACY_CODES),
        "",
        "// ===== 合同状态（与飞书 1:1；void 仅保留系统作废兼容） =====",
        _union_type("ContractStatus", contract_codes, cat.CONTRACT_LEGACY_CODES, "系统作废兼容（非飞书值）"),
        "",
        _code_array("CONTRACT_STATUSES", "ContractStatus", list(cat.CONTRACT_STATUS_ORDER)),
        "",
        _meta_record("CONTRACT_STATUS_META", "ContractStatus", cat.CONTRACT_STATUS_META, cat.CONTRACT_LEGACY_CODES),
        "",
        "// ===== 合同遗留 projectStatus（签约侧遗留状态，不与 Project.stage 双写） =====",
        _union_type("ProjectStatus", contract_project_codes, frozenset(), ""),
        "",
        _code_array("PROJECT_STATUSES", "ProjectStatus", list(cat.CONTRACT_PROJECT_STATUS_ORDER)),
        "",
        _meta_record("PROJECT_STATUS_META", "ProjectStatus", cat.CONTRACT_PROJECT_STATUS_META, frozenset()),
        "",
        "// ===== 交付项目阶段（Project.stage，交付执行权威阶段） =====",
        _union_type("ProjectStage", project_stage_codes, frozenset(), ""),
        "",
        _code_array("PROJECT_STAGES", "ProjectStage", list(cat.PROJECT_STAGE_ORDER)),
        "",
        _meta_record("PROJECT_STAGE_META", "ProjectStage", cat.PROJECT_STAGE_META, frozenset()),
        "",
        "// ===== 交付项目健康度 =====",
        _union_type("ProjectHealth", project_health_codes, frozenset(), ""),
        "",
        _code_array("PROJECT_HEALTHS", "ProjectHealth", list(cat.PROJECT_HEALTH_ORDER)),
        "",
        _meta_record("PROJECT_HEALTH_META", "ProjectHealth", cat.PROJECT_HEALTH_META, frozenset()),
        "",
        "// ===== 交付项目风险等级 =====",
        _union_type("ProjectRisk", project_risk_codes, frozenset(), ""),
        "",
        _code_array("PROJECT_RISKS", "ProjectRisk", list(cat.PROJECT_RISK_ORDER)),
        "",
        _meta_record("PROJECT_RISK_META", "ProjectRisk", cat.PROJECT_RISK_META, frozenset()),
        "",
        "// ===== 交付项目记录类型（跟进记录 kind） =====",
        _union_type("ProjectNoteKind", project_note_kind_codes, frozenset(), ""),
        "",
        _code_array("PROJECT_NOTE_KINDS", "ProjectNoteKind", list(cat.PROJECT_NOTE_KIND_ORDER)),
        "",
        _string_meta_record("PROJECT_NOTE_KIND_META", "ProjectNoteKind", cat.PROJECT_NOTE_KIND_META),
        "",
        "// ===== 客户状态（5 正状态 + potential/following/lost 旧值兼容展示） =====",
        _union_type("CustomerStatus", customer_codes, cat.CUSTOMER_LEGACY_CODES, "旧值兼容展示（读取时请 normalizeCustomerStatus）"),
        "",
        _code_array("CUSTOMER_STATUSES", "CustomerStatus", list(cat.CUSTOMER_STATUS_ORDER)),
        "",
        _meta_record("CUSTOMER_STATUS_META", "CustomerStatus", cat.CUSTOMER_STATUS_META, cat.CUSTOMER_LEGACY_CODES),
        "",
        "// ===== 线索状态 =====",
        _union_type("LeadStatus", lead_codes, frozenset(), ""),
        "",
        _meta_record("LEAD_STATUS_META", "LeadStatus", cat.LEAD_STATUS_META, frozenset()),
        "",
        "// ===== 线索等级（与飞书 1:1，含代理/海外，不合并到 A–D） =====",
        _union_type("LeadLevel", list(cat.LEAD_LEVEL_META.keys()), frozenset(), ""),
        "",
        _code_array("LEAD_LEVELS", "LeadLevel", list(cat.LEAD_LEVEL_ORDER)),
        "",
        _string_meta_record("LEAD_LEVEL_META", "LeadLevel", cat.LEAD_LEVEL_META),
        "",
        "// ===== 跟进状态 =====",
        _union_type("FollowState", follow_state_codes, frozenset(), ""),
        "",
        _meta_record("FOLLOW_STATE_META", "FollowState", cat.FOLLOW_STATE_META, frozenset()),
        "",
        "// ===== 跟进方式 =====",
        _union_type("FollowType", ["online", "offline"], frozenset(), ""),
        "",
        "export const FOLLOW_TYPE_OPTIONS: Array<{ value: FollowType; label: string }> = [",
        *[f'  {{ value: "{opt["value"]}", label: "{opt["label"]}" }},' for opt in cat.FOLLOW_TYPE_OPTIONS],
        "]",
        "",
        f"// ===== 线索一级来源（{len(cat.LEAD_SOURCES)} 个） =====",
        _array_const("LEAD_SOURCES", cat.LEAD_SOURCES),
        "export type LeadSource = (typeof LEAD_SOURCES)[number]",
        "",
        "// 机构引荐 · 二级（可后续增补）",
        _array_const("LEAD_SOURCE_INSTITUTIONS", cat.LEAD_SOURCE_INSTITUTIONS),
        "",
        "// 内容营销 · 二级（渠道识别）",
        _array_const("LEAD_SOURCE_CONTENT_CHANNELS", cat.LEAD_SOURCE_CONTENT_CHANNELS),
        "",
        "// 官网注册 · 二级（官网首页 / Mark / 36氪入口）",
        _array_const("LEAD_SOURCE_WEBSITE_ENTRIES", cat.LEAD_SOURCE_WEBSITE_ENTRIES),
        "",
        "// 会议类一级来源（三方会议/自办会议共用会议二级交互）",
        _array_const("MEETING_PRIMARY_SOURCES", cat.MEETING_PRIMARY_SOURCES),
        "",
        "// 历史写法 → 标准一级来源（导入/筛选兼容）",
        _record_dict("LEGACY_LEAD_SOURCE_MAP", "Record<string, LeadSource>", cat.LEGACY_LEAD_SOURCE_MAP),
        "",
        "// ===== 需求业务归属（GEO 来源） =====",
        _union_type("RequestGeoSource", list(cat.REQUEST_GEO_SOURCES.keys()), frozenset(), ""),
        "",
        _meta_record("REQUEST_GEO_SOURCE_META", "RequestGeoSource", cat.REQUEST_GEO_SOURCES, frozenset()),
        "",
        "// ===== 纯展示/选项常量（后端无校验清单，统一单源） =====",
        _array_const("REGIONS", cat.REGIONS),
        "",
        _array_const("CHANNEL_TYPES", cat.CHANNEL_TYPES),
        "",
        _array_const("CHANNEL_LEVELS", cat.CHANNEL_LEVELS),
        "",
        _array_const("CHANNEL_AGENCY_TYPES", cat.CHANNEL_AGENCY_TYPES),
        "",
        _array_const("CHANNEL_OPPORTUNITY_STAGES", cat.CHANNEL_OPPORTUNITY_STAGES),
        "",
        _array_const("CHANNEL_CONTRACT_STATUSES", cat.CHANNEL_CONTRACT_STATUSES),
        "",
        _string_array_dict("CHANNEL_REGIONS", cat.CHANNEL_REGIONS),
        "",
        _string_array_dict("INDUSTRIES", cat.INDUSTRIES),
        "",
        _array_const("COMPANY_NATURES", cat.COMPANY_NATURES),
        "",
        _array_const("PROJECT_TYPES", cat.OPPORTUNITY_PROJECT_TYPES),
        "",
        _array_const("OPT_PERIODS", cat.OPPORTUNITY_OPT_PERIODS),
        "",
        _const_object("LOST_REASON_OPTIONS", cat.LOST_REASON_OPTIONS),
        "",
        _array_const("CONTRACT_TYPES", cat.CONTRACT_TYPES),
        "",
        _array_const("SIGN_TYPES", cat.SIGN_TYPES),
        "",
        _array_const("CONTRACT_SOURCES", cat.CONTRACT_SOURCES),
        "",
        _array_const("PROJECT_TYPE_OPTIONS", cat.PROJECT_TYPE_OPTIONS),
        "",
        _array_const("PROJECT_PLATFORM_OPTIONS", cat.PROJECT_PLATFORM_OPTIONS),
        "",
        "// ===== 填报端表单值清单（国内代客填报 / 客户填报共用） =====",
        _array_const("DOMESTIC_AI_PLATFORM_OPTIONS", cat.INTAKE_DOMESTIC_AI_PLATFORMS),
        "",
        _option_pairs("DOMESTIC_OPTIMIZE_PERIODS", cat.INTAKE_OPTIMIZE_PERIODS),
        "",
        _option_pairs("DOMESTIC_OPTIMIZATION_GOALS", cat.INTAKE_DOMESTIC_GOALS),
        "",
        _array_const("OPTIMIZATION_GOAL_VALUES", cat.INTAKE_OVERSEAS_GOALS),
    ]

    return HEADER + "\n".join(sections) + "\n"


def main() -> int:
    ADMIN_TARGET.write_text(render_status_catalog_ts(), encoding="utf-8")
    INTAKE_TARGET.write_text(render_intake_catalog_ts(), encoding="utf-8")
    print(f"已生成 {ADMIN_TARGET.relative_to(ROOT)}")
    print(f"已生成 {INTAKE_TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
