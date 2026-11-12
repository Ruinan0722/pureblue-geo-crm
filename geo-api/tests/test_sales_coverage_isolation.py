"""销售对接池隔离：可见集合 / 主档 vs 池 / 改派目录（无真实 DB）。"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ConflictError, PermissionDeniedError, ValidationError
from app.models.crm import CrmLead
from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository import CrmRepository
from app.modules.crm.service import (
    CrmService,
    _customer_update_write_codes,
    _strip_customer_master_document,
)


def _user(
    *,
    user_id: str = "u-a",
    role: str = "sales",
    scope: str = "own",
    permissions: list[str] | None = None,
) -> AuthUser:
    perms = permissions or [
        "section:customers",
        "customers:write",
        "section:leads",
        "leads:write",
    ]
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="销售A",
        role=role,
        permissions=perms,
        data_scope=scope,
        department_names=["销售部"],
    )


def test_unrestricted_owner_clause_for_admin_scope_is_none():
    repo = CrmRepository(AsyncMock())
    assert repo._owner_ids_clause(CrmLead.owner_user_id, None) is None


@pytest.mark.asyncio
async def test_owner_filter_own_is_self_only(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    ids = await svc._owner_filter(_user(scope="own"))
    assert ids == ["u-a"]


@pytest.mark.asyncio
async def test_owner_filter_department_uses_managed_not_peers(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    called = {}

    async def fake_managed(self, uid):
        del self
        called["uid"] = uid
        return ["u-a", "u-sub"]

    from app.modules.users.repository import UsersRepository

    monkeypatch.setattr(UsersRepository, "get_managed_scope_user_ids", fake_managed)
    monkeypatch.setattr(
        UsersRepository,
        "get_department_peer_user_ids",
        AsyncMock(side_effect=AssertionError("should not use peer")),
    )

    ids = await svc._owner_filter(_user(scope="department", role="leader", user_id="u-a"))
    assert ids == ["u-a", "u-sub"]
    assert called["uid"] == "u-a"


@pytest.mark.asyncio
async def test_owner_filter_coverage_scope_self_for_leader(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    ids = await svc._owner_filter(
        _user(scope="department", role="leader"), coverage_scope="self"
    )
    assert ids == ["u-a"]


@pytest.mark.asyncio
async def test_owner_filter_coverage_scope_self_for_all_scope(monkeypatch):
    """all 范围（运营/管理员）开启「只看自己」时也必须收窄到本人，不能短路成全量。"""
    db = AsyncMock()
    svc = CrmService(db)
    ids = await svc._owner_filter(
        _user(scope="all", role="ops"), coverage_scope="self"
    )
    assert ids == ["u-a"]


@pytest.mark.asyncio
async def test_owner_filter_mine_only_for_all_scope(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)
    ids = await svc._owner_filter(_user(scope="all", role="ops"), mine_only=True)
    assert ids == ["u-a"]


@pytest.mark.asyncio
async def test_sdr_cannot_read_customer_master():
    db = AsyncMock()
    svc = CrmService(db)
    with pytest.raises(PermissionDeniedError):
        await svc._assert_customer_master_readable(
            _user(role="sdr", permissions=["section:customers", "section:leads", "leads:write"]),
            SimpleNamespace(id="c1"),
        )


@pytest.mark.asyncio
async def test_sales_can_read_customer_master_without_coverage():
    db = AsyncMock()
    svc = CrmService(db)
    await svc._assert_customer_master_readable(_user(), SimpleNamespace(id="c1"))


def _customer_row(customer_id: str = "c1") -> SimpleNamespace:
    return SimpleNamespace(
        id=customer_id,
        company_name="Acme",
        document={"companyName": "Acme", "brandName": "Acme"},
    )


def _coverage_row() -> SimpleNamespace:
    return SimpleNamespace(
        id="cv1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A"},
    )


def _patch_create_customer_deps(svc) -> None:
    svc.repo.create_customer = AsyncMock(return_value=_customer_row())
    svc.repo.create_lead = AsyncMock(return_value=SimpleNamespace(id="lead1", document={}))
    svc._raise_if_company_conflict = AsyncMock()
    svc._resolve_owner_user_id = AsyncMock(return_value="u-a")
    svc._assert_assignable_owner = AsyncMock()
    svc.db.execute = AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=list)))
    svc._get_or_create_coverage = AsyncMock(return_value=(_coverage_row(), True))
    svc._commit_and_invalidate_crm = AsyncMock()
    svc._compose_customer_view_async = AsyncMock(return_value={"id": "c1"})


@pytest.mark.asyncio
async def test_sales_can_create_self_developed_customer():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)

    await svc.create_customer(
        _user(),
        {
            "id": "c1",
            "companyName": "Acme",
            "contactName": "王女士",
            "contactPhone": "13800000000",
            "contactWechat": "wx_001",
            "source": "自拓",
            "isKey": True,
            "foundedDate": "2015-06-01",
        },
    )

    created_doc = svc.repo.create_customer.await_args.kwargs["document"]
    assert created_doc["source"] == "自拓"
    assert created_doc["companyName"] == "Acme"
    assert created_doc["foundedDate"] == "2015-06-01"
    assert svc.repo.create_customer.await_args.kwargs["owner_user_id"] == "u-a"
    seed = svc._get_or_create_coverage.await_args.kwargs["seed"]
    assert seed["contacts"][0]["name"] == "王女士"
    assert seed["contacts"][0]["phone"] == "13800000000"
    assert seed["contacts"][0]["wechat"] == "wx_001"
    assert seed["contacts"][0]["source"] == "自拓"
    assert seed["isKey"] is True
    lead_doc = svc.repo.create_lead.await_args.kwargs["document"]
    assert svc.repo.create_lead.await_args.kwargs["owner_user_id"] == "u-a"
    assert lead_doc["status"] == "converted"
    assert lead_doc["followState"] == "converted"
    assert lead_doc["source"] == "自拓"
    assert lead_doc["sales"] == "销售A"
    assert lead_doc["companyName"] == "Acme"
    assert lead_doc["convertedCustomerId"] == "c1"
    assert lead_doc["convertedCoverageId"] == "cv1"
    assert lead_doc["sourceCustomerId"] == "c1"
    assert seed["contacts"][0]["sourceLeadId"] == lead_doc["id"]
    svc._commit_and_invalidate_crm.assert_awaited_once_with("u-a", "u-a")


@pytest.mark.asyncio
async def test_create_customer_rejects_unsupported_source():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)

    with pytest.raises(ValidationError, match="来源仅支持"):
        await svc.create_customer(
            _user(),
            {
                "id": "c1",
                "companyName": "Acme",
                "contactName": "王女士",
                "contactWechat": "wx_001",
                "source": "官网注册",
            },
        )


@pytest.mark.asyncio
async def test_create_customer_reads_contact_from_contacts_array():
    """前端经 provider 把联系人组装进 document.contacts[0]，后端应能解析。"""
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)

    await svc.create_customer(
        _user(),
        {
            "id": "c1",
            "companyName": "Acme",
            "source": "自拓",
            "contacts": [
                {
                    "name": "王女士",
                    "title": "经理",
                    "phone": "13800000000",
                    "wechat": "wx_001",
                    "email": "a@b.com",
                    "wechatAdded": True,
                }
            ],
        },
    )

    seed = svc._get_or_create_coverage.await_args.kwargs["seed"]
    contact = seed["contacts"][0]
    assert contact["name"] == "王女士"
    assert contact["title"] == "经理"
    assert contact["phone"] == "13800000000"
    assert contact["wechat"] == "wx_001"
    assert contact["email"] == "a@b.com"
    assert contact["wechatAdded"] is True
    lead_doc = svc.repo.create_lead.await_args.kwargs["document"]
    assert lead_doc["contactName"] == "王女士"
    assert lead_doc["contactPhone"] == "13800000000"
    assert lead_doc["contactWechat"] == "wx_001"


@pytest.mark.asyncio
async def test_create_customer_requires_company_name():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    with pytest.raises(ValidationError, match="公司名称不能为空"):
        await svc.create_customer(
            _user(), {"contactName": "王女士", "contactPhone": "13800000000"}
        )


@pytest.mark.asyncio
async def test_create_customer_requires_contact_name():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    with pytest.raises(ValidationError, match="联系人姓名不能为空"):
        await svc.create_customer(_user(), {"companyName": "Acme"})


@pytest.mark.asyncio
async def test_create_customer_requires_phone_or_wechat():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    with pytest.raises(ValidationError, match="联系人电话或微信至少填写一项"):
        await svc.create_customer(
            _user(), {"companyName": "Acme", "contactName": "王女士"}
        )


@pytest.mark.asyncio
async def test_create_customer_requires_customers_write():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    with pytest.raises(PermissionDeniedError):
        await svc.create_customer(
            _user(permissions=["section:customers"]),
            {"companyName": "Acme", "contactName": "王女士", "contactPhone": "13800000000", "source": "自拓"},
        )


@pytest.mark.asyncio
async def test_create_customer_keeps_selected_meeting_source_on_all_documents():
    svc = CrmService(AsyncMock())
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    _patch_create_customer_deps(svc)
    option = SimpleNamespace(display_name="2026 GEO 增长峰会")
    svc.db.execute = AsyncMock(
        return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [option]))
    )

    await svc.create_customer(
        _user(),
        {
            "id": "c1",
            "companyName": "Acme",
            "contactName": "王女士",
            "contactPhone": "13800000000",
            "source": "三方会议",
            "sourceDetail": "2026 GEO 增长峰会",
        },
    )

    customer = svc.repo.create_customer.await_args.kwargs["document"]
    contact = svc._get_or_create_coverage.await_args.kwargs["seed"]["contacts"][0]
    lead = svc.repo.create_lead.await_args.kwargs["document"]
    for document in (customer, contact, lead):
        assert document["source"] == "三方会议"
        assert document["sourceDetail"] == "2026 GEO 增长峰会"


@pytest.mark.asyncio
async def test_create_customer_requires_available_meeting_source_detail():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    option = SimpleNamespace(display_name="2026 GEO 增长峰会")
    svc.db.execute = AsyncMock(
        return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [option]))
    )

    with pytest.raises(ValidationError, match="请选择二级来源"):
        await svc.create_customer(
            _user(),
            {
                "companyName": "Acme",
                "contactName": "王女士",
                "contactPhone": "13800000000",
                "source": "三方会议",
            },
        )


@pytest.mark.asyncio
async def test_create_customer_rechecks_company_conflict():
    svc = CrmService(AsyncMock())
    _patch_create_customer_deps(svc)
    svc._raise_if_company_conflict = AsyncMock(
        side_effect=ConflictError("该公司已存在客户档案，请关联公司并建立我的对接，勿重复新建")
    )
    with pytest.raises(ConflictError, match="该公司已存在客户档案"):
        await svc.create_customer(
            _user(),
            {"companyName": "Acme", "contactName": "王女士", "contactPhone": "13800000000", "source": "自拓"},
        )


@pytest.mark.asyncio
async def test_customer_create_candidates_returns_matches():
    svc = CrmService(AsyncMock())
    svc._collect_convert_candidates = AsyncMock(
        return_value=(
            [
                {"id": "c1", "companyName": "Acme", "matchType": "exact"},
                {"id": "c2", "companyName": "Acme 科技", "matchType": "partial"},
            ],
            1,
        )
    )

    result = await svc.customer_create_candidates(
        _user(), company_name="Acme", credit_code=""
    )

    assert len(result["items"]) == 2
    assert result["hidden_match_count"] == 1
    assert result["company_name"] == "Acme"
    call = svc._collect_convert_candidates.await_args.kwargs
    assert call["include_partial"] is True


@pytest.mark.asyncio
async def test_customer_create_candidates_requires_customers_write():
    svc = CrmService(AsyncMock())
    with pytest.raises(PermissionDeniedError):
        await svc.customer_create_candidates(
            _user(permissions=["section:customers"]), company_name="Acme"
        )


@pytest.mark.asyncio
async def test_customer_write_helpers_accept_fine_or_coarse():
    """细粒度写权限：细码或遗留总写码（customers:write）任一命中即放行。"""
    svc = CrmService(AsyncMock())
    fine = _user(permissions=["section:customers", "customers:contact_add"])
    svc._assert_customer_write(fine, "customers:contact_add")
    coarse = _user()  # 默认含 customers:write
    svc._assert_customer_write(coarse, "customers:contact_add")
    with pytest.raises(PermissionDeniedError):
        svc._assert_customer_write(
            _user(permissions=["section:customers"]), "customers:contact_add"
        )


def test_customer_update_write_codes_infers_from_payload():
    assert _customer_update_write_codes({"status": "connected"}) == {
        "customers:status_change"
    }
    assert _customer_update_write_codes({"contacts": [{"id": "ct1", "name": "张三"}]}) == {
        "customers:contact_edit"
    }
    assert _customer_update_write_codes({"notes": [{"content": "跟进"}]}) == {
        "customers:follow_add"
    }
    assert _customer_update_write_codes({"attachments": [{"id": "a1"}]}) == {
        "customers:attachment_upload"
    }
    assert _customer_update_write_codes({"companyName": "新公司名"}) == {
        "customers:master_edit"
    }
    # 空数组/空串行李不触发权限码
    assert _customer_update_write_codes({"contacts": [], "notes": []}) == set()


@pytest.mark.asyncio
async def test_lead_opportunity_contract_write_helpers_accept_fine_or_coarse():
    """线索/商机/合同细粒度写权限：细码或遗留总写码任一命中即放行。"""
    svc = CrmService(AsyncMock())

    fine_lead = _user(permissions=["section:leads", "leads:convert"])
    svc._assert_lead_write(fine_lead, "leads:convert")
    coarse_lead = _user(permissions=["section:leads", "leads:write"])
    svc._assert_lead_write(coarse_lead, "leads:convert")
    with pytest.raises(PermissionDeniedError):
        svc._assert_lead_write(_user(permissions=["section:leads"]), "leads:convert")

    fine_opp = _user(permissions=["section:opportunities", "opportunities:stage"])
    svc._assert_opportunity_write(fine_opp, "opportunities:stage")
    with pytest.raises(PermissionDeniedError):
        svc._assert_opportunity_write(
            _user(permissions=["section:opportunities"]), "opportunities:stage"
        )

    fine_contract = _user(permissions=["section:contracts", "contracts:sign"])
    svc._assert_contract_write(fine_contract, "contracts:sign")
    with pytest.raises(PermissionDeniedError):
        svc._assert_contract_write(
            _user(permissions=["section:contracts"]), "contracts:sign"
        )


@pytest.mark.asyncio
async def test_update_lead_invalid_requires_invalid_permission():
    """标记无效走 leads:invalid 细码；普通编辑/跟进走 leads:edit。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="lead1",
        owner_user_id="u-a",
        status="touched",
        created_at=datetime(2026, 8, 6),
        document={},
    )
    svc.repo.get_lead = AsyncMock(return_value=row)
    svc.repo.save_lead = AsyncMock(return_value=row)
    svc.repo.get_lead_children = AsyncMock(return_value={"importMeta": None, "notes": []})
    svc._assert_row_access = AsyncMock()
    svc._commit_and_invalidate_crm = AsyncMock()

    edit_only = _user(permissions=["section:leads", "leads:edit"])
    await svc.update_lead(edit_only, "lead1", {"contactName": "张三"})
    with pytest.raises(PermissionDeniedError):
        await svc.update_lead(edit_only, "lead1", {"status": "invalid"})

    with_invalid = _user(permissions=["section:leads", "leads:edit", "leads:invalid"])
    await svc.update_lead(with_invalid, "lead1", {"status": "invalid"})


@pytest.mark.asyncio
async def test_update_lead_returns_notes_from_child_table():
    """添加跟进后 PATCH 响应须带回子表 notes，避免前端 upsert 清空列表。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="lead1",
        owner_user_id="u-a",
        status="touched",
        created_at=datetime(2026, 8, 6),
        document={"companyName": "Acme", "status": "touched"},
        contact_title=None,
        contact_department=None,
        contact_phone=None,
        contact_wechat=None,
        email=None,
        website=None,
        city=None,
        invalid_reason=None,
        wechat_added=None,
        converted_customer_id=None,
        converted_coverage_id=None,
        source_customer_id=None,
        created_day=None,
    )
    svc.repo.get_lead = AsyncMock(return_value=row)
    svc.repo.save_lead = AsyncMock(return_value=row)
    svc.repo.get_lead_children = AsyncMock(
        return_value={
            "importMeta": None,
            "notes": [
                {
                    "id": "ln1",
                    "author": "销售A",
                    "content": "已电话沟通",
                    "date": "2026-08-08 00:10:00",
                    "followType": "online",
                }
            ],
        }
    )
    svc._assert_row_access = AsyncMock()
    svc._commit_and_invalidate_crm = AsyncMock()

    out = await svc.update_lead(
        _user(permissions=["section:leads", "leads:edit"]),
        "lead1",
        {
            "companyName": "Acme",
            "notes": [{"id": "ln1", "author": "销售A", "content": "已电话沟通"}],
        },
    )
    assert out["notes"][0]["content"] == "已电话沟通"
    assert out["notes"][0]["followType"] == "online"


@pytest.mark.asyncio
async def test_list_customers_shows_all_masters_by_default_and_self_on_mine_only():
    """决策 12：默认列表展示全部公司主档；「只看自己」才按本人对接池过滤。"""
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.search_customers = AsyncMock(return_value=([], 0))
    svc.repo.list_coverages_for_customers = AsyncMock(return_value={})
    svc.repo.count_opportunities_by_customer_ids = AsyncMock(return_value={})
    svc.repo.count_contracts_by_customer_ids = AsyncMock(return_value={})
    svc._compose_customer_view_async = AsyncMock(return_value={"id": "c1"})

    await svc.list_customers(_user())
    assert svc.repo.search_customers.await_args.kwargs["include_all_masters"] is True

    svc.repo.search_customers.reset_mock()
    await svc.list_customers(_user(), mine_only=True)
    assert svc.repo.search_customers.await_args.kwargs["include_all_masters"] is False


@pytest.mark.asyncio
async def test_search_customers_include_all_masters_skips_coverage_visibility():
    db = AsyncMock()
    repo = CrmRepository(db)
    executed: list = []

    async def fake_execute(stmt):
        executed.append(stmt)
        return SimpleNamespace(
            scalar_one=lambda: 0,
            scalars=lambda: SimpleNamespace(all=list),
        )

    db.execute = fake_execute
    await repo.search_customers(["u1"], include_all_masters=True)
    sql = " ".join(str(s.compile(compile_kwargs={"literal_binds": True})) for s in executed)
    assert "crm_customers" in sql
    assert "crm_sales_coverages" not in sql


@pytest.mark.asyncio
async def test_aggregate_customer_stats_count_all_masters_reads_master_table():
    db = AsyncMock()
    repo = CrmRepository(db)
    executed: list = []

    async def fake_execute(stmt):
        executed.append(stmt)
        return SimpleNamespace(scalar_one=lambda: 5, one=lambda: None)

    db.execute = fake_execute
    out = await repo.aggregate_customer_stats(["u1"], count_all_masters=True)
    first = str(executed[0].compile(compile_kwargs={"literal_binds": True}))
    assert "crm_customers" in first
    assert "crm_sales_coverages" not in first
    assert out["total"] == 5


@pytest.mark.asyncio
async def test_customer_status_filter_uses_contact_status():
    """客户列表状态筛选按 crm_contacts 表聚合。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    filters = repo._customer_filter_clauses(status="awaiting_contact", owner_ids=["u1"])
    sql = " ".join(str(f.compile(compile_kwargs={"literal_binds": True})) for f in filters)
    assert "crm_contacts" in sql
    assert "awaiting_contact" in sql


@pytest.mark.asyncio
async def test_aggregate_customer_stats_buckets_by_contact_status():
    """统计卡状态桶按 crm_contacts 表聚合。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    executed: list = []

    async def fake_execute(stmt):
        executed.append(stmt)
        return SimpleNamespace(scalar_one=lambda: 7, one=lambda: None)

    db.execute = fake_execute
    await repo.aggregate_customer_stats(["u1"], count_all_masters=True)
    sqls = [str(s.compile(compile_kwargs={"literal_binds": True})) for s in executed]
    bucket_sql = " ".join(sqls[1:])
    assert "crm_contacts" in bucket_sql


@pytest.mark.asyncio
async def test_add_customer_contact_backfills_converted_lead_for_current_sales():
    svc = CrmService(AsyncMock())
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    option = SimpleNamespace(display_name="2026 GEO 增长峰会")
    svc.db.execute = AsyncMock(
        return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [option]))
    )
    customer = SimpleNamespace(
        id="c1", company_name="Acme", document={"companyName": "Acme", "brandName": "A"}
    )
    coverage = SimpleNamespace(
        id="cv1", owner_user_id="u-a", status="connected", document={"contacts": []}
    )
    svc.repo.get_customer = AsyncMock(return_value=customer)
    svc.repo.get_coverage_by_customer_owner = AsyncMock(return_value=coverage)
    svc.repo.save_coverage = AsyncMock(return_value=coverage)

    async def create_lead(*, document, owner_user_id):
        assert owner_user_id == "u-a"
        assert document["sales"] == "销售A"
        assert document["status"] == "converted"
        assert document["convertedCustomerId"] == "c1"
        assert document["source"] == "三方会议"
        assert document["sourceDetail"] == "2026 GEO 增长峰会"
        assert document["notes"] == []
        assert document["attachments"] == []
        return SimpleNamespace(id=document["id"], document=document)

    svc.repo.create_lead = AsyncMock(side_effect=create_lead)
    svc._assert_customer_master_readable = AsyncMock()
    svc._assert_coverage_access = AsyncMock()
    svc._validate_lead_source_option = AsyncMock()
    svc._commit_and_invalidate_crm = AsyncMock()
    svc._compose_customer_view_async = AsyncMock(return_value={"id": "c1"})

    result = await svc.create_customer_contact_lead(
        _user(),
        "c1",
        {
            "contactName": "王女士",
            "contactPhone": "13800000000",
            "source": "三方会议",
            "sourceDetail": "2026 GEO 增长峰会",
        },
    )

    assert result["lead"]["contactName"] == "王女士"
    saved_contacts = svc.repo.save_coverage.await_args.args[1]["contacts"]
    assert saved_contacts[0]["phone"] == "13800000000"
    assert saved_contacts[0]["source"] == "三方会议"
    assert saved_contacts[0]["sourceDetail"] == "2026 GEO 增长峰会"
    assert saved_contacts[0]["sourceLeadId"] == result["lead"]["id"]


def test_strip_customer_master_drops_pool_fields():
    doc = _strip_customer_master_document(
        {
            "companyName": "Acme",
            "contacts": [{"name": "X"}],
            "notes": [],
            "status": "connected",
            "owner": "张三",
            "creditCode": "91",
        }
    )
    assert doc["companyName"] == "Acme"
    assert doc["creditCode"] == "91"
    assert "contacts" not in doc
    assert "status" not in doc
    assert "owner" not in doc


@pytest.mark.asyncio
async def test_compose_customer_view_hides_pool_without_coverage():
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme", "brandName": "A", "migrationStatus": "done"},
    )
    view = svc._compose_customer_view(_user(), row, [])
    assert view["companyName"] == "Acme"
    assert view["contacts"] == []
    assert view["status"] == ""
    assert view["myCoverageId"] is None


@pytest.mark.asyncio
async def test_compose_customer_view_normalizes_empty_master_fields_for_edit_form():
    """历史客户缺少可选主档字段时，API 仍应符合 Customer 的必有字符串契约。"""
    svc = CrmService(AsyncMock())
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={
            "companyName": "Acme",
            "registeredCapital": "历史非数字值",
            "migrationStatus": "done",
        },
    )

    view = svc._compose_customer_view(_user(), row, [])

    assert view["companyName"] == "Acme"
    for key in (
        "brandName",
        "region",
        "city",
        "industryL1",
        "industryL2",
        "foundedDate",
        "creditCode",
        "scale",
        "nature",
        "sdrTransferDate",
        "source",
        "createdAt",
    ):
        assert view[key] == ""
    assert view["registeredCapital"] == 0.0


def test_compose_customer_view_stamps_owner_on_single_pool_for_admin():
    """单池客户：管理员/运营/超管（非 own 范围）也须拿到联系人归属标注。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme", "brandName": "A", "migrationStatus": "done"},
    )
    coverage = SimpleNamespace(
        id="cv1",
        customer_id="c1",
        owner_user_id="u-s",
        status="connected",
        document={"ownerName": "销售B"},
    )
    children = {
        "cv1": {
            "contacts": [{"id": "ct1", "name": "张三", "title": "经理"}],
            "notes": [{"id": "fu1", "author": "销售B", "content": "已电话"}],
            "attachments": [],
        }
    }
    view = svc._compose_customer_view(
        _user(role="admin", scope="all"),
        row,
        [coverage],
        coverage_children=children,
    )
    assert view["contacts"][0]["coverageOwner"] == "销售B"
    assert view["notes"][0]["coverageOwner"] == "销售B"


def test_compose_customer_view_sorts_visible_notes_across_coverages_newest_first():
    """多池汇总按跟进时间全局倒序，来源和池顺序不得形成分组。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme", "migrationStatus": "done"},
    )
    coverage_a = SimpleNamespace(
        id="cv-a",
        customer_id="c1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A"},
    )
    coverage_b = SimpleNamespace(
        id="cv-b",
        customer_id="c1",
        owner_user_id="u-b",
        status="connected",
        document={"ownerName": "销售B"},
    )
    children = {
        "cv-a": {
            "contacts": [],
            "notes": [
                {"id": "customer-new", "date": "2026-08-11 15:30:00", "content": "客户新增"},
                {"id": "customer-old", "date": "2026-08-08 16:45:00", "content": "客户历史"},
            ],
            "attachments": [],
        },
        "cv-b": {
            "contacts": [],
            "notes": [
                {"id": "lead", "date": "2026-08-10 10:20:00", "content": "线索带入", "origin": "lead"},
                {"id": "website", "date": "2026-08-09 09:00:00", "content": "官网带入"},
            ],
            "attachments": [],
        },
    }

    view = svc._compose_customer_view(
        _user(role="admin", scope="all"),
        row,
        [coverage_a, coverage_b],
        coverage_children=children,
    )

    assert [note["id"] for note in view["notes"]] == [
        "customer-new",
        "lead",
        "website",
        "customer-old",
    ]
    assert view["notes"][1]["origin"] == "lead"
    assert view["notes"][1]["coverageOwner"] == "销售B"


def test_compose_customer_view_keeps_own_single_pool_unstamped():
    """own 范围（普通销售）单池：联系人不标注归属，保持既有行为。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme", "brandName": "A", "migrationStatus": "done"},
    )
    coverage = SimpleNamespace(
        id="cv1",
        customer_id="c1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A"},
    )
    children = {
        "cv1": {
            "contacts": [{"id": "ct1", "name": "张三"}],
            "notes": [],
            "attachments": [],
        }
    }
    view = svc._compose_customer_view(
        _user(role="sales", scope="own"),
        row,
        [coverage],
        coverage_children=children,
    )
    assert "coverageOwner" not in view["contacts"][0]


@pytest.mark.asyncio
async def test_sdr_can_link_existing_customer_for_convert():
    db = AsyncMock()
    svc = CrmService(db)
    await svc._assert_customer_linkable_for_convert(
        _user(role="sdr", permissions=["section:customers", "section:leads", "leads:write"]),
        SimpleNamespace(id="c1"),
    )


@pytest.mark.asyncio
async def test_sdr_can_link_with_fine_grained_convert_permission():
    """SDR 矩阵只授 leads:convert（无遗留 leads:write），挂靠已有客户必须放行。"""
    db = AsyncMock()
    svc = CrmService(db)
    await svc._assert_customer_linkable_for_convert(
        _user(role="sdr", permissions=["section:customers", "section:leads", "leads:convert"]),
        SimpleNamespace(id="c1"),
    )


@pytest.mark.asyncio
async def test_sdr_linkable_requires_leads_write():
    db = AsyncMock()
    svc = CrmService(db)
    with pytest.raises(PermissionDeniedError):
        await svc._assert_customer_linkable_for_convert(
            _user(role="sdr", permissions=["section:customers", "section:leads"]),
            SimpleNamespace(id="c1"),
        )


def test_strip_customer_master_drops_response_meta():
    doc = _strip_customer_master_document(
        {
            "companyName": "Acme",
            "coverages": [{"id": "cv-1"}],
            "myCoverageId": "cv-1",
            "canEditMaster": True,
            "opportunityCount": 3,
            "contractCount": 1,
            "creditCode": "91",
        }
    )
    assert doc["companyName"] == "Acme"
    assert doc["creditCode"] == "91"
    assert "coverages" not in doc
    assert "myCoverageId" not in doc
    assert "canEditMaster" not in doc
    assert "opportunityCount" not in doc


@pytest.mark.asyncio
async def test_customer_attachment_requires_visible_coverage(monkeypatch):
    db = AsyncMock()
    svc = CrmService(db)

    async def fake_owners(_user, **_kwargs):
        return ["u-a"]

    async def fake_has(_cid, owners):
        assert owners == ["u-a"]
        return False

    monkeypatch.setattr(svc, "_owner_filter", fake_owners)
    monkeypatch.setattr(svc.repo, "customer_has_coverage_for_owners", fake_has)
    with pytest.raises(PermissionDeniedError):
        await svc._assert_customer_attachment_access(_user(), "c1")


@pytest.mark.asyncio
async def test_update_customer_auto_creates_coverage_on_operating_write(monkeypatch):
    """首次维护客户（含状态等经营字段）时自动建立本人对接池，对用户透明（决策 12）。"""
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    row = SimpleNamespace(
        id="c1",
        owner_user_id="u-a",
        status="awaiting_contact",
        company_name="Acme",
        document={"companyName": "Acme", "createdByUserId": "u-a"},
    )
    coverage = SimpleNamespace(
        id="cv1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A", "contacts": [], "notes": [], "attachments": []},
    )

    async def fake_get(cid):
        return row

    async def fake_cov(*_a, **_k):
        return None

    calls = {"saved": False}

    async def fake_save_cov(cov, doc, *, status):
        calls["saved"] = True
        assert doc["status"] == "connected"
        return cov

    monkeypatch.setattr(svc.repo, "get_customer", fake_get)
    monkeypatch.setattr(svc.repo, "get_coverage_by_customer_owner", fake_cov)
    monkeypatch.setattr(svc, "_get_or_create_coverage", AsyncMock(return_value=(coverage, True)))
    monkeypatch.setattr(svc, "_assert_coverage_access", AsyncMock())
    monkeypatch.setattr(svc.repo, "save_coverage", fake_save_cov)
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-a"]))
    monkeypatch.setattr(svc.repo, "list_coverages_for_customer", AsyncMock(return_value=[coverage]))
    monkeypatch.setattr(svc, "_compose_customer_view_async", AsyncMock(return_value={"id": "c1"}))

    await svc.update_customer(
        _user(),
        "c1",
        {"companyName": "Acme", "contacts": [], "notes": [], "status": "connected"},
    )
    assert calls["saved"] is True


@pytest.mark.asyncio
async def test_add_contact_auto_creates_coverage_when_missing():
    """新增联系人时若无本人对接池，自动建立后再写入（对用户透明）。"""
    svc = CrmService(AsyncMock())
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    customer = SimpleNamespace(
        id="c1", company_name="Acme", document={"companyName": "Acme", "brandName": "Acme"}
    )
    coverage = SimpleNamespace(
        id="cv1",
        owner_user_id="u-a",
        status="awaiting_contact",
        document={"ownerName": "销售A", "contacts": [], "notes": [], "attachments": []},
    )
    svc.repo.get_customer = AsyncMock(return_value=customer)
    svc.repo.get_coverage_by_customer_owner = AsyncMock(return_value=None)
    svc._get_or_create_coverage = AsyncMock(return_value=(coverage, True))
    svc.repo.save_coverage = AsyncMock(return_value=coverage)
    svc.repo.create_lead = AsyncMock(return_value=SimpleNamespace(id="lead1", document={}))
    svc._commit_and_invalidate_crm = AsyncMock()
    svc._compose_customer_view_async = AsyncMock(return_value={"id": "c1"})

    await svc.create_customer_contact_lead(
        _user(),
        "c1",
        {"contactName": "王女士", "contactPhone": "13800000000", "source": "自拓"},
    )

    svc._get_or_create_coverage.assert_awaited_once()
    kwargs = svc._get_or_create_coverage.await_args.kwargs
    assert kwargs["customer_id"] == "c1"
    assert kwargs["owner_user_id"] == "u-a"
    assert kwargs["seed"]["ownerName"] == "销售A"


@pytest.mark.asyncio
async def test_update_customer_allows_master_save_with_empty_pool_baggage(monkeypatch):
    """Leader 无池公司：前端整包带空 contacts 时仍可只改主档。"""
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    row = SimpleNamespace(
        id="c1",
        owner_user_id=None,
        status="awaiting_contact",
        company_name="Acme",
        document={"companyName": "Acme", "brandName": "A"},
    )
    saved = {"doc": None}

    async def fake_get(cid):
        return row

    async def fake_cov(*_a, **_k):
        return None

    async def fake_save(r, document, owner_user_id=None):
        saved["doc"] = document
        r.document = document
        r.company_name = str(document.get("companyName") or r.company_name)
        return r

    monkeypatch.setattr(svc.repo, "get_customer", fake_get)
    monkeypatch.setattr(svc.repo, "get_coverage_by_customer_owner", fake_cov)
    monkeypatch.setattr(svc.repo, "save_customer", fake_save)
    monkeypatch.setattr(svc.repo, "list_coverages_for_customer", AsyncMock(return_value=[]))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-lead"]))
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())
    monkeypatch.setattr(svc, "_get_or_create_coverage", AsyncMock(side_effect=AssertionError("no create")))

    view = await svc.update_customer(
        _user(role="leader", scope="department", user_id="u-lead"),
        "c1",
        {
            "companyName": "Acme Corp",
            "brandName": "A",
            "contacts": [],
            "notes": [],
            "attachments": [],
            "status": "",
            "coverages": [],
            "myCoverageId": None,
        },
    )
    assert saved["doc"] is not None
    assert saved["doc"]["companyName"] == "Acme Corp"
    assert "contacts" not in saved["doc"]
    assert view["companyName"] == "Acme Corp"
    assert view["contacts"] == []


@pytest.mark.asyncio
async def test_update_customer_leader_echo_does_not_overwrite_subordinate_pool(monkeypatch):
    """Leader 无本人池时，整包带回下属 contacts/status 不得 save_coverage。"""
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    row = SimpleNamespace(
        id="c1",
        owner_user_id="u-sales",
        status="connected",
        company_name="Acme",
        document={"companyName": "Acme", "brandName": "A"},
    )
    saved_cov = {"hit": False}

    async def fake_get(cid):
        return row

    async def fake_own_cov(*_a, **_k):
        return None

    async def fake_save_customer(r, document, owner_user_id=None):
        r.document = document
        r.company_name = str(document.get("companyName") or r.company_name)
        return r

    async def fake_save_coverage(*_a, **_k):
        saved_cov["hit"] = True
        raise AssertionError("must not overwrite subordinate coverage")

    monkeypatch.setattr(svc.repo, "get_customer", fake_get)
    monkeypatch.setattr(svc.repo, "get_coverage_by_customer_owner", fake_own_cov)
    monkeypatch.setattr(svc.repo, "save_customer", fake_save_customer)
    monkeypatch.setattr(svc.repo, "save_coverage", fake_save_coverage)
    monkeypatch.setattr(svc.repo, "list_coverages_for_customer", AsyncMock(return_value=[]))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-lead", "u-sales"]))
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    view = await svc.update_customer(
        _user(role="leader", scope="department", user_id="u-lead"),
        "c1",
        {
            "companyName": "Acme Renamed",
            "brandName": "A",
            "contacts": [{"id": "ct1", "name": "下属联系人"}],
            "notes": [{"id": "n1", "content": "下属跟进"}],
            "attachments": [],
            "status": "cooperating",
            "isKey": True,
            "nextFollowAt": "2026-08-10",
            "myCoverageId": None,
        },
    )
    assert saved_cov["hit"] is False
    assert view["companyName"] == "Acme Renamed"


@pytest.mark.asyncio
async def test_update_customer_leader_with_own_pool_ignores_aggregate_pool_fields(monkeypatch):
    """Leader 有本人池时，customer PATCH 整包带回聚合池字段不得写入本人池。

    读=聚合超集（含下属条目），写=定向子集（走 /coverages/:id）——整包回写
    会把下属联系人/跟进灌入 Leader 本人池（历史串池 bug 的回归保护）。
    """
    db = AsyncMock()
    svc = CrmService(db)
    svc.repo.list_coverage_children = AsyncMock(return_value={})
    svc.repo.list_customer_subsidiaries = AsyncMock(return_value=[])
    row = SimpleNamespace(
        id="c1",
        owner_user_id="u-sales",
        status="connected",
        company_name="Acme",
        document={"companyName": "Acme", "brandName": "A"},
    )
    leader_cov = SimpleNamespace(
        id="cv-lead",
        customer_id="c1",
        owner_user_id="u-lead",
        status="awaiting_contact",
        document={"ownerName": "Leader", "contacts": [{"id": "ct-lead", "name": "本人联系人"}]},
    )
    saved_cov = {"hit": False}

    async def fake_get(cid):
        return row

    async def fake_save_customer(r, document, owner_user_id=None):
        r.document = document
        r.company_name = str(document.get("companyName") or r.company_name)
        return r

    async def fake_save_coverage(*_a, **_k):
        saved_cov["hit"] = True
        raise AssertionError("Leader 有本人池时 customer PATCH 不得回写池")

    monkeypatch.setattr(svc.repo, "get_customer", fake_get)
    monkeypatch.setattr(
        svc.repo, "get_coverage_by_customer_owner", AsyncMock(return_value=leader_cov)
    )
    monkeypatch.setattr(svc.repo, "save_customer", fake_save_customer)
    monkeypatch.setattr(svc.repo, "save_coverage", fake_save_coverage)
    monkeypatch.setattr(svc.repo, "list_coverages_for_customer", AsyncMock(return_value=[leader_cov]))
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=["u-lead", "u-sales"]))
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())

    view = await svc.update_customer(
        _user(role="leader", scope="department", user_id="u-lead"),
        "c1",
        {
            "companyName": "Acme Renamed",
            "brandName": "A",
            "contacts": [
                {"id": "ct-lead", "name": "本人联系人"},
                {"id": "ct-sub", "name": "下属联系人", "coverageOwner": "下属"},
            ],
            "notes": [{"id": "n1", "content": "下属跟进", "coverageOwner": "下属"}],
            "attachments": [],
            "status": "cooperating",
            "isKey": True,
            "nextFollowAt": "2026-08-10",
            "myCoverageId": "cv-lead",
        },
    )
    assert saved_cov["hit"] is False
    assert view["companyName"] == "Acme Renamed"
    # 本人池原样保留：未被聚合回包污染
    assert leader_cov.document["contacts"] == [{"id": "ct-lead", "name": "本人联系人"}]


@pytest.mark.asyncio
async def test_create_coverage_ensures_leader_empty_shell(monkeypatch):
    """销售开池后自动为管辖 Leader 建空壳池。"""
    db = AsyncMock()
    svc = CrmService(db)
    customer = SimpleNamespace(id="c1", company_name="Acme", document={"companyName": "Acme"}, status="awaiting_contact")
    created: list[tuple[str, dict]] = []

    async def fake_get_customer(cid):
        return customer

    async def fake_get_cov(cid, oid):
        return None

    async def fake_create(*, customer_id, owner_user_id, document, status=None):
        created.append((owner_user_id, dict(document)))
        return SimpleNamespace(
            id=f"cv-{owner_user_id}",
            customer_id=customer_id,
            owner_user_id=owner_user_id,
            status=status or "awaiting_contact",
            document=document,
        )

    async def fake_leaders(self, member_id):
        assert member_id == "u-sales"
        return ["u-lead"]

    async def fake_get_user(self, uid):
        return SimpleNamespace(id=uid, name="王 Leader" if uid == "u-lead" else "销售")

    monkeypatch.setattr(svc.repo, "get_customer", fake_get_customer)
    monkeypatch.setattr(svc.repo, "get_coverage_by_customer_owner", fake_get_cov)
    monkeypatch.setattr(svc.repo, "create_coverage", fake_create)
    monkeypatch.setattr(svc, "_assert_customer_master_readable", AsyncMock())
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", AsyncMock())
    monkeypatch.setattr(svc, "get_coverage", AsyncMock(return_value={"id": "cv-u-sales"}))

    from app.modules.users import repository as users_repo_mod

    monkeypatch.setattr(
        users_repo_mod.UsersRepository,
        "get_covering_leader_user_ids",
        fake_leaders,
    )
    monkeypatch.setattr(users_repo_mod.UsersRepository, "get_by_id", fake_get_user)

    await svc.create_customer_coverage(
        _user(user_id="u-sales"),
        "c1",
        document={"ownerName": "销售A", "status": "connected", "contacts": [{"name": "张三"}]},
    )
    owners = [o for o, _ in created]
    assert "u-sales" in owners
    assert "u-lead" in owners
    lead_doc = next(d for o, d in created if o == "u-lead")
    assert lead_doc.get("contacts") == []
    assert (lead_doc.get("importMeta") or {}).get("source") == "auto_leader_coverage"


@pytest.mark.asyncio
async def test_compose_own_scope_merges_coverage_children_contacts():
    """销售 own 单池：扁平 contacts / coverages[].contacts 均须合并子表（含 isPrimary）。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme"},
        owner_user_id="u-a",
    )
    own = SimpleNamespace(
        id="cv-sales",
        customer_id="c1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A", "contacts": [], "notes": [], "attachments": []},
    )
    children = {
        "cv-sales": {
            "contacts": [
                {"id": "cv-sales-ct-0", "name": "张三", "isPrimary": True, "active": True},
                {"id": "cv-sales-ct-1", "name": "李四", "isPrimary": False, "active": True},
            ],
            "notes": [],
            "attachments": [],
        }
    }
    view = svc._compose_customer_view(
        _user(role="sales", scope="own", user_id="u-a"),
        row,
        [own],
        coverage_children=children,
    )
    assert [c.get("name") for c in view["contacts"]] == ["张三", "李四"]
    assert view["contacts"][0].get("isPrimary") is True
    assert view["coverages"][0]["contacts"][0].get("isPrimary") is True
    assert view["coverages"][0]["contacts"][1].get("name") == "李四"


@pytest.mark.asyncio
async def test_get_coverage_merges_child_contacts_with_is_primary(monkeypatch):
    """PATCH/GET 对接池须带回子表联系人，否则前端 coverageToCustomerView 会清空 isPrimary 标签。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="cv-1",
        customer_id="c1",
        owner_user_id="u-a",
        status="connected",
        document={"ownerName": "销售A", "contacts": [], "notes": [], "attachments": []},
        client_dept=None,
        source_lead_id=None,
        sdr_name=None,
        sdr_transfer_date=None,
        isolation_version=1,
    )
    monkeypatch.setattr(svc, "_assert_section", lambda *_a, **_k: None)
    monkeypatch.setattr(svc, "_assert_coverage_access", AsyncMock())
    monkeypatch.setattr(svc.repo, "get_coverage", AsyncMock(return_value=row))
    monkeypatch.setattr(
        svc.repo,
        "list_coverage_children",
        AsyncMock(
            return_value={
                "cv-1": {
                    "contacts": [
                        {"id": "cv-1-ct-0", "name": "王五", "isPrimary": True, "active": True},
                    ],
                    "notes": [],
                    "attachments": [],
                }
            }
        ),
    )
    doc = await svc.get_coverage(_user(user_id="u-a"), "cv-1")
    assert doc["contacts"][0]["name"] == "王五"
    assert doc["contacts"][0]["isPrimary"] is True


@pytest.mark.asyncio
async def test_compose_leader_aggregates_subordinate_contacts():
    """Leader 有空壳本人池时，managed 视图仍汇总下属联系人并标归属。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        company_name="Acme",
        status="connected",
        document={"companyName": "Acme"},
        owner_user_id="u-sales",
    )
    own = SimpleNamespace(
        id="cv-lead",
        customer_id="c1",
        owner_user_id="u-lead",
        status="awaiting_contact",
        document={"ownerName": "王 Leader", "contacts": [], "notes": [], "attachments": []},
    )
    sub = SimpleNamespace(
        id="cv-sales",
        customer_id="c1",
        owner_user_id="u-sales",
        status="connected",
        document={
            "ownerName": "销售A",
            "contacts": [{"id": "ct1", "name": "张三"}],
            "notes": [{"id": "n1", "content": "跟进"}],
            "attachments": [],
        },
    )
    view = svc._compose_customer_view(
        _user(role="leader", scope="department", user_id="u-lead"),
        row,
        [own, sub],
    )
    assert view["myCoverageId"] == "cv-lead"
    assert view["status"] == "awaiting_contact"  # 本人池状态
    names = [c.get("name") for c in view["contacts"]]
    assert "张三" in names
    assert any(c.get("coverageOwner") == "销售A" for c in view["contacts"])
    # 只看自己：仅传入本人池
    self_view = svc._compose_customer_view(
        _user(role="leader", scope="department", user_id="u-lead"),
        row,
        [own],
        aggregate_pools=False,
    )
    assert self_view["contacts"] == []
    assert self_view["myCoverageId"] == "cv-lead"


@pytest.mark.asyncio
async def test_pending_customer_operating_fields_only_for_all(monkeypatch):
    """pending（无池）客户的主档内嵌经营字段仅 all 展示；department 不再跨区域泄漏（决策 12）。"""
    db = AsyncMock()
    svc = CrmService(db)
    row = SimpleNamespace(
        id="c1",
        owner_user_id=None,
        status="potential",
        company_name="Acme",
        document={
            "companyName": "Acme",
            "migrationStatus": "pending",
            "contacts": [{"id": "ct1", "name": "遗留联系人"}],
            "notes": [{"id": "n1", "content": "遗留跟进"}],
            "attachments": [],
        },
    )
    monkeypatch.setattr(svc, "_owner_filter", AsyncMock(return_value=None))

    dept_view = svc._compose_customer_view(
        _user(role="leader", scope="department", user_id="u-lead"),
        row,
        [],
    )
    assert dept_view["contacts"] == []  # 收紧：department 看不到未归因客户的池内容
    assert dept_view["notes"] == []
    assert dept_view["status"] == ""

    all_view = svc._compose_customer_view(
        _user(role="admin", scope="all", user_id="u-admin"),
        row,
        [],
    )
    assert all_view["contacts"] == [{"id": "ct1", "name": "遗留联系人"}]  # admin/ops 保留可见


@pytest.mark.asyncio
async def test_unassigned_visibility_bound_to_managed_owners(monkeypatch):
    """include_unassigned 收紧：无池公司仅当 owner/创建人 ∈ 可见集合才可见（跨区域不泄漏）。"""

    from app.modules.crm.repository import CrmRepository

    db = AsyncMock()
    repo = CrmRepository(db)
    clause = repo._customer_visibility_clause(["u-lead"], include_unassigned=True)
    assert clause is not None
    sql = str(clause.compile(compile_kwargs={"literal_binds": True}))
    # 归属过滤生效：owner 列 + 创建人列都在可见集合
    assert "u-lead" in sql
    assert "crm_customers.created_by_user_id" in sql
    assert "crm_sales_coverages" in sql
    # 无 include_unassigned 时不含创建人过滤（原语义不变）
    plain = repo._customer_visibility_clause(["u-lead"], include_unassigned=False)
    assert "created_by_user_id" not in str(plain.compile(compile_kwargs={"literal_binds": True}))


@pytest.mark.asyncio
async def test_request_detail_uses_managed_not_peer(monkeypatch):
    """需求详情/改写校验与列表一致：department 走 managed 集合（S5）。"""
    from app.core import deps as deps_mod
    from app.modules.users.repository import UsersRepository

    async def fake_managed(self, user_id):
        del self
        assert user_id == "u-lead"
        return ["u-lead", "u-sub"]

    monkeypatch.setattr(UsersRepository, "get_managed_scope_user_ids", fake_managed)
    monkeypatch.setattr(
        UsersRepository,
        "get_department_peer_user_ids",
        AsyncMock(side_effect=AssertionError("详情校验不得再用 peer")),
    )

    ok = await deps_mod.user_can_view_request(
        AsyncMock(),
        "u-sub",  # Leader 的跨部门下属
        _user(role="leader", scope="department", user_id="u-lead", permissions=["request:view"]),
    )
    assert ok is True


@pytest.mark.asyncio
async def test_request_detail_presales_sees_only_managed_self(monkeypatch):
    """售前（department 无管辖）详情按 managed（≈自己），不再可看同部门同伴需求（D3）。"""
    from app.core import deps as deps_mod
    from app.modules.users.repository import UsersRepository

    async def fake_managed(self, user_id):
        del self
        assert user_id == "u-presales"
        return ["u-presales"]

    monkeypatch.setattr(UsersRepository, "get_managed_scope_user_ids", fake_managed)
    monkeypatch.setattr(
        UsersRepository,
        "get_department_peer_user_ids",
        AsyncMock(side_effect=AssertionError("不得回退 peer 互看例外")),
    )

    ok = await deps_mod.user_can_view_request(
        AsyncMock(),
        "u-peer",  # 同部门同伴
        _user(role="presales", scope="department", user_id="u-presales", permissions=["request:view"]),
    )
    assert ok is False
