"""飞书组织同步：部门路径「实时名称优先、配置仅兜底」。

背景：飞书应用已开通 contact:department.base:readonly，部门记录带 name；
此前同步优先读 config/feishu-department-map.json 的 breadcrumb，导致组织调整后
（如「解决方案部」从市场及营销方案中心移到销售管理中心）旧路径一直保留。

注意：本测试为「快照式」用例，断言依赖 feishu-department-map.json 中的部门路径；
组织结构再次调整时需同步更新 config 与这些断言，否则会误报。
"""

from __future__ import annotations

from app.core.feishu.contact import (
    _build_department_breadcrumb,
    build_feishu_user_org_profile_from_records,
)

# 华北：真实父链 销售管理中心 > 解决方案部 > 华北；
# config/feishu-department-map.json 里华北的 breadcrumb 仍是旧值「市场及营销方案中心 > 营销方案 > 华北」。
HUABEI_ID = "od-d8f1fb6a1b05eb6e9bd8040415e1f12e"
JFA_ID = "od-bf5cf36d90d3bcde858a1ea781655e12"
SALES_ID = "od-1b9fc3c696911d33b83799510d4faab2"


def _live_cache() -> dict[str, dict]:
    return {
        HUABEI_ID: {"open_department_id": HUABEI_ID, "name": "华北", "parent_department_id": JFA_ID},
        JFA_ID: {"open_department_id": JFA_ID, "name": "解决方案部", "parent_department_id": SALES_ID},
        SALES_ID: {"open_department_id": SALES_ID, "name": "销售管理中心", "parent_department_id": "0"},
    }


def test_breadcrumb_prefers_live_parent_chain_over_stale_config():
    assert _build_department_breadcrumb(HUABEI_ID, _live_cache()) == "销售管理中心 > 解决方案部 > 华北"


def test_breadcrumb_falls_back_to_config_when_names_missing():
    # 无实时 name（权限未开通 / 缓存缺失）→ 回退配置 breadcrumb（已与真实结构同步）
    assert _build_department_breadcrumb(HUABEI_ID, {}) == "销售管理中心 > 解决方案部 > 华北"


def test_breadcrumb_falls_back_when_ancestor_missing():
    cache = {HUABEI_ID: {"open_department_id": HUABEI_ID, "name": "华北", "parent_department_id": JFA_ID}}
    assert _build_department_breadcrumb(HUABEI_ID, cache) == "销售管理中心 > 解决方案部 > 华北"


def test_profile_uses_live_path_even_when_config_stale():
    user = {
        "open_id": "ou_wangyuanyuan",
        "name": "王媛媛",
        "department_ids": [HUABEI_ID],
        "status": {},
    }
    profile = build_feishu_user_org_profile_from_records(user, _live_cache())
    assert profile["department_names"] == ["销售管理中心 > 解决方案部 > 华北"]
    assert profile["primary_department_breadcrumb"] == "销售管理中心 > 解决方案部 > 华北"


def test_profile_falls_back_to_config_when_live_names_missing():
    user = {
        "open_id": "ou_wangyuanyuan",
        "name": "王媛媛",
        "department_ids": [HUABEI_ID],
        "status": {},
    }
    profile = build_feishu_user_org_profile_from_records(user, {})
    assert profile["department_names"] == ["销售管理中心 > 解决方案部 > 华北"]
