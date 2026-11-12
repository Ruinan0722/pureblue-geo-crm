"""合同序列化试点（阶段 E）：已列化字段/owners 子表为权威源。"""

from __future__ import annotations

from types import SimpleNamespace

from app.modules.crm.service.contracts import _contract_response


def test_contract_response_uses_columns_and_owners():
    row = SimpleNamespace(
        code="HT-20260807-001",
        name="测试合同",
        company="Acme",
        region="华东区",
        city="上海",
        geo_source="domestic",
        document={
            "id": "ct1",
            "customerId": "c1",
            "status": "pending",
            "code": "HT-20260807-001",
            "name": "测试合同",
            "company": "Acme",
            "region": "华东区",
            "city": "上海",
            "geoSource": "domestic",
            "type": "新签",
            "signType": "线上电子签",
            "amount": 100000,
        },
    )
    out = _contract_response(row, owners=["张三", "李四"])
    assert out["code"] == "HT-20260807-001"
    assert out["name"] == "测试合同"
    assert out["company"] == "Acme"
    assert out["region"] == "华东区"
    assert out["city"] == "上海"
    assert out["geoSource"] == "domestic"
    assert out["owners"] == ["张三", "李四"]
    assert out["type"] == "新签"
    # 未传入 attachments 时不得从已删 JSON 臆造；显式传入才写入
    assert "attachments" not in out or out.get("attachments") is None


def test_contract_response_composes_attachments_from_child_table():
    """删 document 列后 attachments 只存在子表；响应必须显式 compose，否则前端 .length 崩溃。"""
    row = SimpleNamespace(
        document={"id": "ct1", "name": "无附件字段的合同"},
        code="HT-1",
        name="无附件字段的合同",
        company=None,
        region=None,
        city=None,
        geo_source=None,
        type=None,
        sign_type=None,
        source=None,
        status_reason=None,
        project_status=None,
        signer=None,
        sign_subject=None,
        our_sign_subject=None,
        customer_sign_subject=None,
        signer_manager=None,
        dept=None,
        opportunity_id=None,
        owner=None,
        amount=None,
        valid_months=None,
        effective_date=None,
        dual_sign_date=None,
        end_date=None,
        created_day=None,
        status="pending",
    )
    out = _contract_response(row, owners=["销售"], attachments=[])
    assert out["attachments"] == []
    out2 = _contract_response(
        row,
        owners=["销售"],
        attachments=[{"id": "a1", "name": "ht.pdf", "kind": "contract"}],
    )
    assert out2["attachments"][0]["id"] == "a1"
