"""审计变更值：requestIds / opportunityId 原始 ID 统一转为可读标识（需求编号 / 商机名称）。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.modules.crm.service import CrmService


def _svc_with_lookups(monkeypatch, *, names: dict[str, str], codes: dict[str, str]):
    svc = CrmService(object())  # type: ignore[arg-type]
    svc.repo = SimpleNamespace(
        list_opportunities_by_ids=lambda ids: None,
    )

    async def fake_list_opportunities_by_ids(ids):
        return [SimpleNamespace(id=oid, name=names[oid]) for oid in ids if oid in names]

    svc.repo.list_opportunities_by_ids = fake_list_opportunities_by_ids

    async def fake_list_by_ids(_self, ids):
        return [SimpleNamespace(id=rid, code=codes[rid]) for rid in ids if rid in codes]

    monkeypatch.setattr(
        "app.modules.requests.repository.RequestRepository.list_by_ids",
        fake_list_by_ids,
    )
    return svc


@pytest.mark.asyncio
async def test_audit_id_labels_resolve_request_and_opportunity(monkeypatch):
    names = {"opp-1": "销售新增客户测试-总部-排名优化-202608", "opp-2": "测试商机B"}
    codes = {"req-1": "GEO-OV-20260811-5191", "req-2": "GEO-CN-20260811-4879"}

    svc = _svc_with_lookups(monkeypatch, names=names, codes=codes)

    out = await svc._resolve_audit_change_id_labels(
        [
            {"field": "requestIds", "label": "requestIds", "before": "req-1、req-2", "after": "—"},
            {"field": "opportunityId", "label": "关联商机", "before": "—", "after": "opp-1"},
            {"field": "amount", "label": "金额", "before": "1", "after": "2"},
        ]
    )

    assert out[0]["before"] == "GEO-OV-20260811-5191、GEO-CN-20260811-4879"
    assert out[0]["after"] == "—"
    assert out[1]["after"] == "销售新增客户测试-总部-排名优化-202608"
    assert out[2] == {"field": "amount", "label": "金额", "before": "1", "after": "2"}


@pytest.mark.asyncio
async def test_audit_id_labels_keep_unknown_ids(monkeypatch):
    svc = _svc_with_lookups(monkeypatch, names={}, codes={})
    out = await svc._resolve_audit_change_id_labels(
        [
            {"field": "requestIds", "label": "requestIds", "before": "req-missing", "after": "—"},
            {"field": "opportunityId", "label": "关联商机", "before": "—", "after": "opp-missing"},
        ]
    )
    assert out[0]["before"] == "req-missing"
    assert out[1]["after"] == "opp-missing"
