"""线索转客户：公司名归一化与挂靠合并。"""

from __future__ import annotations

from app.modules.crm.repository import company_name_match_kind, normalize_company_name_key
from app.modules.crm.service import (
    _carry_lead_attachments_to_customer,
    _lead_wechat_added,
    _merge_lead_into_existing_customer,
)


def test_normalize_company_name_key_strips_spaces_and_case():
    assert normalize_company_name_key("  Foo  Bar  ") == normalize_company_name_key("foo bar")
    assert normalize_company_name_key("测试　公司") == normalize_company_name_key("测试公司")
    assert normalize_company_name_key("") == ""


def test_company_name_match_kind_exact():
    assert company_name_match_kind("字节跳动", "字节跳动") == "exact"
    assert company_name_match_kind("  ByteDance  ", "bytedance") == "exact"


def test_company_name_match_kind_partial_bidirectional():
    assert company_name_match_kind("字节", "字节跳动") == "partial"
    assert company_name_match_kind("字节跳动", "字节") == "partial"
    assert company_name_match_kind("Byte", "ByteDance") == "partial"


def test_company_name_match_kind_partial_after_suffix_and_core():
    """触达信息有限公司 ↔ 未触达科技有限公司：去后缀/通用词后核心「触达」重叠。"""
    assert company_name_match_kind("触达信息有限公司", "未触达科技有限公司") == "partial"
    assert company_name_match_kind("未触达科技有限公司", "触达信息有限公司") == "partial"
    assert company_name_match_kind("触达信息有限公司", "触达科技有限公司") == "partial"


def test_company_name_match_kind_rejects_short_and_unrelated():
    assert company_name_match_kind("字", "字节跳动") is None
    assert company_name_match_kind("字节跳动", "阿里巴巴") is None
    assert company_name_match_kind("", "字节跳动") is None
    assert company_name_match_kind("字节跳动", "") is None
    # 仅共享通用词「信息」不应命中
    assert company_name_match_kind("华夏信息有限公司", "远航信息有限公司") is None


def test_company_name_partial_needles_include_core_grams():
    from app.modules.crm.repository import company_name_partial_needles

    needles = company_name_partial_needles("触达信息有限公司")
    assert "触达" in needles


def test_lead_wechat_from_lead_or_notes():
    assert _lead_wechat_added({"wechatAdded": True}, []) is True
    assert _lead_wechat_added({}, [{"wechatAdded": True}]) is True
    assert _lead_wechat_added({}, [{"wechatAdded": False}]) is False


def test_carry_lead_attachment_uses_unique_record_id_and_keeps_source_id():
    source_id = "4c1357f0-d0f7-45d8-8dbc-d0714ae0d1f2.png"
    carried = _carry_lead_attachments_to_customer(
        [
            {
                "id": source_id,
                "name": "跟进截图.png",
                "url": f"/api/crm/attachments/{source_id}",
            }
        ],
        lead_id="lead1",
    )

    assert len(carried) == 1
    assert carried[0]["id"] != source_id
    assert carried[0]["id"].endswith(".png")
    assert carried[0]["sourceLeadAttachmentId"] == source_id
    assert carried[0]["url"] == f"/api/crm/attachments/{carried[0]['id']}"


def test_merge_lead_attachment_is_idempotent_by_source_id():
    source_id = "4c1357f0-d0f7-45d8-8dbc-d0714ae0d1f2.png"
    customer = {
        "contacts": [],
        "notes": [],
        "attachments": [
            {
                "id": "logical-existing.png",
                "name": "跟进截图.png",
                "sourceLeadAttachmentId": source_id,
            }
        ],
    }
    lead = {
        "notes": [],
        "attachments": [{"id": source_id, "name": "跟进截图.png"}],
    }

    merged = _merge_lead_into_existing_customer(customer, lead=lead, lead_id="lead1")

    assert len(merged["attachments"]) == 1


def test_merge_lead_adds_contact_and_notes():
    customer = {
        "companyName": "测试公司",
        "contacts": [{"id": "ct1", "name": "张三", "phone": "13800000001", "wechatAdded": False}],
        "notes": [],
        "attachments": [],
    }
    lead = {
        "contactName": "李四",
        "contactTitle": "经理",
        "contactPhone": "13900000002",
        "contactWechat": "",
        "email": "a@b.com",
        "wechatAdded": True,
        "notes": [{"id": "ln1", "author": "SDR", "content": "已建联", "date": "2026-07-31", "wechatAdded": False}],
        "attachments": [],
    }
    merged = _merge_lead_into_existing_customer(customer, lead=lead, lead_id="lead1")
    assert len(merged["contacts"]) == 2
    assert merged["contacts"][1]["name"] == "李四"
    assert merged["contacts"][1]["wechatAdded"] is True
    assert len(merged["notes"]) == 1
    assert merged["notes"][0]["origin"] == "lead"
    assert merged["notes"][0]["sourceLeadId"] == "lead1"


def test_merge_lead_updates_existing_contact_wechat():
    customer = {
        "contacts": [{"id": "ct1", "name": "李四", "phone": "13900000002", "title": "", "wechatAdded": False}],
        "notes": [],
        "attachments": [],
    }
    lead = {
        "contactName": "李四",
        "contactPhone": "13900000002",
        "contactWechat": "",
        "contactTitle": "总监",
        "email": "",
        "wechatAdded": True,
        "notes": [],
        "attachments": [],
    }
    merged = _merge_lead_into_existing_customer(customer, lead=lead, lead_id="lead1")
    assert len(merged["contacts"]) == 1
    assert merged["contacts"][0]["wechatAdded"] is True
    assert merged["contacts"][0]["title"] == "总监"
