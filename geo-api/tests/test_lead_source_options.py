from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.exceptions import PermissionDeniedError, ValidationError
from app.modules.crm.router import (
    _assert_source_option_manager,
    _assert_source_option_reader,
    _assert_valid_source_option_input,
)
from app.modules.crm.schemas import (
    LeadSourceOptionCreateBody,
    LeadSourceOptionDeleteBody,
    LeadSourceOptionUpdateBody,
)
from app.modules.crm.service import CrmService


def test_only_explicit_manager_can_maintain_options():
    with pytest.raises(PermissionDeniedError):
        _assert_source_option_manager(SimpleNamespace(permissions=["section:leads"]))
    _assert_source_option_manager(
        SimpleNamespace(permissions=["section:leads", "lead_source_options:manage"])
    )


def test_sales_customer_editor_can_read_source_options_without_lead_navigation():
    _assert_source_option_reader(
        SimpleNamespace(permissions=["section:customers", "customers:write"])
    )
    with pytest.raises(PermissionDeniedError):
        _assert_source_option_reader(SimpleNamespace(permissions=["section:customers"]))


def test_offline_meeting_removed_from_meeting_primary_sources():
    from app.modules.contracts.status_catalog import LEAD_SOURCES, MEETING_PRIMARY_SOURCES

    assert "线下会议" not in LEAD_SOURCES
    assert "线下会议" not in MEETING_PRIMARY_SOURCES
    assert MEETING_PRIMARY_SOURCES == ["三方会议", "自办会议"]


def test_meeting_create_requires_date_and_organizer():
    with pytest.raises(ValidationError, match="会议开始日期不能为空"):
        _assert_valid_source_option_input("三方会议", None, "清蓝")
    with pytest.raises(ValidationError, match="会议主办方不能为空"):
        _assert_valid_source_option_input("三方会议", "2026-08-05", None)
    _assert_valid_source_option_input("三方会议", "2026-08-05", "清蓝")


def test_institution_create_only_requires_name():
    body = LeadSourceOptionCreateBody(
        primarySource="机构引荐",
        name="ToBCGO",
    )
    assert body.start_date is None
    assert body.organizer is None
    _assert_valid_source_option_input("机构引荐", None, None)


def test_create_rejects_unknown_primary_source():
    with pytest.raises(ValidationError, match="仅支持维护会议类或机构引荐"):
        _assert_valid_source_option_input("官网注册", "2026-08-05", "官网")


def test_meeting_create_body_still_accepts_full_fields():
    body = LeadSourceOptionCreateBody(
        primarySource="三方会议",
        startDate="2026-08-05",
        name="AI 峰会",
        organizer="清蓝",
    )
    assert body.start_date.isoformat() == "2026-08-05"


def test_display_name_falls_back_to_name_without_date():
    from datetime import date

    from app.models.crm import LeadSourceOption

    plain = LeadSourceOption(
        id="x1",
        primary_source="机构引荐",
        start_date=None,
        name="ToBCGO",
        organizer=None,
        enabled=True,
        sort_order=0,
        created_at=date(2026, 8, 1),
        updated_at=date(2026, 8, 1),
    )
    assert plain.display_name == "ToBCGO"

    meeting = LeadSourceOption(
        id="x2",
        primary_source="三方会议",
        start_date=date(2026, 8, 5),
        name="AI 峰会",
        organizer="清蓝",
        enabled=True,
        sort_order=0,
        created_at=date(2026, 8, 1),
        updated_at=date(2026, 8, 1),
    )
    assert meeting.display_name == "2026.08.05 AI 峰会"


def test_deletion_reason_is_required():
    with pytest.raises(PydanticValidationError):
        LeadSourceOptionDeleteBody(reason="")


def test_meeting_update_allows_renaming():
    body = LeadSourceOptionUpdateBody(name="AI 营销增长大会")
    assert body.name == "AI 营销增长大会"
    with pytest.raises(PydanticValidationError):
        LeadSourceOptionUpdateBody(name="")


@pytest.mark.asyncio
async def test_meeting_source_requires_enabled_configured_option():
    db = AsyncMock()
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=list))
    db.execute.return_value = result
    service = CrmService(db)

    with pytest.raises(ValidationError, match="请选择具体会议名称"):
        await service._validate_lead_source_option(
            {"source": "三方会议", "sourceDetail": ""}
        )
    with pytest.raises(ValidationError, match="不在可选列表"):
        await service._validate_lead_source_option(
            {"source": "三方会议", "sourceDetail": "未配置会议"}
        )


@pytest.mark.asyncio
async def test_meeting_source_accepts_enabled_configured_option():
    db = AsyncMock()
    option = SimpleNamespace(display_name="2026.08.05 上海 AI 峰会")
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [option]))
    db.execute.return_value = result
    await CrmService(db)._validate_lead_source_option(
        {"source": "三方会议", "sourceDetail": "2026.08.05 上海 AI 峰会"}
    )


@pytest.mark.asyncio
async def test_non_meeting_source_does_not_require_dictionary():
    db = AsyncMock()
    await CrmService(db)._validate_lead_source_option(
        {"source": "官网注册", "sourceDetail": ""}
    )
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_institution_source_requires_enabled_configured_option():
    db = AsyncMock()
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=list))
    db.execute.return_value = result
    service = CrmService(db)

    with pytest.raises(ValidationError, match="请选择具体机构"):
        await service._validate_lead_source_option({"source": "机构引荐", "sourceDetail": ""})
    with pytest.raises(ValidationError, match="不在可选列表"):
        await service._validate_lead_source_option(
            {"source": "机构引荐", "sourceDetail": "未配置机构"}
        )


@pytest.mark.asyncio
async def test_institution_source_accepts_enabled_configured_option():
    db = AsyncMock()
    option = SimpleNamespace(display_name="ToBCGO")
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [option]))
    db.execute.return_value = result
    await CrmService(db)._validate_lead_source_option(
        {"source": "机构引荐", "sourceDetail": "ToBCGO"}
    )
