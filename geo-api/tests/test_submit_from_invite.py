"""客户邀请链接提交：链接一对多（每笔归属销售），短时相同内容防连点。

回归保护：曾经 `submit_from_invite` 调用已删除的 `find_submitted_by_invite_id`
导致公网提交必然 500；且旧语义「同一邀请仅一笔 submitted」已被产品决策推翻
（一个销售的一个链接可服务多个客户，每笔各自入库）。
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ValidationError
from app.modules.requests.schemas import IntakeSubmitBody
from app.modules.requests.service import RequestService

LEGACY_TOKEN = "a" * 32
FIXED_OVERSEAS_TOKEN = "staff-2da85480-ad7a-4761-9894-abde80d68a85-overseas"
FIXED_DOMESTIC_TOKEN = "staff-2da85480-ad7a-4761-9894-abde80d68a85-domestic"


class _Staff:
    name = "销售甲"
    employment_status = "active"


class _Invite:
    id = "invite-1"
    token = LEGACY_TOKEN
    staff_user_id = "staff-1"
    geo_variant = "overseas"
    revoked_at = None


class _Record:
    """insert 返回的最小 RequestRecord 替代（测试只需 code/reused）。"""

    code = "GEO-20260804-1234"
    reused = False


def _overseas_ok(**overrides):
    base = {
        "companyName": "Acme",
        "contactName": "Tom",
        "contactTitle": "PM",
        "contactPhone": "+1 415-555-0100",
        "brandName": "Acme",
        "scopeType": "brand_only",
        "hasOverseasSite": "no",
        "targetCustomer": "toc",
        "regions": [{"country": "US", "language": "en"}],
        "platforms": ["ChatGPT"],
        "intentType": "clear",
        "intentQuestions": [{"text": "best crm"}],
        "goal": "recommend",
        "importMeta": {"source": "海外GEO需求"},
    }
    base.update(overrides)
    return base


def _make_service(monkeypatch, *, insert_record: _Record | None = None):
    """无 DB 单测：repo / invite_repo / UsersRepository 全部替换为 AsyncMock。"""
    service = RequestService.__new__(RequestService)
    service.db = AsyncMock()
    service.repo = AsyncMock()
    service.repo.insert = AsyncMock(return_value=insert_record or _Record())
    service.invite_repo = AsyncMock()
    service.invite_repo.get_by_token_for_update = AsyncMock(return_value=_Invite())

    staff_mock = AsyncMock()
    staff_mock.get_by_id = AsyncMock(return_value=_Staff())
    monkeypatch.setattr("app.modules.requests.service.UsersRepository", lambda db: staff_mock)
    return service


def _submit(service, data=None, *, token: str = LEGACY_TOKEN) -> AsyncMock:
    body = IntakeSubmitBody(data=data if data is not None else _overseas_ok(), invite_token=token)
    return service.submit_from_invite(body)


async def test_submit_ok_returns_code(monkeypatch):
    """正常提交：走验真 → 校验 → 入库，返回编号且 reused=false。"""
    service = _make_service(monkeypatch)
    res = await _submit(service)

    service.repo.insert.assert_awaited_once()
    assert res.code == "GEO-20260804-1234"
    assert res.reused is False


@pytest.mark.parametrize("token", [FIXED_OVERSEAS_TOKEN, FIXED_DOMESTIC_TOKEN])
async def test_fixed_invite_token_passes_format_gate(monkeypatch, token):
    """国内/海外固定 token 必须进入数据库验真，不得被旧 32 位 hex 规则拒绝。"""
    service = _make_service(monkeypatch)

    invite, staff_name = await service._require_authentic_invite_for_submit(token)

    service.invite_repo.get_by_token_for_update.assert_awaited_once_with(token)
    assert invite is not None
    assert staff_name == "销售甲"


@pytest.mark.parametrize(
    "token",
    [
        "staff-2da85480-ad7a-4761-9894-abde80d68a85",
        "staff-2da85480-ad7a-4761-9894-abde80d68a85-global",
        "staff-../../etc/passwd-overseas",
        "not-an-invite",
    ],
)
async def test_rejects_malformed_invite_before_database_lookup(monkeypatch, token):
    service = _make_service(monkeypatch)

    with pytest.raises(ValidationError, match="邀请链接无效"):
        await service._require_authentic_invite_for_submit(token)

    service.invite_repo.get_by_token_for_update.assert_not_awaited()


async def test_same_link_multiple_customers_each_inserts(monkeypatch):
    """链接一对多：同一链接两次不同内容提交，每次都走入库（不得短路跳过）。"""
    service = _make_service(monkeypatch)
    await _submit(service, _overseas_ok(contactName="Tom"))
    await _submit(service, _overseas_ok(contactName="Jerry"))

    assert service.repo.insert.await_count == 2


async def test_duplicate_submit_reuses_from_insert(monkeypatch):
    """短时相同内容防连点：insert 内部 find_recent_duplicate 命中时透传 reused=true。"""
    dup = _Record()
    dup.reused = True
    service = _make_service(monkeypatch, insert_record=dup)
    res = await _submit(service)

    assert res.reused is True
    assert res.code == dup.code


async def test_rejects_empty_data(monkeypatch):
    service = _make_service(monkeypatch)
    with pytest.raises(ValidationError):
        await _submit(service, {})


async def test_rejects_unknown_invite(monkeypatch):
    service = _make_service(monkeypatch)
    service.invite_repo.get_by_token_for_update = AsyncMock(return_value=None)
    with pytest.raises(ValidationError):
        await _submit(service)


async def test_rejects_revoked_invite(monkeypatch):
    revoked = _Invite()
    revoked.revoked_at = "2026-08-01T00:00:00"
    service = _make_service(monkeypatch)
    service.invite_repo.get_by_token_for_update = AsyncMock(return_value=revoked)
    with pytest.raises(ValidationError):
        await _submit(service)
