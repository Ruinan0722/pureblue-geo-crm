"""跟进记录按日期拆条单测。"""

from app.modules.crm.follow_up_notes import split_follow_up_text


def test_no_date_stays_single():
    text = "GEO需求：优化品牌，拉群对接介绍产品方案和报价"
    parts = split_follow_up_text(text, fallback_date="2026-07-01")
    assert len(parts) == 1
    assert parts[0]["date"] == "2026-07-01"
    assert parts[0]["content"] == text


def test_multiline_month_day_newest_first():
    text = """6月29日，微信上和向老师沟通表示目前就是卡在蒋总这里
6月11日，发现古方五红这个品找了陈妍希代言
4月20日首次沟通，预计5月7日比选，本周内发比选评分标准"""
    parts = split_follow_up_text(text, fallback_date="2026-07-01")
    assert len(parts) == 3
    assert parts[0]["date"] == "2026-06-29"
    assert parts[1]["date"] == "2026-06-11"
    assert parts[2]["date"] == "2026-04-20"
    # 「预计5月7日」不应再拆
    assert "预计5月7日比选" in parts[2]["content"]


def test_full_iso_date_line():
    text = "2026-07-27 没找到客户微信群，电话联系系统中的联系人不接电话"
    parts = split_follow_up_text(text, fallback_date="2026-01-01")
    assert len(parts) == 1
    assert parts[0]["date"] == "2026-07-27"


def test_inline_dot_dates_split():
    text = (
        "6.10每天给客户发监控截图，保持跟进6.3保持跟进，我给客户针对一个意图做监控"
        "5.13线上沟通了，因为客户不着急做"
    )
    parts = split_follow_up_text(text, fallback_date="2026-07-01")
    assert len(parts) >= 3
    assert parts[0]["date"] == "2026-06-10"
    assert parts[1]["date"] == "2026-06-03"
    assert parts[2]["date"] == "2026-05-13"


def test_amount_not_treated_as_date():
    text = "预算大概是5万一个月，诊断费用1.5万左右，持续跟进"
    parts = split_follow_up_text(text, fallback_date="2026-07-01")
    assert len(parts) == 1


def test_preface_without_date():
    text = """方案和报价给了 内部需要考虑一下
6月16日沟通5万预算，找立新确认报价
6月9日，表示领导最近在忙"""
    parts = split_follow_up_text(text, fallback_date="2026-07-20")
    assert len(parts) == 3
    assert parts[0]["date"] == "2026-07-20"
    assert "方案和报价" in parts[0]["content"]
    assert parts[1]["date"] == "2026-06-16"
    assert parts[2]["date"] == "2026-06-09"


def test_mmdd_compact_dates():
    text = (
        "0122-客户反馈知乎文章不合作；0115-客户未回复；0114对接客户表示自己也不清楚；"
        "1024-合同已签订，首笔款预计下周三付款"
    )
    parts = split_follow_up_text(text, fallback_date="2026-07-01")
    assert [p["date"] for p in parts] == [
        "2026-01-22",
        "2026-01-15",
        "2026-01-14",
        "2025-10-24",
    ]
    assert parts[2]["content"].startswith("0114")


def test_mmdd_with_space_and_colon():
    text = """0706 暂停，内部组织架构调整
0622-待SNK反馈
0612：宝岛眼镜 陆总反馈近期忙"""
    parts = split_follow_up_text(text, fallback_date="2026-07-20")
    assert len(parts) == 3
    assert parts[0]["date"] == "2026-07-06"
    assert parts[1]["date"] == "2026-06-22"
    assert parts[2]["date"] == "2026-06-12"


def test_mmdd_year_rollover_jan_then_dec():
    text = "0105-第三版合同签署；1231-合同重新签署中；1226 因对方公司主体问题"
    parts = split_follow_up_text(text, fallback_date="2026-02-01")
    assert [p["date"] for p in parts] == ["2026-01-05", "2025-12-31", "2025-12-26"]
