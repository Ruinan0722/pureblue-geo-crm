"""项目管理：计算字段与合同建项触发。"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.modules.projects.service import compute_project_fields, should_ensure_project


def test_should_ensure_on_become_signed():
    assert should_ensure_project({"status": "pending"}, {"status": "signed"}, is_create=False)
    assert should_ensure_project(None, {"status": "signed"}, is_create=True)
    assert not should_ensure_project({"status": "signed"}, {"status": "signed"}, is_create=False)


def test_should_ensure_aux_not_started_when_signed():
    assert should_ensure_project(
        {"status": "signed", "projectStatus": "ongoing"},
        {"status": "signed", "projectStatus": "not_started"},
        is_create=False,
    )
    assert not should_ensure_project(
        {"status": "pending", "projectStatus": "ongoing"},
        {"status": "pending", "projectStatus": "not_started"},
        is_create=False,
    )


def test_compute_renewal_warning_boundary():
    today = date(2026, 7, 20)
    row = SimpleNamespace(
        intent_brand=1,
        intent_content=2,
        intent_search=3,
        sow_end_date=date(2026, 8, 19),  # 30 days
        stage="active",
    )
    out = compute_project_fields(row, today=today)  # type: ignore[arg-type]
    assert out["intent_total"] == 6
    assert out["days_to_sow_end"] == 30
    assert out["renewal_warning"] is True
    assert out["overdue"] is False

    row31 = SimpleNamespace(
        intent_brand=0,
        intent_content=0,
        intent_search=0,
        sow_end_date=date(2026, 8, 20),  # 31 days
        stage="active",
    )
    out31 = compute_project_fields(row31, today=today)  # type: ignore[arg-type]
    assert out31["days_to_sow_end"] == 31
    assert out31["renewal_warning"] is False


def test_compute_overdue():
    today = date(2026, 7, 20)
    row = SimpleNamespace(
        intent_brand=0,
        intent_content=0,
        intent_search=0,
        sow_end_date=date(2026, 7, 10),
        stage="active",
    )
    out = compute_project_fields(row, today=today)  # type: ignore[arg-type]
    assert out["overdue"] is True
    assert out["delay_duration_days"] == 10
    assert out["renewal_warning"] is False
