"""Phase B/C：附件/审计/改派 scope 单元测试（无真实 DB）。"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user(*, user_id: str = "u-a", permissions: list[str] | None = None, scope: str = "own") -> AuthUser:
    perms = permissions or [
        "section:leads",
        "section:customers",
        "section:opportunities",
        "section:contracts",
        "section:projects",
        "request:view",
        "customers:write",
    ]
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="销售A",
        role="sales",
        permissions=perms,
        data_scope=scope,
        department_names=["销售部"],
    )


@pytest.mark.asyncio
async def test_assert_assignable_owner_uses_sales_directory_not_own_filter(monkeypatch):
    """own 读范围只有自己，但改派须允许销售成员目录（否则 SDR 无法转客户给销售）。"""
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_assignable(_user):
        return ["u-a", "u-peer"]

    monkeypatch.setattr(svc, "_assignable_owner_ids", fake_assignable)
    await svc._assert_assignable_owner(_user(scope="own"), "u-a")
    await svc._assert_assignable_owner(_user(scope="own"), "u-peer")
    with pytest.raises(PermissionDeniedError):
        await svc._assert_assignable_owner(_user(scope="own"), "u-outsider")


@pytest.mark.asyncio
async def test_assignable_owner_ids_own_scope_loads_sales_directory(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    called = {}

    async def fake_directory(self):
        del self
        called["hit"] = True
        return ["u-sales"]

    from app.modules.users.repository import UsersRepository

    monkeypatch.setattr(UsersRepository, "get_sales_directory_user_ids", fake_directory)

    ids = await svc._assignable_owner_ids(_user(scope="own", user_id="u-a"))
    assert ids == ["u-a", "u-sales"]
    assert called["hit"] is True


@pytest.mark.asyncio
async def test_assert_assignable_owner_all_scope_allows_anyone(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_ids(_user):
        return None

    monkeypatch.setattr(svc, "_assignable_owner_ids", fake_ids)
    await svc._assert_assignable_owner(_user(scope="all"), "anyone")


@pytest.mark.asyncio
async def test_assert_entity_readable_customer_uses_master_readable(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(id="c1", owner_user_id="u-b", document={})

    async def fake_get(_id):
        return row

    called = {"ok": False}

    async def fake_access(_user, _row):
        called["ok"] = True

    monkeypatch.setattr(svc.repo, "get_customer", fake_get)
    monkeypatch.setattr(svc, "_assert_customer_master_readable", fake_access)
    await svc._assert_entity_readable(_user(), "customer", "c1")
    assert called["ok"] is True


@pytest.mark.asyncio
async def test_assert_entity_readable_project_delegates(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    called = {"ok": False}

    class _FakeProjects:
        def __init__(self, _db):
            pass

        async def get_project(self, _user, project_id: str):
            called["ok"] = True
            assert project_id == "proj-1"
            return SimpleNamespace(id=project_id)

    monkeypatch.setattr("app.modules.projects.service.ProjectsService", _FakeProjects)
    await svc._assert_entity_readable(_user(), "project", "proj-1")
    assert called["ok"] is True


@pytest.mark.asyncio
async def test_assert_entity_id_readable_finds_project(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.get_lead = AsyncMock(return_value=None)
    svc.repo.get_customer = AsyncMock(return_value=None)
    svc.repo.get_opportunity = AsyncMock(return_value=None)
    svc.repo.get_contract = AsyncMock(return_value=None)

    class _FakeReqRepo:
        def __init__(self, _db):
            pass

        async def get_by_id(self, _eid):
            return None

    class _FakeProjRepo:
        def __init__(self, _db):
            pass

        async def get(self, eid):
            return SimpleNamespace(id=eid)

    called = {"project": False}

    async def fake_readable(_user, kind, eid):
        if kind == "project" and eid == "proj-9":
            called["project"] = True
            return
        raise AssertionError(f"unexpected {kind} {eid}")

    monkeypatch.setattr("app.modules.requests.repository.RequestRepository", _FakeReqRepo)
    monkeypatch.setattr("app.modules.projects.repository.ProjectsRepository", _FakeProjRepo)
    monkeypatch.setattr(svc, "_assert_entity_readable", fake_readable)
    await svc._assert_entity_id_readable(_user(), "proj-9")
    assert called["project"] is True


@pytest.mark.asyncio
async def test_assert_attachment_access_allows_when_any_parent_readable(monkeypatch, tmp_path: Path):
    db = AsyncMock()
    svc = CrmService(db)
    fake_file = tmp_path / "file-1.pdf"
    fake_file.write_bytes(b"x")

    monkeypatch.setattr(
        "app.modules.crm.attachment_store.resolve_attachment_path",
        lambda _aid: fake_file,
    )
    monkeypatch.setattr(
        "app.modules.crm.attachment_store.attachment_owner_hints",
        lambda _aid, path=None: {"lead_id": "lead-b"},
    )

    async def fake_find(_aid):
        return [("customer", "c-a"), ("lead", "lead-b")]

    async def fake_readable(_user, kind, eid):
        if kind == "lead" and eid == "lead-b":
            return
        raise PermissionDeniedError()

    async def fake_customer_att(_user, cid):
        raise PermissionDeniedError("主档附件不可因主档可读放行")

    monkeypatch.setattr(svc.repo, "find_entities_for_attachment", fake_find)
    monkeypatch.setattr(svc.repo, "get_attachment_storage_id", AsyncMock(return_value="file-1.pdf"))
    monkeypatch.setattr(svc, "_assert_entity_readable", fake_readable)
    monkeypatch.setattr(svc, "_assert_customer_attachment_access", fake_customer_att)
    await svc.assert_attachment_access(_user(), "file-1.pdf")


@pytest.mark.asyncio
async def test_carried_attachment_authorizes_logical_coverage_and_loads_source_file(
    monkeypatch, tmp_path: Path
):
    db = AsyncMock()
    svc = CrmService(db)
    source_file = tmp_path / "source-file.pdf"
    source_file.write_bytes(b"x")

    monkeypatch.setattr(
        "app.modules.crm.attachment_store.resolve_attachment_path",
        lambda aid: source_file if aid == "source-file.pdf" else tmp_path / "missing.pdf",
    )
    monkeypatch.setattr(
        "app.modules.crm.attachment_store.attachment_owner_hints",
        lambda _aid, path=None: {"lead_id": "lead-b"},
    )
    monkeypatch.setattr(
        svc.repo,
        "get_attachment_storage_id",
        AsyncMock(return_value="source-file.pdf"),
    )
    monkeypatch.setattr(
        svc.repo,
        "find_entities_for_attachment",
        AsyncMock(return_value=[("coverage", "cv-a")]),
    )

    async def fake_readable(_user, kind, eid):
        if kind == "coverage" and eid == "cv-a":
            return
        raise PermissionDeniedError()

    monkeypatch.setattr(svc, "_assert_entity_readable", fake_readable)

    storage_id = await svc.assert_attachment_access(_user(), "logical-file.pdf")

    assert storage_id == "source-file.pdf"


@pytest.mark.asyncio
async def test_assert_attachment_access_denies_customer_without_coverage(monkeypatch, tmp_path: Path):
    db = AsyncMock()
    svc = CrmService(db)
    fake_file = tmp_path / "file-1.pdf"
    fake_file.write_bytes(b"x")

    monkeypatch.setattr(
        "app.modules.crm.attachment_store.resolve_attachment_path",
        lambda _aid: fake_file,
    )
    monkeypatch.setattr(
        "app.modules.crm.attachment_store.attachment_owner_hints",
        lambda _aid, path=None: {},
    )

    async def fake_find(_aid):
        return [("customer", "c-a")]

    async def fake_customer_att(_user, cid):
        assert cid == "c-a"
        raise PermissionDeniedError()

    monkeypatch.setattr(svc.repo, "find_entities_for_attachment", fake_find)
    monkeypatch.setattr(svc.repo, "get_attachment_storage_id", AsyncMock(return_value="file-1.pdf"))
    monkeypatch.setattr(svc, "_assert_customer_attachment_access", fake_customer_att)
    with pytest.raises(PermissionDeniedError):
        await svc.assert_attachment_access(_user(), "file-1.pdf")


@pytest.mark.asyncio
async def test_assert_attachment_access_denies_when_no_parent_readable(monkeypatch, tmp_path: Path):
    db = AsyncMock()
    svc = CrmService(db)
    fake_file = tmp_path / "file-1.pdf"
    fake_file.write_bytes(b"x")

    monkeypatch.setattr(
        "app.modules.crm.attachment_store.resolve_attachment_path",
        lambda _aid: fake_file,
    )
    monkeypatch.setattr(
        "app.modules.crm.attachment_store.attachment_owner_hints",
        lambda _aid, path=None: {},
    )

    async def fake_find(_aid):
        return [("lead", "lead-b")]

    async def fake_readable(_user, kind, eid):
        del _user, kind, eid
        raise PermissionDeniedError()

    monkeypatch.setattr(svc.repo, "find_entities_for_attachment", fake_find)
    monkeypatch.setattr(svc.repo, "get_attachment_storage_id", AsyncMock(return_value="file-1.pdf"))
    monkeypatch.setattr(svc, "_assert_entity_readable", fake_readable)
    with pytest.raises(PermissionDeniedError):
        await svc.assert_attachment_access(_user(), "file-1.pdf")


@pytest.mark.asyncio
async def test_assert_attachment_missing_file_is_not_found(monkeypatch, tmp_path: Path):
    db = AsyncMock()
    svc = CrmService(db)
    missing = tmp_path / "gone.pdf"

    monkeypatch.setattr(
        "app.modules.crm.attachment_store.resolve_attachment_path",
        lambda _aid: missing,
    )
    monkeypatch.setattr(svc.repo, "get_attachment_storage_id", AsyncMock(return_value="gone.pdf"))
    with pytest.raises(NotFoundError):
        await svc.assert_attachment_access(_user(scope="own"), "gone.pdf")


@pytest.mark.asyncio
async def test_resolve_owner_user_id_rejects_unknown_name(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    from app.modules.users.repository import UsersRepository

    async def fake_resolve_bound(self, name):
        del self, name

    monkeypatch.setattr(UsersRepository, "resolve_user_id_by_owner_name", fake_resolve_bound)
    with pytest.raises(ValidationError):
        await svc._resolve_owner_user_id(_user(), "不存在的人")


@pytest.mark.asyncio
async def test_resolve_owner_user_id_allows_self_name_without_directory_hit(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    from app.modules.users.repository import UsersRepository

    async def fake_resolve_bound(self, name):
        del self, name

    monkeypatch.setattr(UsersRepository, "resolve_user_id_by_owner_name", fake_resolve_bound)
    uid = await svc._resolve_owner_user_id(_user(user_id="u-a"), "销售A")
    assert uid == "u-a"


@pytest.mark.asyncio
async def test_list_audits_requires_entity_or_all_scope(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)

    with pytest.raises(PermissionDeniedError):
        await svc.list_audits(_user(scope="own"), entity_id=None)

    async def fake_list(**_kwargs):
        return []

    monkeypatch.setattr(svc.repo, "list_audit_records", fake_list)
    items = await svc.list_audits(_user(scope="all"), entity_id=None)
    assert items == []


@pytest.mark.asyncio
async def test_list_audits_asserts_entity_before_query(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    called = {"assert": False}

    async def fake_assert(_user, eid):
        called["assert"] = True
        assert eid == "c-secret"

    async def fake_list(**_kwargs):
        return []

    monkeypatch.setattr(svc, "_assert_entity_id_readable", fake_assert)
    monkeypatch.setattr(svc.repo, "list_audit_records", fake_list)
    monkeypatch.setattr(svc.repo, "get_customer", AsyncMock(return_value=None))
    monkeypatch.setattr(svc.repo, "get_opportunity", AsyncMock(return_value=None))
    await svc.list_audits(_user(), entity_id="c-secret")
    assert called["assert"] is True


def _audit_row(aid: str, entity_id: str, actor_user_id: str | None, module: str = "客户管理"):
    return SimpleNamespace(
        id=aid,
        module=module,
        entity_type="客户",
        entity_id=entity_id,
        entity_name="Acme",
        action="添加客户跟进",
        actor="某销售",
        actor_user_id=actor_user_id,
        timestamp_at=datetime(2026, 8, 11, 10, 0),
    )


@pytest.mark.asyncio
async def test_list_audits_customer_filters_by_actor_scope(monkeypatch):
    """客户是共享主档：own 范围只能看本人操作与线索/需求带入，不能串看他人操作。"""
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-a", scope="own")
    rows = [
        _audit_row("a-other", "c1", "u-b"),  # 他人经营操作 → 过滤
        _audit_row("a-self", "c1", "u-a"),  # 本人 → 保留
        _audit_row("a-origin", "l-src", "u-sdr", module="线索管理"),  # 线索带入 → 保留
        _audit_row("a-null", "c1", None),  # 系统/遗留 → 保留
    ]
    monkeypatch.setattr(svc, "_assert_audit_entity_readable", AsyncMock())
    monkeypatch.setattr(
        svc.repo,
        "get_customer",
        AsyncMock(return_value=SimpleNamespace(document={"sourceLeadId": "l-src"})),
    )
    monkeypatch.setattr(svc.repo, "get_opportunity", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-a"]))
    monkeypatch.setattr(svc.repo, "list_audit_records", AsyncMock(return_value=rows))
    monkeypatch.setattr(
        svc,
        "_audit_children_map",
        AsyncMock(return_value={r.id: {"changes": [], "related": []} for r in rows}),
    )

    items = await svc.list_audits(user, entity_id="c1")
    assert {it.id for it in items} == {"a-self", "a-origin", "a-null"}


@pytest.mark.asyncio
async def test_list_audits_customer_all_scope_keeps_all(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-admin", scope="all")
    rows = [_audit_row("a-other", "c1", "u-b"), _audit_row("a-self", "c1", "u-a")]
    monkeypatch.setattr(svc, "_assert_audit_entity_readable", AsyncMock())
    monkeypatch.setattr(
        svc.repo,
        "get_customer",
        AsyncMock(return_value=SimpleNamespace(document={"sourceLeadId": ""})),
    )
    monkeypatch.setattr(svc.repo, "get_opportunity", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=None))
    monkeypatch.setattr(svc.repo, "list_audit_records", AsyncMock(return_value=rows))
    monkeypatch.setattr(
        svc,
        "_audit_children_map",
        AsyncMock(return_value={r.id: {"changes": [], "related": []} for r in rows}),
    )

    items = await svc.list_audits(user, entity_id="c1")
    assert {it.id for it in items} == {"a-other", "a-self"}


@pytest.mark.asyncio
async def test_list_audits_non_customer_entity_keeps_rows(monkeypatch):
    """非共享主档实体（如线索）不按操作人过滤，保持原有行为。"""
    db = AsyncMock()
    svc = CrmService(db)
    user = _user(user_id="u-a", scope="own")
    rows = [_audit_row("a-other", "l1", "u-b", module="线索管理")]
    monkeypatch.setattr(svc, "_assert_audit_entity_readable", AsyncMock())
    monkeypatch.setattr(svc.repo, "get_customer", AsyncMock(return_value=None))
    monkeypatch.setattr(svc.repo, "get_opportunity", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-a"]))
    monkeypatch.setattr(svc.repo, "list_audit_records", AsyncMock(return_value=rows))
    monkeypatch.setattr(
        svc,
        "_audit_children_map",
        AsyncMock(return_value={r.id: {"changes": [], "related": []} for r in rows}),
    )

    items = await svc.list_audits(user, entity_id="l1")
    assert {it.id for it in items} == {"a-other"}
