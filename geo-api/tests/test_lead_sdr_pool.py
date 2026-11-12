"""SDR 部门共享线索池 + 归属 SDR 改派（负责人变更须审计、可指派校验）。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import mysql

from app.core.exceptions import PermissionDeniedError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository import CrmRepository
from app.modules.crm.service import CrmService
from app.modules.users.repository import UsersRepository


def _user(
    *,
    user_id: str = "u-sdr-a",
    name: str = "SDR A",
    role: str = "sdr",
    scope: str = "own",
) -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name=name,
        role=role,
        permissions=["section:leads", "leads:edit", "leads:write"],
        data_scope=scope,
        department_names=["SDR 部门"],
    )


def _lead_row(*, owner: str = "u-sdr-a", sdr: str = "SDR A") -> SimpleNamespace:
    return SimpleNamespace(
        id="l1",
        owner_user_id=owner,
        status="untouched",
        created_at=None,
        document={
            "companyName": "测试公司",
            "brandName": "",
            "contactName": "张三",
            "sdr": sdr,
            "sales": "未分配",
        },
    )


def _compile(clause) -> str:
    return str(clause.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}))


def test_lead_pool_clause_or_sdr_names():
    """共享池查询：负责人范围 OR sdr 归属字段命中 SDR 目录。"""
    repo = CrmRepository(AsyncMock())
    assert repo._lead_pool_clause(None, None) is None
    assert repo._lead_pool_clause(None, []) is None
    assert repo._lead_pool_clause(None, ["", "  "]) is None

    clause = repo._lead_pool_clause(None, ["演示成员04"])
    sql = _compile(clause)
    assert "sdr" in sql
    assert "演示成员04" in sql

    owner_clause = repo._lead_owner_clause(["u-sdr-a"], include_unassigned=False)
    combined = repo._lead_pool_clause(owner_clause, ["演示成员04"])
    sql = _compile(combined)
    assert "owner_user_id" in sql
    assert "sdr" in sql
    assert "OR" in sql.upper()


@pytest.mark.asyncio
async def test_owner_filter_sdr_lead_pool_returns_all_sdr_members(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a", "u-sdr-b", "u-sdr-c"]

    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)
    ids = await svc._owner_filter(_user(), lead_pool=True)
    assert ids == ["u-sdr-a", "u-sdr-b", "u-sdr-c"]


@pytest.mark.asyncio
async def test_owner_filter_sdr_non_lead_stays_self(monkeypatch):
    """非线索实体（客户/商机/合同等）SDR 仍只按 own 范围，不被共享池放行。"""
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a", "u-sdr-b"]

    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)
    ids = await svc._owner_filter(_user())
    assert ids == ["u-sdr-a"]
    ids = await svc._owner_filter(_user(), mine_only=True)
    assert ids == ["u-sdr-a"]


@pytest.mark.asyncio
async def test_include_unassigned_sdr_lead_pool_allows_unassigned():
    """导入线索默认无负责人：SDR 在共享池内可见（lead_pool=True），
    非线索实体（lead_pool=False）仍不自动开放无负责人数据。"""
    db = AsyncMock()
    svc = CrmService(db)
    assert svc._include_unassigned(_user(), lead_pool=True) is True
    assert svc._include_unassigned(_user()) is False
    assert svc._include_unassigned(_user(), mine_only=True, lead_pool=True) is False


@pytest.mark.asyncio
async def test_assert_row_access_sdr_lead_pool_allows_unassigned(monkeypatch):
    """SDR 可打开/编辑无负责人线索（认领入口），lead_pool=False 时仍拒绝。"""
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a"]

    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)
    await svc._assert_row_access(_user(), None, lead_pool=True)
    with pytest.raises(PermissionDeniedError):
        await svc._assert_row_access(_user(), None)


@pytest.mark.asyncio
async def test_list_leads_and_stats_use_lead_pool(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    calls: dict[str, dict] = {}

    async def fake_owner_filter(user, **kwargs):
        del user
        calls.setdefault("owner_filter", kwargs)
        return ["u-sdr-a", "u-sdr-b"]

    monkeypatch.setattr(svc, "_owner_filter", fake_owner_filter)
    monkeypatch.setattr(svc, "_include_unassigned", lambda user, **kwargs: False)
    monkeypatch.setattr(svc, "_sdr_pool_names", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        svc.repo,
        "search_leads",
        AsyncMock(return_value=([], 0)),
    )
    monkeypatch.setattr(svc.repo, "list_lead_children", AsyncMock(return_value={}))
    await svc.list_leads(_user())
    assert calls["owner_filter"] == {"lead_pool": True}

    calls.clear()
    monkeypatch.setattr(
        svc.repo,
        "aggregate_lead_stats",
        AsyncMock(return_value={"total": 0}),
    )
    await svc.get_lead_stats(_user())
    assert calls["owner_filter"] == {"lead_pool": True}


@pytest.mark.asyncio
async def test_list_leads_sdr_includes_unassigned_imported(monkeypatch):
    """SDR 线索列表默认并入无负责人（导入）线索，供认领。"""
    db = AsyncMock()
    svc = CrmService(db)
    captured: dict = {}

    async def fake_owner_filter(user, **kwargs):
        del user, kwargs
        return ["u-sdr-a"]

    def fake_include_unassigned(user, *, mine_only=False, lead_pool=False):
        del user, mine_only
        captured["lead_pool"] = lead_pool
        return True

    async def fake_search(owner_ids, **kwargs):
        del owner_ids
        captured["include_unassigned"] = kwargs.get("include_unassigned")
        captured["sdr_pool_names"] = kwargs.get("sdr_pool_names")
        return [], 0

    monkeypatch.setattr(svc, "_owner_filter", fake_owner_filter)
    monkeypatch.setattr(svc, "_include_unassigned", fake_include_unassigned)
    monkeypatch.setattr(svc, "_sdr_pool_names", AsyncMock(return_value=["演示成员04"]))
    monkeypatch.setattr(svc.repo, "search_leads", fake_search)
    monkeypatch.setattr(svc.repo, "list_lead_children", AsyncMock(return_value={}))

    await svc.list_leads(_user())
    assert captured["lead_pool"] is True
    assert captured["include_unassigned"] is True
    assert captured["sdr_pool_names"] == ["演示成员04"]


@pytest.mark.asyncio
async def test_assert_row_access_sdr_pool_matches_sdr_field(monkeypatch):
    """导入线索 sdr 归属字段命中 SDR 目录时，即使负责人是销售也可见（可认领）。"""
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a"]

    async def fake_sdr_names(self):
        del self
        return ["演示成员04", "演示成员05"]

    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)
    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_names", fake_sdr_names)

    # 负责人为销售，但 sdr 字段=演示成员04 → 池内可见
    await svc._assert_row_access(
        _user(),
        "u-sales",
        lead_pool=True,
        lead_sdr_name="演示成员04",
    )
    # sdr 字段不在 SDR 目录 → 仍拒绝
    with pytest.raises(PermissionDeniedError):
        await svc._assert_row_access(
            _user(),
            "u-sales",
            lead_pool=True,
            lead_sdr_name="李销售",
        )


@pytest.mark.asyncio
async def test_update_lead_reassigns_sdr_owner_with_audit(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row()

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sdr-b", name=name, role="sdr")

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a", "u-sdr-b"]

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)
    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)

    await svc.update_lead(_user(), "l1", {"sdr": "SDR B"})

    assert row.owner_user_id == "u-sdr-b"
    assert row.document["sdr"] == "SDR B"
    audit.assert_awaited_once()
    audit_call = audit.await_args
    assert audit_call.kwargs["module"] == "线索管理"
    assert audit_call.kwargs["action"] == "变更归属 SDR"
    assert audit_call.kwargs["changes"] == [
        {"field": "sdr", "label": "归属 SDR", "before": "SDR A", "after": "SDR B"}
    ]


@pytest.mark.asyncio
async def test_update_lead_rejects_non_sdr_target(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row()

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )
    monkeypatch.setattr(svc.repo, "save_lead", AsyncMock())
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sales", name=name, role="sales")

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)

    with pytest.raises(ValidationError, match="不是 SDR 成员"):
        await svc.update_lead(_user(), "l1", {"sdr": "李销售"})


@pytest.mark.asyncio
async def test_update_lead_rejects_sdr_outside_assignable_directory(monkeypatch):
    """SDR 只能把归属改到 SDR 成员目录；目录外的 sdr 用户也拒绝。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row()

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )
    monkeypatch.setattr(svc.repo, "save_lead", AsyncMock())
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sdr-x", name=name, role="sdr")

    async def fake_sdr_ids(self):
        del self
        return ["u-sdr-a"]

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)
    monkeypatch.setattr(UsersRepository, "get_sdr_directory_user_ids", fake_sdr_ids)

    with pytest.raises(PermissionDeniedError, match="只能将线索归属指派给 SDR 成员"):
        await svc.update_lead(_user(), "l1", {"sdr": "SDR X"})


@pytest.mark.asyncio
async def test_update_lead_all_scope_can_assign_sdr(monkeypatch):
    """运营/管理员（all）可把线索归属给任意在职 SDR，不受 own 目录限制。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row()

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sdr-b", name=name, role="sdr")

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)

    user = _user(user_id="u-ops", name="运营", role="ops", scope="all")
    await svc.update_lead(user, "l1", {"sdr": "SDR B"})
    assert row.owner_user_id == "u-sdr-b"
    audit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_lead_empty_sdr_keeps_current_owner(monkeypatch):
    """空值表示保持当前归属，不允许误清为无负责人。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row(owner="u-sdr-a", sdr="SDR A")

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    await svc.update_lead(_user(), "l1", {"companyName": "测试公司", "sdr": ""})

    assert row.owner_user_id == "u-sdr-a"
    assert row.document["sdr"] == "SDR A"
    audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_lead_repairs_owner_to_sdr_label(monkeypatch):
    """sdr 归属字段未变但负责人是销售（历史导入）：保存时归一为归属 SDR 并审计。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row(owner="u-sales", sdr="演示成员04")

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sdr-y", name=name, role="sdr")

    async def fake_get_by_id(self, user_id):
        del self, user_id
        return SimpleNamespace(name="李销售")

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)
    monkeypatch.setattr(UsersRepository, "get_by_id", fake_get_by_id)

    await svc.update_lead(_user(), "l1", {"sdr": "演示成员04"})

    assert row.owner_user_id == "u-sdr-y"
    audit.assert_awaited_once()
    audit_call = audit.await_args
    assert audit_call.kwargs["changes"] == [
        {"field": "sdr", "label": "归属 SDR", "before": "李销售", "after": "演示成员04"}
    ]


@pytest.mark.asyncio
async def test_update_lead_repairs_unassigned_to_sdr_label(monkeypatch):
    """无负责人但带 sdr 标签的线索：保存时绑定为归属 SDR。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row(owner=None, sdr="演示成员04")

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sdr-y", name=name, role="sdr")

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)

    await svc.update_lead(_user(), "l1", {"sdr": "演示成员04"})

    assert row.owner_user_id == "u-sdr-y"
    audit.assert_awaited_once()
    audit_call = audit.await_args
    assert audit_call.kwargs["changes"] == [
        {"field": "sdr", "label": "归属 SDR", "before": "无负责人", "after": "演示成员04"}
    ]


@pytest.mark.asyncio
async def test_update_lead_no_repair_for_non_sdr_label(monkeypatch):
    """sdr 标签不是在职 SDR（销售/离职）时，编辑不改变负责人。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = _lead_row(owner="u-sales", sdr="李销售")

    monkeypatch.setattr(svc.repo, "get_lead", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "get_lead_children",
        AsyncMock(return_value={"notes": [], "importMeta": None, "attachments": []}),
    )

    async def fake_save(lead_row, document):
        lead_row.document = document
        return lead_row

    monkeypatch.setattr(svc.repo, "save_lead", fake_save)
    audit = AsyncMock()
    monkeypatch.setattr(svc.repo, "create_audit_record", audit)
    monkeypatch.setattr(svc, "_assert_row_access", AsyncMock())
    monkeypatch.setattr(svc, "_validate_lead_source_option", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    async def fake_get_by_name(self, name, *, active_only=False):
        del self, active_only
        return SimpleNamespace(id="u-sales", name=name, role="sales")

    monkeypatch.setattr(UsersRepository, "get_by_name", fake_get_by_name)

    await svc.update_lead(_user(), "l1", {"companyName": "改名"})

    assert row.owner_user_id == "u-sales"
    audit.assert_not_awaited()

