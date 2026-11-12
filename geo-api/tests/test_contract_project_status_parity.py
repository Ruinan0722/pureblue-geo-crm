"""合同状态 / 合同遗留 projectStatus / 交付项目阶段契约校验。

status_catalog.py 是唯一权威；本测试钉死四条链：
1. catalog 合同状态码 == 后端 `_CONTRACT_STATUSES`（crm/service/base.py 派生）；
2. catalog 合同遗留 projectStatus 码 == 生成产物 ProjectStatus union / PROJECT_STATUS_META keys；
3. catalog 交付项目阶段码 == 后端 projects/schemas.py ProjectStage Literal == 生成产物
   ProjectStage union / PROJECT_STAGE_META keys；
4. 每个 code 都有中文 label（含 legacy void）。

注意不得混淆：Contract.projectStatus（签约侧遗留）与 Project.stage（交付执行权威阶段）
是两个独立状态机。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from app.modules.contracts.status_catalog import (
    CONTRACT_PROJECT_STATUS_META,
    CONTRACT_STATUS_META,
    PROJECT_HEALTH_META,
    PROJECT_NOTE_KIND_META,
    PROJECT_RISK_META,
    PROJECT_STAGE_META,
)
from app.modules.crm.service.base import _CONTRACT_STATUSES
from app.modules.projects.schemas import (
    ProjectHealth as ProjectHealthLiteral,
)
from app.modules.projects.schemas import (
    ProjectNoteKind as ProjectNoteKindLiteral,
)
from app.modules.projects.schemas import (
    ProjectRisk as ProjectRiskLiteral,
)
from app.modules.projects.schemas import (
    ProjectStage as ProjectStageLiteral,
)

ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / "geo-admin/modules/crm/lib/status-catalog.generated.ts"


def _generated_union(name: str, terminator: str) -> set[str]:
    source = GENERATED.read_text(encoding="utf-8")
    start = source.index(f"export type {name} =")
    end = source.index(f"export const {terminator}", start)
    block = re.sub(r"//[^\n]*", "", source[start:end])
    return set(re.findall(r'"([^"]+)"', block))


def _generated_meta_keys(name: str) -> set[str]:
    source = GENERATED.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {name}:\s*Record<[^>]+>\s*=\s*\{{(.*?)\n\}}",
        source,
        re.DOTALL,
    )
    assert match, f"未找到生成产物 {name}"
    return set(re.findall(r"^\s{2}([A-Za-z_]+):", match.group(1), re.MULTILINE))


def _assert_labels_present(meta: dict[str, dict[str, str]]) -> None:
    for code, fields in meta.items():
        assert str(fields.get("label") or "").strip(), f"{code} 缺少中文 label"


def test_contract_status_catalog_matches_backend():
    assert set(CONTRACT_STATUS_META) == _CONTRACT_STATUSES
    _assert_labels_present(CONTRACT_STATUS_META)


def test_contract_status_generated_matches_catalog():
    assert set(CONTRACT_STATUS_META) == _generated_union("ContractStatus", "CONTRACT_STATUSES")
    assert set(CONTRACT_STATUS_META) == _generated_meta_keys("CONTRACT_STATUS_META")


def test_legacy_void_has_label():
    assert CONTRACT_STATUS_META["void"]["label"] == "已作废"
    assert re.search(
        r'void:\s*\{[^}]*label:\s*"已作废"',
        GENERATED.read_text(encoding="utf-8"),
    )


def test_contract_project_status_generated_matches_catalog():
    assert set(CONTRACT_PROJECT_STATUS_META) == _generated_union("ProjectStatus", "PROJECT_STATUSES")
    assert set(CONTRACT_PROJECT_STATUS_META) == _generated_meta_keys("PROJECT_STATUS_META")
    _assert_labels_present(CONTRACT_PROJECT_STATUS_META)


def test_project_stage_matches_backend_literal():
    assert set(PROJECT_STAGE_META) == set(get_args(ProjectStageLiteral))
    _assert_labels_present(PROJECT_STAGE_META)


def test_project_stage_generated_matches_catalog():
    assert set(PROJECT_STAGE_META) == _generated_union("ProjectStage", "PROJECT_STAGES")
    assert set(PROJECT_STAGE_META) == _generated_meta_keys("PROJECT_STAGE_META")


def test_contract_project_status_and_project_stage_are_distinct():
    """两个项目状态机不得混淆：合同遗留 projectStatus ≠ 交付项目阶段。"""
    assert set(CONTRACT_PROJECT_STATUS_META) != set(PROJECT_STAGE_META)


def test_project_health_matches_backend_literal():
    assert set(PROJECT_HEALTH_META) == set(get_args(ProjectHealthLiteral))
    _assert_labels_present(PROJECT_HEALTH_META)


def test_project_health_generated_matches_catalog():
    assert set(PROJECT_HEALTH_META) == _generated_union("ProjectHealth", "PROJECT_HEALTHS")
    assert set(PROJECT_HEALTH_META) == _generated_meta_keys("PROJECT_HEALTH_META")


def test_project_risk_matches_backend_literal():
    assert set(PROJECT_RISK_META) == set(get_args(ProjectRiskLiteral))
    _assert_labels_present(PROJECT_RISK_META)


def test_project_risk_generated_matches_catalog():
    assert set(PROJECT_RISK_META) == _generated_union("ProjectRisk", "PROJECT_RISKS")
    assert set(PROJECT_RISK_META) == _generated_meta_keys("PROJECT_RISK_META")


def test_project_note_kind_matches_backend_literal():
    assert set(PROJECT_NOTE_KIND_META) == set(get_args(ProjectNoteKindLiteral))
    for label in PROJECT_NOTE_KIND_META.values():
        assert str(label or "").strip(), "记录类型缺少中文 label"


def test_project_note_kind_generated_matches_catalog():
    assert set(PROJECT_NOTE_KIND_META) == _generated_union("ProjectNoteKind", "PROJECT_NOTE_KINDS")
    assert set(PROJECT_NOTE_KIND_META) == _generated_meta_keys("PROJECT_NOTE_KIND_META")
