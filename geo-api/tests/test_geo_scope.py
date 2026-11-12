"""Overseas role geo scope helpers and CRM/list isolation behavior."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import PermissionDeniedError
from app.core.geo_scope import (
    apply_intake_geo_stamp,
    forced_geo_source,
    matches_forced_geo,
    opportunity_geo_from_request_map,
    prefer_linked_geo,
    resolve_request_geo_source,
)
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService
from app.modules.invites.service import InviteService


def test_forced_geo_source_overseas_only():
    assert forced_geo_source(SimpleNamespace(role="overseas")) == "overseas"
    assert forced_geo_source(SimpleNamespace(role="sales")) is None
    assert forced_geo_source(SimpleNamespace(role="admin")) is None


def test_apply_intake_geo_stamp_overrides_client():
    forged = {"importMeta": {"source": "国内GEO需求"}, "companyName": "X"}
    out = apply_intake_geo_stamp(forged, "overseas")
    assert out["importMeta"]["source"] == "海外GEO需求"
    assert out["companyName"] == "X"
    assert apply_intake_geo_stamp({}, "domestic")["importMeta"]["source"] == "国内GEO需求"


def test_resolve_request_geo_source_from_meta_and_code():
    assert (
        resolve_request_geo_source(code="X", data={"importMeta": {"source": "海外GEO需求"}})
        == "overseas"
    )
    assert (
        resolve_request_geo_source(code="X", data={"importMeta": {"source": "国内GEO需求"}})
        == "domestic"
    )
    assert resolve_request_geo_source(code="GEO-OV-001", data={}) == "overseas"
    assert resolve_request_geo_source(code="GEO-CN-001", data={}) == "domestic"
    assert resolve_request_geo_source(code="REQ-1", data={}) == "manual"


def test_matches_forced_geo():
    assert matches_forced_geo(None, "domestic")
    assert matches_forced_geo("overseas", "overseas")
    assert not matches_forced_geo("overseas", "domestic")
    assert not matches_forced_geo("overseas", "manual")


def test_prefer_linked_geo_over_stamped():
    assert prefer_linked_geo(linked="domestic", stamped="overseas") == "domestic"
    assert prefer_linked_geo(linked=None, stamped="overseas") == "overseas"
    assert prefer_linked_geo(linked=None, stamped=None) == "manual"
    # linked=manual 不挡住 stamp，避免空溯源短路
    assert prefer_linked_geo(linked="manual", stamped="overseas") == "overseas"


def test_coalesce_geo_sources_skips_manual():
    from app.core.geo_scope import coalesce_geo_sources

    assert coalesce_geo_sources("manual", "domestic", "overseas") == "domestic"
    assert coalesce_geo_sources(None, "manual", "overseas") == "overseas"
    assert coalesce_geo_sources(None, "manual") == "manual"
    assert coalesce_geo_sources() == "manual"


def test_opportunity_geo_from_request_map_ignores_forged_stamp():
    doc = {
        "geoSource": "overseas",
        "requestIds": ["req-cn"],
    }
    assert opportunity_geo_from_request_map(doc, {"req-cn": "domestic"}) == "domestic"
    assert opportunity_geo_from_request_map({"geoSource": "overseas"}, {}) == "overseas"
    assert opportunity_geo_from_request_map({}, {}) == "manual"


def test_opportunity_geo_manual_request_falls_back_to_stamp():
    """绑定需求为 manual 时不得短路丢掉 document.geoSource。"""
    doc = {"geoSource": "overseas", "requestIds": ["req-manual"]}
    assert opportunity_geo_from_request_map(doc, {"req-manual": "manual"}) == "overseas"
    # 多条：具体归属优先于 manual
    doc2 = {"geoSource": "mestbo", "requestIds": ["req-m", "req-ov"]}
    assert (
        opportunity_geo_from_request_map(doc2, {"req-m": "manual", "req-ov": "overseas"})
        == "overseas"
    )
    # 缺失 map 条目时回落 stamp
    assert (
        opportunity_geo_from_request_map(
            {"geoSource": "domestic", "requestIds": ["gone"]},
            {},
        )
        == "domestic"
    )


def _overseas_user() -> AuthUser:
    return AuthUser(
        id="ov-1",
        feishu_open_id="ou_ov",
        name="陈海外",
        role="overseas",
        permissions=[
            "section:opportunities",
            "section:contracts",
            "section:projects",
            "section:requests",
            "opportunities:write",
            "contracts:write",
            "invite:manage",
        ],
        data_scope="all",
    )


def _sales_user() -> AuthUser:
    return AuthUser(
        id="sales-1",
        feishu_open_id="ou_sales",
        name="销售",
        role="sales",
        permissions=["invite:manage", "section:requests"],
        data_scope="own",
    )


@pytest.mark.asyncio
async def test_filter_opportunities_uses_persisted_source():
    svc = CrmService(AsyncMock())
    svc._geo_map_from_request_ids = AsyncMock(
        return_value={"req-cn": "domestic", "req-ov": "overseas"}
    )
    docs = [
        {"id": "o1", "geoSource": "overseas", "requestIds": ["req-cn"]},
        {"id": "o2", "geoSource": "domestic", "requestIds": ["req-ov"]},
        {"id": "o3", "geoSource": "overseas", "requestIds": []},
    ]
    filtered = await svc._filter_opportunity_docs_by_geo(docs, "overseas")
    ids = {d["id"] for d in filtered}
    assert ids == {"o1", "o3"}
    by_id = {d["id"]: d["geoSource"] for d in filtered}
    assert by_id["o1"] == "overseas"
    assert by_id["o3"] == "overseas"


@pytest.mark.asyncio
async def test_filter_contracts_prefers_persisted_opportunity_source():
    svc = CrmService(AsyncMock())

    class _Opp:
        def __init__(self, oid: str, document: dict):
            self.id = oid
            self.document = document
            self.stage = "contact"
            self.owner_user_id = "u1"

    opp_cn = _Opp("opp-cn", {"id": "opp-cn", "geoSource": "overseas", "requestIds": ["req-cn"]})
    opp_ov = _Opp("opp-ov", {"id": "opp-ov", "geoSource": "domestic", "requestIds": ["req-ov"]})
    svc.repo.list_opportunities_by_ids = AsyncMock(return_value=[opp_cn, opp_ov])
    svc.repo.list_opportunity_children = AsyncMock(
        return_value={
            "opp-cn": {
                "stageHistory": [],
                "attachments": [],
                "projectTypes": [],
                "requestIds": ["req-cn"],
                "notes": [],
                "advisorNotes": [],
            },
            "opp-ov": {
                "stageHistory": [],
                "attachments": [],
                "projectTypes": [],
                "requestIds": ["req-ov"],
                "notes": [],
                "advisorNotes": [],
            },
        }
    )
    svc._geo_map_from_request_ids = AsyncMock(
        return_value={"req-cn": "domestic", "req-ov": "overseas"}
    )
    docs = [
        {"id": "ct1", "geoSource": "overseas", "opportunityId": "opp-cn"},
        {"id": "ct2", "geoSource": "domestic", "opportunityId": "opp-ov"},
        {"id": "ct3", "geoSource": "overseas", "opportunityId": ""},
    ]
    filtered = await svc._filter_contract_docs_by_geo(docs, "overseas")
    ids = {d["id"] for d in filtered}
    assert ids == {"ct1", "ct3"}


@pytest.mark.asyncio
async def test_stamp_opportunity_blocks_overseas_access_to_domestic_source():
    svc = CrmService(AsyncMock())
    svc._geo_map_from_request_ids = AsyncMock(return_value={"req-cn": "domestic"})
    with pytest.raises(PermissionDeniedError):
        await svc._stamp_opportunity_geo(
            {"requestIds": [], "geoSource": "domestic"},
            _overseas_user(),
        )


@pytest.mark.asyncio
async def test_fixed_invites_respect_geo_scope():
    """海外运营只配发海外固定链接；销售配发海外+国内两条。"""

    async def run(user):
        db = AsyncMock()
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=ctx)
        ctx.__aexit__ = AsyncMock(return_value=False)
        db.begin_nested = MagicMock(return_value=ctx)
        svc = InviteService(db)
        fixed = {}
        created = []

        async def fake_get_fixed(staff_id, variant):
            return fixed.get(variant)

        async def fake_get_by_token(token):
            return None

        async def fake_create_fixed(staff_id, token, *, geo_variant="overseas"):
            row = SimpleNamespace(
                id=f"inv-{geo_variant}",
                token=token,
                staff_user_id=staff_id,
                label=None,
                geo_variant=geo_variant,
                revoked_at=None,
                visit_count=0,
                created_at="2026-08-07 00:00:00",
                is_fixed=True,
            )
            fixed[geo_variant] = row
            created.append(geo_variant)
            return row

        svc.repo.get_fixed = fake_get_fixed
        svc.repo.get_by_token = fake_get_by_token
        svc.repo.create_fixed = fake_create_fixed
        out = await svc.ensure_fixed_invites(user)
        return out, created

    overseas_out, overseas_created = await run(_overseas_user())
    assert overseas_created == ["overseas"]
    assert [i.geo_variant for i in overseas_out] == ["overseas"]
    assert overseas_out[0].token == f"staff-{_overseas_user().id}-overseas"

    sales_out, sales_created = await run(_sales_user())
    assert sorted(sales_created) == ["domestic", "overseas"]
    assert {i.geo_variant for i in sales_out} == {"overseas", "domestic"}


@pytest.mark.asyncio
async def test_projects_batch_resolve_prefers_request_over_stamps(monkeypatch):
    import app.modules.requests.repository as req_repo_mod
    from app.modules.projects.service import ProjectsService

    db = AsyncMock()
    svc = ProjectsService(db)

    class _Contract:
        def __init__(self, cid: str, oid: str, geo: str):
            self.id = cid
            self.opportunity_id = oid or None
            self.document = {"id": cid, "opportunityId": oid, "geoSource": geo}

    class _Opp:
        def __init__(self, oid: str, rid: str, geo: str):
            self.id = oid
            self.document = {"id": oid, "requestIds": [rid], "geoSource": geo}

    class _Req:
        def __init__(self, rid: str, code: str, source: str):
            self.id = rid
            self.code = code
            self.data = {"importMeta": {"source": source}}

    row_cn = SimpleNamespace(
        id="p-cn",
        geo_source="overseas",  # 脏列 stamp 不得覆盖需求溯源
        source_contract_id="ct-cn",
        opportunity_id="opp-cn",
    )
    row_ov = SimpleNamespace(
        id="p-ov",
        geo_source=None,
        source_contract_id="ct-ov",
        opportunity_id="opp-ov",
    )
    row_stamped = SimpleNamespace(
        id="p-stamped",
        geo_source="overseas",
        source_contract_id="ct-x",
        opportunity_id=None,
    )

    svc.crm.list_contracts_by_ids = AsyncMock(
        return_value=[
            _Contract("ct-cn", "opp-cn", "overseas"),
            _Contract("ct-ov", "opp-ov", "domestic"),
            _Contract("ct-x", "", "manual"),
        ]
    )
    svc.crm.list_opportunities_by_ids = AsyncMock(
        return_value=[
            _Opp("opp-cn", "req-cn", "overseas"),
            _Opp("opp-ov", "req-ov", "domestic"),
        ]
    )
    svc.crm.list_opportunity_children = AsyncMock(
        return_value={
            "opp-cn": {"requestIds": ["req-cn"]},
            "opp-ov": {"requestIds": ["req-ov"]},
        }
    )

    async def no_rows(_self, ids):
        return [_Req("req-cn", "GEO-CN-1", "国内GEO需求"), _Req("req-ov", "GEO-OV-1", "海外GEO需求")]

    async def children_map(_self, ids):
        return {
            "req-cn": {"importMeta": {"source": "国内GEO需求"}},
            "req-ov": {"importMeta": {"source": "海外GEO需求"}},
        }

    monkeypatch.setattr(req_repo_mod.RequestRepository, "list_by_ids", no_rows)
    monkeypatch.setattr(req_repo_mod.RequestRepository, "list_request_children", children_map)

    class _ReqRepo:
        def __init__(self, _db):
            pass

        async def list_by_ids(self, ids):
            return [
                _Req("req-cn", "GEO-CN-1", "国内GEO需求"),
                _Req("req-ov", "GEO-OV-1", "海外GEO需求"),
            ]

        async def list_request_children(self, ids):
            return {
                "req-cn": {"importMeta": {"source": "国内GEO需求"}},
                "req-ov": {"importMeta": {"source": "海外GEO需求"}},
            }

    monkeypatch.setattr(req_repo_mod, "RequestRepository", _ReqRepo)
    geos = await svc._resolve_rows_geo([row_cn, row_ov, row_stamped])  # type: ignore[arg-type]

    assert geos["p-cn"] == "domestic"
    assert geos["p-ov"] == "overseas"
    assert geos["p-stamped"] == "overseas"
