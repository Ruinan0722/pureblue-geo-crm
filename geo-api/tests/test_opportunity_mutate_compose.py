"""商机 mutate 响应必须 compose 子表；缺键不得抹掉子表集合。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository import CrmRepository
from app.modules.crm.service import CrmService


def _user() -> AuthUser:
    return AuthUser(
        id="owner-1",
        feishu_open_id="ou_owner-1",
        name="销售",
        role="sales",
        permissions=["section:opportunities", "opportunities:write", "opportunities:stage"],
        data_scope="own",
    )


class _OppRow:
    def __init__(self):
        self.id = "opp-1"
        self.owner_user_id = "owner-1"
        self.customer_id = "c-1"
        self.stage = "contact"
        self.amount = None
        self.expected_sign_date = None
        self.last_follow_at = None
        self.next_follow_at = None
        self.lost_reason = None
        self.name = "测试商机"
        self.brand_name = None
        self.region = None
        self.geo_source = None
        self.goal = None
        self.platform = None
        self.period = None
        self.probability = None
        self.owner = "销售"
        self.advisor = None
        self.customer_success = None
        self.subsidiary_id = None
        self.subsidiary_name = None
        self.primary_contact_id = None
        self.lost_stage = None
        self.lost_reason_l1 = None
        self.lost_reason_l2 = None
        self.competitor = None
        self.created_day = None
        self.document = {
            "id": "opp-1",
            "customerId": "c-1",
            "stage": "contact",
            "name": "测试商机",
            "owner": "销售",
        }


class _OppRepo:
    def __init__(self, row: _OppRow, children: dict):
        self.row = row
        self.children = children
        self.saved_docs: list[dict] = []

    async def get_opportunity(self, _oid):
        return self.row

    async def get_opportunity_children(self, _oid):
        return dict(self.children)

    async def save_opportunity(self, row, doc):
        self.saved_docs.append(doc)
        row.stage = str(doc.get("stage") or row.stage)
        row.document = {**(row.document or {}), **doc}
        # 模拟写穿：若 payload 带 notes 则更新 children 缓存
        if "notes" in doc:
            self.children["notes"] = list(doc.get("notes") or [])
        if "advisorNotes" in doc:
            self.children["advisorNotes"] = list(doc.get("advisorNotes") or [])
        if "attachments" in doc:
            self.children["attachments"] = list(doc.get("attachments") or [])
        self.row = row
        return row


@pytest.mark.asyncio
async def test_update_opportunity_response_includes_synced_notes(monkeypatch):
    notes = [{"id": "n1", "author": "销售", "content": "已沟通", "date": "2026-08-08"}]
    row = _OppRow()
    repo = _OppRepo(
        row,
        {
            "stageHistory": [],
            "attachments": [],
            "projectTypes": [],
            "requestIds": [],
            "notes": notes,
            "advisorNotes": [{"id": "a1", "author": "顾问", "content": "评估中", "date": "2026-08-07"}],
        },
    )
    svc = CrmService(object())  # type: ignore[arg-type]
    svc.repo = repo  # type: ignore[assignment]

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", noop)
    monkeypatch.setattr(svc, "_stamp_opportunity_geo", AsyncMock(side_effect=lambda doc, _u: doc))
    monkeypatch.setattr(svc, "_resolve_opportunity_geo", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_assert_geo_access", lambda *_a, **_k: None)

    result = await svc.update_opportunity(
        _user(),
        "opp-1",
        {
            "id": "opp-1",
            "customerId": "c-1",
            "stage": "contact",
            "name": "测试商机",
            "notes": notes + [{"id": "n2", "author": "销售", "content": "二次跟进", "date": "2026-08-08"}],
            "advisorNotes": repo.children["advisorNotes"],
            "attachments": [],
            "projectTypes": [],
            "requestIds": [],
            "stageHistory": [],
        },
    )

    assert len(result.get("notes") or []) == 2
    assert result["notes"][-1]["content"] == "二次跟进"
    assert len(result.get("advisorNotes") or []) == 1


@pytest.mark.asyncio
async def test_update_opportunity_without_notes_key_keeps_prev_notes_in_save(monkeypatch):
    notes = [{"id": "n1", "author": "销售", "content": "保留我", "date": "2026-08-08"}]
    row = _OppRow()
    repo = _OppRepo(
        row,
        {
            "stageHistory": [],
            "attachments": [{"id": "f1", "name": "a.pdf", "size": 1}],
            "projectTypes": ["GEO"],
            "requestIds": [],
            "notes": notes,
            "advisorNotes": [],
        },
    )
    svc = CrmService(object())  # type: ignore[arg-type]
    svc.repo = repo  # type: ignore[assignment]

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", noop)
    monkeypatch.setattr(svc, "_stamp_opportunity_geo", AsyncMock(side_effect=lambda doc, _u: doc))
    monkeypatch.setattr(svc, "_resolve_opportunity_geo", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_assert_geo_access", lambda *_a, **_k: None)

    # 前端只改名称，不带 notes（或带了空以外的漏传场景：这里测服务用 prev children 合并）
    result = await svc.update_opportunity(
        _user(),
        "opp-1",
        {"id": "opp-1", "customerId": "c-1", "stage": "contact", "name": "改名"},
    )

    assert repo.saved_docs, "应调用 save_opportunity"
    saved = repo.saved_docs[0]
    assert saved.get("notes") == notes
    assert saved.get("attachments") == [{"id": "f1", "name": "a.pdf", "size": 1}]
    assert result.get("notes") == notes


@pytest.mark.asyncio
async def test_save_opportunity_always_full_syncs_children(monkeypatch):
    """无兜底：save 始终全量 sync；调用方须传入 compose+merge 后的完整集合。"""
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="o1",
        customer_id="c1",
        stage="contact",
        amount=None,
        expected_sign_date=None,
        last_follow_at=None,
        next_follow_at=None,
        lost_reason=None,
        name="x",
        brand_name=None,
        region=None,
        geo_source=None,
        goal=None,
        platform=None,
        period=None,
        probability=None,
        owner=None,
        advisor=None,
        customer_success=None,
        subsidiary_id=None,
        subsidiary_name=None,
        primary_contact_id=None,
        lost_stage=None,
        lost_reason_l1=None,
        lost_reason_l2=None,
        competitor=None,
        created_day=None,
        updated_at=None,
    )

    sync_notes = AsyncMock()
    sync_att = AsyncMock()
    sync_hist = AsyncMock()
    sync_links = AsyncMock()
    import app.modules.crm.repository.opportunities as opp_mod

    monkeypatch.setattr(opp_mod, "sync_opportunity_notes", sync_notes)
    monkeypatch.setattr(opp_mod, "sync_attachments", sync_att)
    monkeypatch.setattr(opp_mod, "sync_stage_history", sync_hist)
    monkeypatch.setattr(opp_mod, "sync_opportunity_links", sync_links)

    notes = [{"id": "keep", "content": "n"}]
    await repo.save_opportunity(
        row,
        {
            "customerId": "c1",
            "stage": "contact",
            "name": "only-name",
            "notes": notes,
            "advisorNotes": [],
            "attachments": [],
            "stageHistory": [],
            "projectTypes": [],
            "requestIds": [],
        },
    )
    sync_notes.assert_awaited_once()
    assert sync_notes.await_args.args[2] == notes
    sync_att.assert_awaited_once()
    sync_hist.assert_awaited_once()
    sync_links.assert_awaited_once()


@pytest.mark.asyncio
async def test_sync_opportunity_children_requires_collection_keys():
    from app.core.exceptions import ValidationError

    db = AsyncMock()
    repo = CrmRepository(db)
    with pytest.raises(ValidationError, match="notes"):
        await repo._sync_opportunity_children("o1", {"stage": "contact"})
