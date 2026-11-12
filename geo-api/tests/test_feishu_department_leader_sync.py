"""飞书部门负责人同步：diff 规则与解析。"""

from __future__ import annotations

from app.core.feishu.contact import _department_leader_open_ids
from app.modules.users.feishu_org_sync import (
    DepartmentLeaderCurrentState,
    _normalize_led_department_ids,
    compute_department_leader_sync_actions,
)


def test_department_leader_open_ids_extract():
    assert _department_leader_open_ids(
        {
            "leader_user_id": "ou_1",
            "leaders": [{"leaderID": "ou_2"}, {"leader_id": "ou_3"}],
        }
    ) == {"ou_1", "ou_2", "ou_3"}


def test_normalize_led_department_ids():
    assert _normalize_led_department_ids(None) == []
    assert _normalize_led_department_ids(["od-b", "od-a", "od-a"]) == ["od-a", "od-b"]
    assert _normalize_led_department_ids('["od-2","od-1"]') == ["od-1", "od-2"]


def test_assign_new_leader():
    desired = {"ou_a": [("od-leaf", "叶子组")]}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_a",
            name="张三",
            manual_department_open_id="od-other",
            manual_department_name="其他部",
            manual_department_leader=False,
            feishu_led_department_ids=[],
        )
    ]
    actions = compute_department_leader_sync_actions(desired, current)
    assert len(actions) == 1
    assert actions[0].kind == "assign"
    assert actions[0].manual_department_leader is True
    assert actions[0].manual_department_open_id == "od-leaf"
    assert actions[0].manual_department_name == "叶子组"
    assert actions[0].feishu_led_department_ids == ["od-leaf"]


def test_change_leader_departments():
    desired = {"ou_a": [("od-1", "一部"), ("od-2", "二部")]}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_a",
            name="李四",
            manual_department_open_id="od-old",
            manual_department_name="旧部",
            manual_department_leader=True,
            feishu_led_department_ids=["od-old"],
        )
    ]
    actions = compute_department_leader_sync_actions(desired, current)
    assert len(actions) == 1
    assert actions[0].kind == "change"
    assert actions[0].feishu_led_department_ids == ["od-1", "od-2"]
    assert actions[0].manual_department_open_id == "od-1"


def test_unchanged_leader_skipped():
    desired = {"ou_a": [("od-1", "一部")]}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_a",
            name="王五",
            manual_department_open_id="od-1",
            manual_department_name="一部",
            manual_department_leader=True,
            feishu_led_department_ids=["od-1"],
        )
    ]
    assert compute_department_leader_sync_actions(desired, current) == []


def test_clear_removed_leader():
    desired: dict[str, list[tuple[str, str]]] = {}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_a",
            name="赵六",
            manual_department_open_id="od-1",
            manual_department_name="一部",
            manual_department_leader=True,
            feishu_led_department_ids=["od-1"],
        )
    ]
    actions = compute_department_leader_sync_actions(desired, current)
    assert len(actions) == 1
    assert actions[0].kind == "clear"
    assert actions[0].manual_department_leader is False
    assert actions[0].feishu_led_department_ids is None
    assert actions[0].manual_department_open_id is None


def test_non_leader_manual_annotation_untouched():
    desired: dict[str, list[tuple[str, str]]] = {}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_b",
            name="普通成员",
            manual_department_open_id="od-leaf",
            manual_department_name="叶子组",
            manual_department_leader=False,
            feishu_led_department_ids=[],
        )
    ]
    assert compute_department_leader_sync_actions(desired, current) == []


def test_leader_scope_already_ok_roles():
    from app.modules.users.feishu_org_sync import _LEADER_SCOPE_ALREADY_OK

    assert "leader" in _LEADER_SCOPE_ALREADY_OK
    assert "presales" in _LEADER_SCOPE_ALREADY_OK
    assert "admin" in _LEADER_SCOPE_ALREADY_OK
    assert "ops" in _LEADER_SCOPE_ALREADY_OK
    assert "super_admin" in _LEADER_SCOPE_ALREADY_OK
    assert "sales" not in _LEADER_SCOPE_ALREADY_OK
    assert "viewer" not in _LEADER_SCOPE_ALREADY_OK
    assert "sdr" not in _LEADER_SCOPE_ALREADY_OK


def test_desired_leader_missing_from_local_users_skipped():
    desired = {"ou_missing": [("od-1", "一部")]}
    current = [
        DepartmentLeaderCurrentState(
            feishu_open_id="ou_other",
            name="别人",
            manual_department_open_id=None,
            manual_department_name=None,
            manual_department_leader=False,
            feishu_led_department_ids=[],
        )
    ]
    assert compute_department_leader_sync_actions(desired, current) == []
