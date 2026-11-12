"""销售 Leader 部门树可见范围（department data_scope）。"""

from __future__ import annotations

import pytest

from app.modules.users.repository import UsersRepository


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)


class _FakeDb:
    def __init__(self, responses: list):
        self._responses = list(responses)
        self.calls = 0

    async def execute(self, *_args, **_kwargs):
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return _FakeResult(self._responses[idx])


@pytest.mark.asyncio
async def test_peer_scope_includes_subtree_members(monkeypatch):
    viewer_id = "leader-1"
    # viewer row: id, dept_ids, names, manual_name, manual_open_id, manual_leader, feishu_open_id
    viewer = (
        viewer_id,
        ["od-root"],
        ["销售部"],
        None,
        None,
        0,
        "ou_leader",
    )
    peers = [
        ("sales-a", ["od-child"], ["华东销售"], None, None),
        ("sales-b", ["od-other"], ["其他部"], None, None),
        ("sales-legacy", None, ["销售部-华东"], None, None),
    ]
    db = _FakeDb([[viewer], peers])
    repo = UsersRepository(db)

    async def fake_expand(root_ids):
        assert "od-root" in root_ids
        return {"od-root", "od-child"}

    async def fake_led(_open_id):
        return []

    monkeypatch.setattr(repo, "_expand_department_subtree", fake_expand)
    monkeypatch.setattr(
        "app.core.feishu.contact.fetch_department_ids_led_by_open_id",
        fake_led,
    )

    ids = await repo.get_department_peer_user_ids(viewer_id, ["销售部"])
    assert viewer_id in ids
    assert "sales-a" in ids
    assert "sales-b" not in ids
    # 无 department_ids 且部门名与 viewer 模糊重叠 → 仍可见（历史回退）
    assert "sales-legacy" in ids


@pytest.mark.asyncio
async def test_peer_scope_merges_feishu_led_departments(monkeypatch):
    viewer_id = "leader-2"
    viewer = (
        viewer_id,
        ["od-member"],
        ["销售一组"],
        None,
        None,
        0,
        "ou_big_leader",
    )
    peers = [
        ("sales-led", ["od-led-child"], ["负责组"], None, None),
        ("sales-member-only", ["od-member"], ["销售一组"], None, None),
    ]
    db = _FakeDb([[viewer], peers])
    repo = UsersRepository(db)

    async def fake_expand(root_ids):
        # 所属 + 负责部门都应进入展开根
        assert "od-member" in root_ids
        assert "od-led-root" in root_ids
        return {"od-member", "od-led-root", "od-led-child"}

    async def fake_led(open_id):
        assert open_id == "ou_big_leader"
        return ["od-led-root"]

    monkeypatch.setattr(repo, "_expand_department_subtree", fake_expand)
    monkeypatch.setattr(
        "app.core.feishu.contact.fetch_department_ids_led_by_open_id",
        fake_led,
    )

    ids = await repo.get_department_peer_user_ids(viewer_id, ["销售一组"])
    assert set(ids) == {viewer_id, "sales-led", "sales-member-only"}


@pytest.mark.asyncio
async def test_peer_scope_no_name_fallback_when_dept_ids_present(monkeypatch):
    """已有 department_ids 但不在子树内：不因部门名相似串部门。"""
    viewer_id = "leader-3"
    viewer = (viewer_id, ["od-a"], ["销售部"], None, None, 0, "ou_x")
    peers = [
        ("peer-similar-name", ["od-b"], ["销售部华东"], None, None),
    ]
    db = _FakeDb([[viewer], peers])
    repo = UsersRepository(db)

    async def fake_expand(root_ids):
        return {"od-a"}

    async def fake_led(_open_id):
        return []

    monkeypatch.setattr(repo, "_expand_department_subtree", fake_expand)
    monkeypatch.setattr(
        "app.core.feishu.contact.fetch_department_ids_led_by_open_id",
        fake_led,
    )

    ids = await repo.get_department_peer_user_ids(viewer_id, ["销售部"])
    assert ids == [viewer_id]


@pytest.mark.asyncio
async def test_peer_scope_parses_mysql_json_string_department_names(monkeypatch):
    """text() 查出的 department_names 常为 JSON 字符串，须能匹配同名部门同事。"""
    viewer_id = "leader-dev"
    sales_id = "sales-li"
    viewer = (viewer_id, None, '["销售部"]', None, None, 0, "dev_leader")
    peers = [
        (sales_id, None, '["销售部"]', None, None),
        ("other", None, '["研发"]', None, None),
    ]
    db = _FakeDb([[viewer], peers])
    repo = UsersRepository(db)

    async def fake_expand(_root_ids):
        return set()

    async def fake_led(_open_id):
        return []

    monkeypatch.setattr(repo, "_expand_department_subtree", fake_expand)
    monkeypatch.setattr(
        "app.core.feishu.contact.fetch_department_ids_led_by_open_id",
        fake_led,
    )

    ids = await repo.get_department_peer_user_ids(viewer_id, ["销售部"])
    assert sales_id in ids
    assert "other" not in ids


def test_coerce_json_list_parses_mysql_string():
    assert UsersRepository._coerce_json_list('["销售部"]') == ["销售部"]
    assert UsersRepository._coerce_json_list(["销售部"]) == ["销售部"]
    assert UsersRepository._parse_user_departments('["销售部"]', None) == ["销售部"]
    assert UsersRepository._parse_department_ids(None, '["od-1","od-2"]') == ["od-1", "od-2"]


def test_department_leader_open_ids_extract():
    from app.core.feishu.contact import _department_leader_open_ids

    assert _department_leader_open_ids(
        {
            "leader_user_id": "ou_1",
            "leaders": [{"leaderID": "ou_2"}, {"leader_id": "ou_3"}],
        }
    ) == {"ou_1", "ou_2", "ou_3"}
