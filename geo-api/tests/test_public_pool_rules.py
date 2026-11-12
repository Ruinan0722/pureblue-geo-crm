from datetime import datetime
from types import SimpleNamespace

from app.modules.auth.schemas import AuthUser
from app.modules.crm.service.public_pool import (
    PublicPoolMixin,
    _normalize_pool_region,
    _regions_from_names,
)


def _user(*permissions: str) -> AuthUser:
    return AuthUser(
        id="u-sales",
        feishu_open_id="ou_sales",
        name="测试销售",
        role="sales",
        permissions=list(permissions),
        department_names=["销售管理中心 > 销售部 > 华东"],
    )


def test_region_normalization_and_department_mapping():
    assert _normalize_pool_region("华东") == "华东区"
    assert _normalize_pool_region("华南区") == "华南区"
    assert _regions_from_names(["销售管理中心 > 华北", "华东销售组"]) == {
        "华北区",
        "华东区",
    }


def test_public_pool_list_item_never_serializes_contacts_or_attachments():
    mixin = PublicPoolMixin()
    user = _user("section:public_pool", "public_pool:claim")
    entry = SimpleNamespace(
        id="pp-1",
        status="available",
        region="华东区",
        released_at=datetime(2026, 8, 20, 9, 0),
        release_reason="暂时无跟进计划",
    )
    customer = SimpleNamespace(
        id="c-1",
        company_name="示例公司",
        brand_name="",
        city="上海",
        industry_l1="软件",
        industry_l2="SaaS",
        founded_date=None,
        credit_code="",
        registered_capital=100,
        annual_revenue=500,
        scale="50-100 人",
        nature="民营企业",
        source="自拓",
        source_detail="",
        contacts=[{"phone": "13800000000"}],
        attachments=[{"name": "敏感文件.pdf"}],
    )
    doc = mixin._public_pool_item(user, entry, customer, [])
    assert doc["contactHint"] == "认领成功后可见"
    assert doc["canClaim"] is True
    assert "contacts" not in doc
    assert "attachments" not in doc
    assert "phone" not in str(doc)


def test_pending_customer_cannot_be_claimed_again():
    mixin = PublicPoolMixin()
    user = _user("section:public_pool", "public_pool:claim")
    entry = SimpleNamespace(
        id="pp-1",
        status="pending_review",
        region="华东区",
        released_at=datetime(2026, 8, 20, 9, 0),
        release_reason="释放",
    )
    customer = SimpleNamespace(
        id="c-1", company_name="示例公司", brand_name="", city="", industry_l1="",
        industry_l2="", founded_date=None, credit_code="", registered_capital=0,
        annual_revenue=0, scale="", nature="", source="", source_detail="",
    )
    claim = SimpleNamespace(
        id="pc-1", applicant_user_id="u-other", applicant_name="其他销售",
        status="pending_review", review_reason=None, reviewer_name=None,
        applied_at=datetime(2026, 8, 20, 10, 0), reviewed_at=None,
    )
    doc = mixin._public_pool_item(user, entry, customer, [claim])
    assert doc["canClaim"] is False
    assert doc["pendingApplication"]["id"] == "pc-1"
