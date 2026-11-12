"""需求列表「区域」筛选：兼容国家 code 与中文名。"""

from __future__ import annotations

from app.modules.requests.repository import _region_match_values


def test_region_match_values_code_and_zh_name():
    assert "US" in _region_match_values("US")
    assert "美国" in _region_match_values("US")


def test_region_match_values_unknown_code_stays_alone():
    assert _region_match_values("不存在国家") == ["不存在国家"]


def test_region_match_values_chinese_passthrough():
    assert "日本" in _region_match_values("日本")
