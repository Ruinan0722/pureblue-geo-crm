"""国内 / 海外填报服务端校验分支。"""

from __future__ import annotations

import pytest

from app.core.exceptions import ValidationError
from app.modules.requests.validation import (
    is_domestic_intake_data,
    validate_intake_data,
)


def _overseas_ok(**overrides):
    base = {
        "companyName": "Acme",
        "contactName": "Tom",
        "contactTitle": "PM",
        "contactPhone": "+1 415-555-0100",
        "brandName": "Acme",
        "targetCustomer": "toc",
        "scopeType": "brand_only",
        "hasOverseasSite": "no",
        "regions": [{"platform": "ChatGPT", "country": "US", "language": "en"}],
        "platforms": ["ChatGPT"],
        "intentType": "clear",
        "intentQuestions": [{"text": "best crm"}],
        "goal": "recommend",
        "goals": ["recommend"],
        "importMeta": {"source": "海外GEO需求"},
    }
    base.update(overrides)
    return base


def _domestic_ok(**overrides):
    base = {
        "companyName": "测试公司",
        "contactName": "张三",
        "contactTitle": "经理",
        "contactPhone": "13800138000",
        "brandName": "测试品牌",
        "scopeType": "brand_only",
        "hasOverseasSite": "no",
        "targetCustomer": "toc",
        "platforms": ["豆包", "DeepSeek"],
        "brandCompetitors": ["竞品A"],
        "intentType": "clear",
        "intentQuestions": [{"text": "什么是最好的 CRM"}],
        "optimizePeriod": "3",
        "expectedStartDate": "2026-08-01",
        "goals": ["recommend_60", "content"],
        "budget": "30 万元",
        "strengthMarket": "行业头部客户案例",
        "importMeta": {"source": "国内GEO需求"},
        "regions": [{"country": "CN", "language": "zh"}],
    }
    base.update(overrides)
    return base


def test_detect_domestic_by_source():
    assert is_domestic_intake_data(_domestic_ok())
    assert not is_domestic_intake_data(_overseas_ok())


def test_detect_domestic_by_goals_without_source():
    data = _domestic_ok()
    data.pop("importMeta")
    assert is_domestic_intake_data(data)


def test_overseas_passes():
    validate_intake_data(_overseas_ok())


def test_domestic_passes():
    validate_intake_data(_domestic_ok())


def test_domestic_specific_product_only_requires_name():
    validate_intake_data(
        _domestic_ok(
            scopeType="specific",
            products=[{"id": "p1", "name": "测试产品", "fn": "", "users": "", "scenario": ""}],
        )
    )
    with pytest.raises(ValidationError, match="产品或服务名称"):
        validate_intake_data(_domestic_ok(scopeType="specific", products=[{"name": ""}]))


def test_domestic_rejects_overseas_goal_field():
    data = _domestic_ok()
    data["goals"] = []
    data["goal"] = "recommend"
    with pytest.raises(ValidationError, match="优化目标"):
        validate_intake_data(data)


def test_domestic_requires_cn_phone():
    with pytest.raises(ValidationError, match="手机号"):
        validate_intake_data(_domestic_ok(contactPhone="+1 415-555-0100"))


def test_domestic_requires_period_and_start():
    with pytest.raises(ValidationError, match="周期"):
        validate_intake_data(_domestic_ok(optimizePeriod=""))
    with pytest.raises(ValidationError, match="执行时间"):
        validate_intake_data(_domestic_ok(expectedStartDate=""))


def test_domestic_accepts_custom_period():
    validate_intake_data(_domestic_ok(optimizePeriod="custom", optimizePeriodCustom="9个月"))
    with pytest.raises(ValidationError, match="自定义优化周期"):
        validate_intake_data(_domestic_ok(optimizePeriod="custom", optimizePeriodCustom=""))


def test_domestic_requires_competitors():
    with pytest.raises(ValidationError, match="竞品"):
        validate_intake_data(_domestic_ok(brandCompetitors=[]))
    with pytest.raises(ValidationError, match="竞品"):
        validate_intake_data(_domestic_ok(brandCompetitors=["  "]))


def test_domestic_optional_fields_may_be_blank():
    validate_intake_data(
        _domestic_ok(
            hasOverseasSite="",
            targetCustomer="",
            budget="",
            strengthMarket="",
            strengthTech="",
            strengthBrand="",
            strengthEcosystem="",
            strengthOther="",
        )
    )


def test_domestic_rejects_invalid_platform():
    with pytest.raises(ValidationError, match="AI 平台"):
        validate_intake_data(_domestic_ok(platforms=["ChatGPT"]))


def test_overseas_still_requires_goal_and_regions():
    with pytest.raises(ValidationError, match="优化目标"):
        validate_intake_data(_overseas_ok(goal="", goals=[]))
    with pytest.raises(ValidationError, match="ChatGPT"):
        validate_intake_data(_overseas_ok(regions=[]))


def test_overseas_allows_source_plus_one_recommendation_goal():
    validate_intake_data(_overseas_ok(goal="source", goals=["source", "top3"]))
    with pytest.raises(ValidationError, match="推荐率指标只能选择一项"):
        validate_intake_data(_overseas_ok(goals=["source", "recommend", "priority"]))


def test_overseas_requires_regions_for_each_selected_platform():
    validate_intake_data(
        _overseas_ok(
            platforms=["ChatGPT", "Gemini"],
            regions=[
                {"platform": "ChatGPT", "country": "US", "language": "en"},
                {"platform": "Gemini", "country": "TW", "language": "zh-Hant"},
            ],
        )
    )
    with pytest.raises(ValidationError, match="Gemini"):
        validate_intake_data(
            _overseas_ok(
                platforms=["ChatGPT", "Gemini"],
                regions=[{"platform": "ChatGPT", "country": "US", "language": "en"}],
            )
        )


def test_overseas_requires_target_customer():
    with pytest.raises(ValidationError, match="目标用户"):
        validate_intake_data(_overseas_ok(targetCustomer=""))
    with pytest.raises(ValidationError, match="目标用户"):
        validate_intake_data(_overseas_ok(targetCustomer="B端"))


def test_target_customer_accepts_toc_tob_and_both():
    validate_intake_data(_overseas_ok(targetCustomer="tob"))
    validate_intake_data(_domestic_ok(targetCustomer="both"))
    validate_intake_data(_overseas_ok(targetCustomer="both"))
