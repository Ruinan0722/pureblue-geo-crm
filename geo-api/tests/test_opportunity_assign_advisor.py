"""商机分配售前顾问（opportunities:assign_advisor）服务端契约。

演示成员13（解决方案部）通过用户级权限覆盖持有该权限，可将商机分配给具体的
解决方案部成员；仅允许更新 advisor 字段，且目标必须是解决方案部在职成员。
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user(permissions: list[str], role: str = "presales", scope: str = "all") -> AuthUser:
    return AuthUser(
        id="u-presales-lead",
        feishu_open_id="ou_li_chenjia",
        name="演示成员13",
        role=role,
        permissions=permissions,
        data_scope=scope,
    )


class _OppRow:
    def __init__(self, *, stage: str, document: dict):
        self.id = "opp-1"
        self.owner_user_id = "owner-1"
        self.stage = stage
        self.document = document


class _OppRepo:
    def __init__(self, row: _OppRow):
        self.row = row

    async def get_opportunity(self, _oid):
        return self.row

    async def get_opportunity_children(self, _oid):
        d = self.row.document if isinstance(self.row.document, dict) else {}
        return {
            "stageHistory": list(d.get("stageHistory") or []),
            "attachments": list(d.get("attachments") or []),
            "projectTypes": list(d.get("projectTypes") or []),
            "requestIds": list(d.get("requestIds") or []),
            "notes": list(d.get("notes") or []),
            "advisorNotes": list(d.get("advisorNotes") or []),
        }

    async def save_opportunity(self, row, doc):
        row.document = doc
        row.stage = str(doc.get("stage") or row.stage)
        self.row = row
        return row


def _svc(row: _OppRow, monkeypatch) -> CrmService:
    svc = CrmService(object())  # type: ignore[arg-type]
    svc.repo = _OppRepo(row)  # type: ignore[assignment]

    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", noop)
    return svc


def _base_document() -> dict:
    return {
        "id": "opp-1",
        "customerId": "c1",
        "name": "测试-总部-方案-202608",
        "stage": "signing",
        "advisor": "演示成员13",
        "requestIds": [],
        "stageHistory": [],
        "projectTypes": [],
        "notes": [],
        "advisorNotes": [],
        "attachments": [],
    }


@pytest.mark.asyncio
async def test_assign_advisor_updates_only_advisor_field(monkeypatch):
    """演示成员13（assign_advisor）分配商机时只改售前顾问，阶段等其它字段不受影响。"""
    from app.modules.users.service import UsersService

    row = _OppRow(stage="signing", document=_base_document())
    svc = _svc(row, monkeypatch)
    monkeypatch.setattr(
        UsersService,
        "list_directory",
        AsyncMock(
            return_value=SimpleNamespace(members=[SimpleNamespace(name="王璐")])
        ),
    )

    await svc.update_opportunity(
        _user(permissions=[
            "section:opportunities",
            "opportunities:advisor",
            "opportunities:assign_advisor",
        ]),
        "opp-1",
        {"advisor": "王璐", "stage": "lost"},
    )

    saved = row.document
    assert saved["advisor"] == "王璐"
    assert saved["stage"] == "signing"
    assert saved["name"] == "测试-总部-方案-202608"


@pytest.mark.asyncio
async def test_assign_advisor_rejects_non_solution_member(monkeypatch):
    """目标不在解决方案部成员名单时，服务端必须拒绝。"""
    from app.modules.users.service import UsersService

    row = _OppRow(stage="signing", document=_base_document())
    svc = _svc(row, monkeypatch)
    monkeypatch.setattr(
        UsersService,
        "list_directory",
        AsyncMock(return_value=SimpleNamespace(members=[SimpleNamespace(name="王璐")])),
    )

    with pytest.raises(PermissionDeniedError):
        await svc.update_opportunity(
            _user(permissions=[
                "section:opportunities",
                "opportunities:assign_advisor",
            ]),
            "opp-1",
            {"advisor": "不存在的人"},
        )


@pytest.mark.asyncio
async def test_assign_advisor_without_permission_keeps_advisor(monkeypatch):
    """仅有顾问反馈权限（无 assign_advisor）时，提交 advisor 不应变更。"""
    row = _OppRow(stage="signing", document=_base_document())
    svc = _svc(row, monkeypatch)

    await svc.update_opportunity(
        _user(permissions=["section:opportunities", "opportunities:advisor"]),
        "opp-1",
        {"advisor": "王璐"},
    )

    assert row.document["advisor"] == "演示成员13"


@pytest.mark.asyncio
async def test_assign_advisor_requires_section_permission(monkeypatch):
    """有分配权限但无商机模块权限时拒绝。"""
    row = _OppRow(stage="signing", document=_base_document())
    svc = _svc(row, monkeypatch)

    with pytest.raises(PermissionDeniedError):
        await svc.update_opportunity(
            _user(permissions=["opportunities:assign_advisor"]),
            "opp-1",
            {"advisor": "王璐"},
        )
