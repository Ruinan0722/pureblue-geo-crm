"""飞书线索映射单测。"""

from app.modules.crm.feishu_lead_mapper import map_feishu_dump, map_feishu_record


def _record(record_id: str, **fields):
    return {"record_id": record_id, "fields": fields}


def test_map_normal_geo_lead():
    doc = map_feishu_record(
        _record(
            "recSample001",
            **{
                "id": "3485",
                "品牌名称/公司名称": [{"text": "浙江森马服饰股份有限公司", "type": "text"}],
                "公司名称": [{"text": "浙江森马服饰股份有限公司", "type": "text"}],
                "客户姓名": [{"text": "闻澜", "type": "text"}],
                "联系人": [{"text": "闻澜", "type": "text"}],
                "电话": [{"text": "18258179136", "type": "text"}],
                "职务": [{"text": "电商事业部经理", "type": "text"}],
                "部门": "电商",
                "城市": [{"text": "杭州", "type": "text"}],
                "区域": "华东区",
                "landingpage": "官网",
                "来源二级": [{"text": "企业微信", "type": "text"}],
                "官网": {"link": "https://www.semirbiz.com", "text": "www.semirbiz.com", "type": "url"},
                "线索等级": "A",
                "跟进状态": "需要跟进",
                "是否加企微": "是",
                "跟进记录": [{"text": "GEO需求：了解方案", "type": "text"}],
                "SDR": [{"name": "演示成员04"}],
                "销售": [{"name": "演示成员09"}],
                "录入日期": 1785139933068,
                "首次触达时间": 1785139933068,
            },
        ),
        imported_at="2026-07-27 17:00:00",
    )
    assert doc is not None
    assert doc["id"] == "l-fs-recSample001"
    assert doc["companyName"] == "浙江森马服饰股份有限公司"
    assert doc["source"] == "官网注册"
    assert doc["sourceDetail"] == "企业微信"
    assert doc["website"] == "www.semirbiz.com"
    assert doc["level"] == "A"
    assert doc["followState"] == "need"
    assert doc["status"] == "touched"
    assert doc["wechatAdded"] is True
    assert doc["contactDepartment"] == "电商"
    assert doc["importMeta"]["feishuRecordId"] == "recSample001"
    assert doc["notes"][0]["wechatAdded"] is True


def test_map_agent_keeps_level():
    doc = map_feishu_record(
        _record(
            "recAgent1",
            **{
                "品牌名称/公司名称": [{"text": "某某代理公司", "type": "text"}],
                "客户姓名": [{"text": "张三", "type": "text"}],
                "线索等级": "代理",
                "跟进状态": "无需跟进",
                "跟进记录": [{"text": "渠道让注册的", "type": "text"}],
                "landingpage": "官网",
            },
        )
    )
    assert doc is not None
    assert doc["level"] == "代理"
    assert doc["status"] == "touched"
    assert doc["followState"] == "no_need"
    assert doc.get("invalidReason") in (None, "")
    assert doc["source"] == "渠道伙伴"


def test_map_overseas_level_to_region():
    doc = map_feishu_record(
        _record(
            "recOversea1",
            **{
                "品牌名称/公司名称": [{"text": "sunlu", "type": "text"}],
                "客户姓名": [{"text": "李四", "type": "text"}],
                "线索等级": "海外",
                "跟进记录": [{"text": "做海外市场 GPT", "type": "text"}],
                "landingpage": "官网",
            },
        )
    )
    assert doc is not None
    assert doc["region"] == "海外"
    assert doc["level"] == "海外"
    assert doc["status"] == "touched"


def test_map_36kr_alias_and_brand_fallback():
    doc = map_feishu_record(
        _record(
            "rec36",
            **{
                "品牌名称/公司名称": [{"text": "铱云", "type": "text"}],
                "公司名称": [{"text": "深圳市铱云云计算有限公司", "type": "text"}],
                "客户姓名": [{"text": "王五", "type": "text"}],
                "landingpage": "36Kr",
            },
        )
    )
    assert doc is not None
    assert doc["companyName"] == "深圳市铱云云计算有限公司"
    assert doc["brandName"] == "铱云"
    assert doc["source"] == "官网注册"
    assert doc["sourceDetail"] == "36氪"
    assert doc["status"] == "untouched"


def test_map_empty_fields_stay_empty():
    """飞书为空即置空：landingpage / 销售 / 官网占位 不落默认值。"""
    doc = map_feishu_record(
        _record(
            "recEmpty1",
            **{
                "品牌名称/公司名称": [{"text": "空字段公司", "type": "text"}],
                "客户姓名": [{"text": "王五", "type": "text"}],
                "官网": {"link": "http://*用户未填写", "text": "*用户未填写", "type": "url"},
            },
        )
    )
    assert doc is not None
    assert doc["source"] == ""
    assert doc["sourceDetail"] == ""
    assert doc["sales"] == ""
    assert doc["website"] == ""


def test_map_dump_skips_empty_company():
    dump = {
        "records": [
            _record("recOk", **{"品牌名称/公司名称": [{"text": "有公司", "type": "text"}]}),
            _record("recBad"),
        ]
    }
    docs, report = map_feishu_dump(dump)
    assert len(docs) == 1
    assert report["skipped_empty_company"] == 1
    assert report["mapped"] == 1
