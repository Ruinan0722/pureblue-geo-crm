from __future__ import annotations

import re
from typing import Any

from app.core.exceptions import ValidationError
from app.modules.contracts.status_catalog import (
    INTAKE_DOMESTIC_AI_PLATFORMS,
    INTAKE_DOMESTIC_GOALS,
    INTAKE_OPTIMIZE_PERIODS,
    INTAKE_OVERSEAS_GOALS,
)

_PHONE_RE_CN = re.compile(r"^1[3-9]\d{9}$")
_PHONE_RE_INTL = re.compile(r"^\+?[\d\s\-()]{7,20}$")
_URL_RE = re.compile(r"^https?://.+\..+")

# 表单校验集合从唯一权威源 status_catalog.py 派生。
_VALID_OVERSEAS_GOALS = frozenset(INTAKE_OVERSEAS_GOALS)
_VALID_DOMESTIC_GOALS = frozenset(goal["value"] for goal in INTAKE_DOMESTIC_GOALS)
_VALID_DOMESTIC_PERIODS = frozenset(period["value"] for period in INTAKE_OPTIMIZE_PERIODS)
_VALID_DOMESTIC_PLATFORMS = frozenset(INTAKE_DOMESTIC_AI_PLATFORMS)


def _txt(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _product_complete(product: dict[str, Any]) -> bool:
    return all(_txt(product.get(key)) for key in ("name", "fn", "users", "scenario"))


def _import_source(data: dict[str, Any]) -> str:
    meta = data.get("importMeta")
    if isinstance(meta, dict):
        return _txt(meta.get("source"))
    return ""


def is_domestic_intake_data(data: dict[str, Any]) -> bool:
    """与前端 stampGeoVariant / isDomesticFormData 对齐。"""
    source = _import_source(data)
    if source == "国内GEO需求":
        return True
    if source == "海外GEO需求":
        return False
    variant = _txt(data.get("geoVariant"))
    if variant == "domestic":
        return True
    if variant == "overseas":
        return False
    return bool(_txt(data.get("optimizePeriod")) or _txt(data.get("expectedStartDate")))


def _validate_shared_contact_and_brand(
    data: dict[str, Any],
    *,
    phone_cn_only: bool,
) -> None:
    if not _txt(data.get("companyName")):
        raise ValidationError("请填写公司名称")
    if not _txt(data.get("contactName")):
        raise ValidationError("请填写联系人姓名")
    if not _txt(data.get("contactTitle")):
        raise ValidationError("请填写联系人职位")
    phone = _txt(data.get("contactPhone"))
    if not phone:
        raise ValidationError("请填写手机号")
    if phone_cn_only:
        if not _PHONE_RE_CN.match(phone):
            raise ValidationError("手机号格式不正确")
    elif not (_PHONE_RE_CN.match(phone) or _PHONE_RE_INTL.match(phone)):
        raise ValidationError("手机号格式不正确")
    if not _txt(data.get("brandName")):
        raise ValidationError("请填写品牌名称")

    scope_type = data.get("scopeType")
    if scope_type not in ("brand_only", "specific"):
        raise ValidationError("请选择本次优化范围")
    if scope_type == "specific":
        products = data.get("products")
        if not isinstance(products, list) or not products:
            raise ValidationError("请完整填写每个产品或服务的名称、功能、用户群体与应用场景")
        if not all(isinstance(p, dict) and _product_complete(p) for p in products):
            raise ValidationError("请完整填写每个产品或服务的名称、功能、用户群体与应用场景")


def _validate_site(
    data: dict[str, Any],
    *,
    choose_msg: str,
    missing_url_msg: str,
    required: bool = True,
) -> None:
    has_site = data.get("hasOverseasSite")
    if not required and has_site in (None, ""):
        return
    if has_site not in ("yes", "no"):
        raise ValidationError(choose_msg)
    if has_site == "yes":
        url = _txt(data.get("overseasSiteUrl"))
        if not url:
            raise ValidationError(missing_url_msg)
        if not _URL_RE.match(url):
            raise ValidationError("请输入完整有效的网址（含 http/https）")


def _validate_intent(
    data: dict[str, Any],
    *,
    choose_msg: str,
    clear_msg: str,
    rough_msg: str,
) -> None:
    intent_type = data.get("intentType")
    if intent_type not in ("clear", "rough"):
        raise ValidationError(choose_msg)
    intent_key = "intentQuestions" if intent_type == "clear" else "intentRoughItems"
    intent_items = data.get(intent_key)
    if not isinstance(intent_items, list) or not any(
        isinstance(item, dict) and _txt(item.get("text")) for item in intent_items
    ):
        raise ValidationError(clear_msg if intent_type == "clear" else rough_msg)


def validate_overseas_intake_data(data: dict[str, Any]) -> None:
    _validate_shared_contact_and_brand(data, phone_cn_only=False)
    target_customer = data.get("targetCustomer")
    if target_customer not in ("toc", "tob", "both"):
        raise ValidationError("请选择品牌核心目标用户")
    _validate_site(
        data,
        choose_msg="请选择是否有海外官网",
        missing_url_msg="请填写海外官网地址",
    )

    platforms = data.get("platforms")
    if not isinstance(platforms, list) or not platforms:
        raise ValidationError("请至少选择一个 AI 平台")
    if not all(isinstance(platform, str) and platform in {"ChatGPT", "Gemini"} for platform in platforms):
        raise ValidationError("请选择有效的 AI 平台")

    regions = data.get("regions")
    if not isinstance(regions, list):
        raise ValidationError("请为每个已选平台添加国家与语言")
    for platform in platforms:
        if not any(
            isinstance(region, dict)
            and _txt(region.get("platform")) == platform
            and _txt(region.get("country"))
            and _txt(region.get("language"))
            for region in regions
        ):
            raise ValidationError(f"请为 {platform} 至少添加一组完整的国家与语言")
    if any(
        isinstance(region, dict)
        and _txt(region.get("platform"))
        and _txt(region.get("platform")) not in platforms
        for region in regions
    ):
        raise ValidationError("国家与语言配置包含未选择的平台")

    _validate_intent(
        data,
        choose_msg="请选择「明确问题」或「业务方向」，并填写至少一条对应内容",
        clear_msg="请选择「明确问题」或「业务方向」，并填写至少一条对应内容",
        rough_msg="请选择「明确问题」或「业务方向」，并填写至少一条对应内容",
    )

    goals = data.get("goals")
    if not isinstance(goals, list) or not goals:
        legacy_goal = data.get("goal")
        goals = [legacy_goal] if legacy_goal else []
    if not goals or not all(isinstance(goal, str) and goal in _VALID_OVERSEAS_GOALS for goal in goals):
        raise ValidationError("请选择有效的优化目标")
    recommendation_goals = [goal for goal in goals if goal in {"recommend", "top3", "priority"}]
    if len(recommendation_goals) > 1:
        raise ValidationError("推荐率指标只能选择一项")


def validate_domestic_intake_data(data: dict[str, Any]) -> None:
    """对齐前端 validateDomesticIntakeForm / 飞书国内问卷。"""
    # 国内需求单的具体产品 / 服务只要求名称；海外仍校验完整介绍。
    domestic_data = dict(data)
    if domestic_data.get("scopeType") == "specific":
        domestic_data["scopeType"] = "brand_only"
    _validate_shared_contact_and_brand(domestic_data, phone_cn_only=True)
    if data.get("scopeType") == "specific":
        products = data.get("products")
        if not isinstance(products, list) or not products or not all(
            isinstance(product, dict) and _txt(product.get("name")) for product in products
        ):
            raise ValidationError("请填写产品或服务名称")
    _validate_site(
        data,
        choose_msg="请选择是否有国内官网",
        missing_url_msg="请填写官网地址",
        required=False,
    )

    _validate_intent(
        data,
        choose_msg="请选择意图问句或核心词方式，并填写至少一条对应内容",
        clear_msg="请至少填写一条明确的意图问句",
        rough_msg="请至少填写一条核心词 / 品牌词",
    )

    platforms = data.get("platforms")
    if not isinstance(platforms, list) or not platforms:
        raise ValidationError("请至少选择一个 AI 平台")
    if not all(isinstance(p, str) and p in _VALID_DOMESTIC_PLATFORMS for p in platforms):
        raise ValidationError("请选择有效的 AI 平台（豆包、DeepSeek、元宝、千问）")

    competitors = data.get("brandCompetitors")
    if not isinstance(competitors, list) or not any(
        isinstance(c, str) and _txt(c) for c in competitors
    ):
        raise ValidationError("请至少填写一个竞品")

    period = _txt(data.get("optimizePeriod"))
    if period not in _VALID_DOMESTIC_PERIODS:
        raise ValidationError("请选择希望优化的周期")
    if period == "custom" and not _txt(data.get("optimizePeriodCustom")):
        raise ValidationError("请填写自定义优化周期")

    if not _txt(data.get("expectedStartDate")):
        raise ValidationError("请选择预计执行时间")

    goals = data.get("goals")
    if not isinstance(goals, list) or not goals:
        raise ValidationError("请至少选择一个优化目标")
    if not all(isinstance(g, str) and g in _VALID_DOMESTIC_GOALS for g in goals):
        raise ValidationError("请选择有效的优化目标")


def validate_intake_data(data: dict[str, Any]) -> None:
    if is_domestic_intake_data(data):
        validate_domestic_intake_data(data)
    else:
        validate_overseas_intake_data(data)
