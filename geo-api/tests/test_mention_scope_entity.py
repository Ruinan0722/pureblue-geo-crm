"""@ 候选按实体可见性收窄（mention_scope.mentionable_user_ids_for_entity）。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.users.mention_scope import (
    _parse_department_names,
    mentionable_user_ids_for_entity,
)


def test_parse_department_names():
    assert _parse_department_names('["北一", "华北"]') == {"北一", "华北"}
    assert _parse_department_names(None) == set()
    assert _parse_department_names("not-json") == set()
    assert _parse_department_names("[]") == set()


def _rows(*rows):
    return SimpleNamespace(all=lambda: list(rows))


@pytest.mark.asyncio
async def test_mentionable_user_ids_for_entity_boundary():
    """all 范围全可见；负责人本人可见；department 仅部门交集可见；own 非负责人不可见。"""
    allowed = {"u_owner", "u_all", "u_dept_same", "u_dept_other", "u_own_other"}
    db = AsyncMock()

    def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "crm_leads" in sql:
            return _rows(("u_owner",))
        if "role = 'sdr'" in sql:
            return _rows()
        if "FROM users" in sql:
            ids = params["ids"]
            if ids == ["u_owner"]:
                return _rows(("u_owner", '["北一"]'))
            return _rows(
                ("u_owner", '["北一"]'),
                ("u_all", "[]"),
                ("u_dept_same", '["北一"]'),
                ("u_dept_other", '["华南"]'),
                ("u_own_other", "[]"),
            )
        raise AssertionError(f"unexpected sql: {sql}")

    db.execute.side_effect = fake_execute
    scopes = {
        "u_owner": "own",
        "u_all": "all",
        "u_dept_same": "department",
        "u_dept_other": "department",
        "u_own_other": "own",
    }
    with (
        patch(
            "app.modules.users.mention_scope.get_mentionable_user_ids_cached",
            new=AsyncMock(return_value=allowed),
        ),
        patch(
            "app.modules.users.mention_scope._load_user_primary_scopes",
            new=AsyncMock(return_value=scopes),
        ),
    ):
        result = await mentionable_user_ids_for_entity(
            db, scope="leads", entity_id="lead-1"
        )

    assert result == {"u_owner", "u_all", "u_dept_same"}


@pytest.mark.asyncio
async def test_mentionable_user_ids_for_entity_no_owner():
    """实体无负责人：仅 all 范围用户可见（与未分配可见性一致）。"""
    allowed = {"u_all", "u_dept_same", "u_own"}
    db = AsyncMock()

    def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "FROM requests" in sql:
            return _rows()
        if "FROM users" in sql:
            return _rows(("u_all", "[]"), ("u_dept_same", '["北一"]'), ("u_own", "[]"))
        raise AssertionError(f"unexpected sql: {sql}")

    db.execute.side_effect = fake_execute
    scopes = {"u_all": "all", "u_dept_same": "department", "u_own": "own"}
    with (
        patch(
            "app.modules.users.mention_scope.get_mentionable_user_ids_cached",
            new=AsyncMock(return_value=allowed),
        ),
        patch(
            "app.modules.users.mention_scope._load_user_primary_scopes",
            new=AsyncMock(return_value=scopes),
        ),
    ):
        result = await mentionable_user_ids_for_entity(
            db, scope="requests", entity_id="req-1"
        )

    assert result == {"u_all"}


@pytest.mark.asyncio
async def test_mentionable_user_ids_for_entity_sdr_pool():
    """SDR 共享线索池：线索归属 SDR 或无负责人时，其他 SDR 也可被 @。"""
    allowed = {"u_sdr_a", "u_sdr_b", "u_owner", "u_all", "u_other"}
    db = AsyncMock()

    def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "crm_leads" in sql:
            return _rows(("u_sdr_a",))
        if "role = 'sdr'" in sql:
            return _rows(("u_sdr_a", "演示成员04"), ("u_sdr_b", "演示成员05"))
        if "FROM users" in sql:
            ids = params["ids"]
            if ids == ["u_sdr_a"]:
                return _rows(("u_sdr_a", '["SDR"]'))
            return _rows(
                ("u_sdr_a", '["SDR"]'),
                ("u_sdr_b", '["SDR"]'),
                ("u_owner", "[]"),
                ("u_all", "[]"),
                ("u_other", "[]"),
            )
        raise AssertionError(f"unexpected sql: {sql}")

    db.execute.side_effect = fake_execute
    scopes = {
        "u_sdr_a": "own",
        "u_sdr_b": "own",
        "u_owner": "own",
        "u_all": "all",
        "u_other": "own",
    }
    with (
        patch(
            "app.modules.users.mention_scope.get_mentionable_user_ids_cached",
            new=AsyncMock(return_value=allowed),
        ),
        patch(
            "app.modules.users.mention_scope._load_user_primary_scopes",
            new=AsyncMock(return_value=scopes),
        ),
    ):
        result = await mentionable_user_ids_for_entity(
            db, scope="leads", entity_id="lead-1"
        )

    # 池内 SDR（u_sdr_b）与负责人、all 范围用户均可被 @；无关 own 用户不可见
    assert result == {"u_sdr_a", "u_sdr_b", "u_all"}


@pytest.mark.asyncio
async def test_mentionable_user_ids_for_entity_sdr_field_imported():
    """导入线索负责人为销售但 sdr 归属字段命中 SDR 目录：SDR 成员也可被 @。"""
    allowed = {"u_sdr_a", "u_sdr_b", "u_all"}
    db = AsyncMock()

    def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "SELECT sdr FROM" in sql:
            return _rows(("演示成员04",))
        if "SELECT owner_user_id" in sql:
            return _rows(("u_sales",))
        if "role = 'sdr'" in sql:
            return _rows(("u_sdr_a", "演示成员04"), ("u_sdr_b", "演示成员05"))
        if "FROM users" in sql:
            return _rows(
                ("u_sdr_a", '["SDR"]'),
                ("u_sdr_b", '["SDR"]'),
                ("u_all", "[]"),
            )
        raise AssertionError(f"unexpected sql: {sql}")

    db.execute.side_effect = fake_execute
    scopes = {
        "u_sdr_a": "own",
        "u_sdr_b": "own",
        "u_sales": "own",
        "u_all": "all",
    }
    with (
        patch(
            "app.modules.users.mention_scope.get_mentionable_user_ids_cached",
            new=AsyncMock(return_value=allowed),
        ),
        patch(
            "app.modules.users.mention_scope._load_user_primary_scopes",
            new=AsyncMock(return_value=scopes),
        ),
    ):
        result = await mentionable_user_ids_for_entity(
            db, scope="leads", entity_id="lead-1"
        )

    assert result == {"u_sdr_a", "u_sdr_b", "u_all"}
