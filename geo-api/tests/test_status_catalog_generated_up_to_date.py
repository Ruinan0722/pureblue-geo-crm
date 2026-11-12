"""强制“结构上单源”：生成器再生成产物必须与仓库 diff = 0，且前端只能引用生成产物。

覆盖问题 1（状态机/常量双份）的收口：后端 status_catalog.py 是唯一权威，
geo-admin 的 crm-data.ts / requests/lib/status.ts 与 geo-intake 的
requests/lib/status.ts 只 re-export status-catalog.generated.ts 生成产物。
任何人绕过生成器手写/手改前端常量，或改了后端 catalog 忘记重新生成，本测试都会失败。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "geo-api/scripts"
ADMIN_GENERATED = ROOT / "geo-admin/modules/crm/lib/status-catalog.generated.ts"
INTAKE_GENERATED = ROOT / "geo-intake/modules/requests/lib/status-catalog.generated.ts"
CRM_DATA = ROOT / "geo-admin/modules/crm/lib/crm-data.ts"
ADMIN_REQUESTS_STATUS = ROOT / "geo-admin/modules/requests/lib/status.ts"
INTAKE_REQUESTS_STATUS = ROOT / "geo-intake/modules/requests/lib/status.ts"


def _load_generator():
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    import gen_frontend_status_catalog

    return gen_frontend_status_catalog


def test_generated_files_match_repository():
    """执行生成器，断言产物与仓库一致（不一致即失败）。"""
    gen = _load_generator()
    cases = [
        (ADMIN_GENERATED, gen.render_status_catalog_ts()),
        (INTAKE_GENERATED, gen.render_intake_catalog_ts()),
    ]
    for path, expected in cases:
        assert path.exists(), f"缺少生成产物：{path.relative_to(ROOT)}"
        actual = path.read_text(encoding="utf-8")
        assert actual == expected, (
            f"{path.relative_to(ROOT)} 与后端唯一权威源 status_catalog.py 不一致。\n"
            "请重跑：python3 geo-api/scripts/gen_frontend_status_catalog.py，并提交生成产物。"
        )


def test_frontend_files_import_generated_catalog():
    """防止有人绕过生成器又手写常量。"""
    for path in (CRM_DATA, ADMIN_REQUESTS_STATUS, INTAKE_REQUESTS_STATUS):
        source = path.read_text(encoding="utf-8")
        assert re.search(r'["\'](?:\./|@/modules/crm/lib/)status-catalog\.generated["\']', source), (
            f"{path.relative_to(ROOT)} 必须 import status-catalog.generated（防止绕过生成器手写常量）"
        )


def test_generated_catalog_exports_authoritative_names():
    source = ADMIN_GENERATED.read_text(encoding="utf-8")
    for name in (
        "RequestStatus",
        "STATUS_META",
        "OppStage",
        "OPP_STAGES",
        "OPP_STAGE_META",
        "CustomerStatus",
        "CUSTOMER_STATUSES",
        "CUSTOMER_STATUS_META",
        "ContractStatus",
        "CONTRACT_STATUSES",
        "CONTRACT_STATUS_META",
        "ProjectStatus",
        "PROJECT_STATUSES",
        "PROJECT_STATUS_META",
        "ProjectStage",
        "PROJECT_STAGES",
        "PROJECT_STAGE_META",
        "ProjectHealth",
        "PROJECT_HEALTHS",
        "PROJECT_HEALTH_META",
        "ProjectRisk",
        "PROJECT_RISKS",
        "PROJECT_RISK_META",
        "ProjectNoteKind",
        "PROJECT_NOTE_KINDS",
        "PROJECT_NOTE_KIND_META",
        "REGIONS",
        "INDUSTRIES",
        "COMPANY_NATURES",
        "LeadLevel",
        "LEAD_LEVELS",
        "LEAD_LEVEL_META",
        "PROJECT_TYPES",
        "OPT_PERIODS",
        "LOST_REASON_OPTIONS",
        "CONTRACT_TYPES",
        "SIGN_TYPES",
        "CONTRACT_SOURCES",
        "PROJECT_TYPE_OPTIONS",
        "PROJECT_PLATFORM_OPTIONS",
        "MEETING_PRIMARY_SOURCES",
        "LEGACY_LEAD_SOURCE_MAP",
        "RequestGeoSource",
        "REQUEST_GEO_SOURCE_META",
        "STATUS_ACTIONS",
        "DOMESTIC_AI_PLATFORM_OPTIONS",
        "DOMESTIC_OPTIMIZE_PERIODS",
        "DOMESTIC_OPTIMIZATION_GOALS",
        "OPTIMIZATION_GOAL_VALUES",
        "LeadStatus",
        "LEAD_STATUS_META",
        "FollowState",
        "FOLLOW_STATE_META",
        "FollowType",
        "FOLLOW_TYPE_OPTIONS",
        "LEAD_SOURCES",
        "LEAD_SOURCE_INSTITUTIONS",
        "LEAD_SOURCE_CONTENT_CHANNELS",
        "LEAD_SOURCE_WEBSITE_ENTRIES",
    ):
        assert re.search(rf"\bexport (?:const|type) {re.escape(name)}\b", source), (
            f"生成产物缺少权威导出：{name}"
        )


def test_intake_generated_catalog_covers_intake_families():
    """填报端产物覆盖需求状态/动作 + 表单值清单；内容与权威源一致由零 diff 测试保证。"""
    source = INTAKE_GENERATED.read_text(encoding="utf-8")
    for name in (
        "RequestStatus",
        "STATUS_META",
        "STATUS_ACTIONS",
        "REQUEST_GEO_SOURCE_META",
        "DOMESTIC_AI_PLATFORM_OPTIONS",
        "DOMESTIC_OPTIMIZE_PERIODS",
        "DOMESTIC_OPTIMIZATION_GOALS",
        "OPTIMIZATION_GOAL_VALUES",
    ):
        assert re.search(rf"\bexport (?:const|type) {re.escape(name)}\b", source), (
            f"填报端生成产物缺少 {name}"
        )
