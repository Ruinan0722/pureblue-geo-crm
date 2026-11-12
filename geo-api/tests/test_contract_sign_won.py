"""合同完成签署：须有合同附件，并自动推进关联商机至已签订。"""

from __future__ import annotations

import pytest

from app.core.exceptions import ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import (
    MSG_CONTRACT_SIGN_NEEDS_FILE,
    MSG_CONTRACT_TERMINAL_READONLY,
    CrmService,
    _has_contract_file_attachment,
)


def test_has_contract_file_attachment():
    assert not _has_contract_file_attachment(None)
    assert not _has_contract_file_attachment([])
    assert not _has_contract_file_attachment([{"kind": "sow", "id": "a1", "name": "sow.pdf"}])
    assert _has_contract_file_attachment([{"kind": "contract", "id": "c1", "name": "ht.pdf"}])
    assert _has_contract_file_attachment([{"id": "c2", "name": "ht.pdf"}])  # 缺省 kind=contract
    assert _has_contract_file_attachment(
        [
            {"kind": "sow", "id": "a1", "name": "sow.pdf"},
            {"kind": "contract", "id": "c1", "name": "ht.pdf"},
        ]
    )


def _user() -> AuthUser:
    return AuthUser(
        id="owner-1",
        feishu_open_id="ou_owner-1",
        name="销售",
        role="sales",
        permissions=[
            "section:contracts",
            "contracts:write",
            "section:opportunities",
            "opportunities:write",
        ],
        data_scope="own",
    )


class _ContractRow:
    def __init__(self, *, document: dict, owner_user_id: str = "owner-1"):
        self.id = document["id"]
        self.owner_user_id = owner_user_id
        self.document = document


class _OppRow:
    def __init__(self, *, stage: str, document: dict, owner_user_id: str = "owner-1"):
        self.id = document["id"]
        self.owner_user_id = owner_user_id
        self.stage = stage
        self.document = document


class _Repo:
    def __init__(self, contract: _ContractRow, opp: _OppRow | None):
        self.contract = contract
        self.opp = opp
        self.saved_opps: list[dict] = []

    async def get_contract(self, contract_id: str):
        return self.contract if self.contract.id == contract_id else None

    async def save_contract(self, row, document):
        row.document = dict(document)
        self.contract = row
        return row

    async def list_contract_owners(self, _ids):
        return {self.contract.id: []}

    async def list_contract_attachments(self, _ids):
        atts = list((self.contract.document or {}).get("attachments") or [])
        return {self.contract.id: atts}

    async def get_contract_attachments(self, _cid):
        return list((self.contract.document or {}).get("attachments") or [])

    async def get_opportunity(self, opportunity_id: str):
        if self.opp and self.opp.id == opportunity_id:
            return self.opp
        return None

    async def get_opportunity_children(self, _oid):
        d = self.opp.document if self.opp and isinstance(self.opp.document, dict) else {}
        return {
            "stageHistory": list(d.get("stageHistory") or []),
            "attachments": list(d.get("attachments") or []),
            "projectTypes": list(d.get("projectTypes") or []),
            "requestIds": list(d.get("requestIds") or []),
            "notes": list(d.get("notes") or []),
            "advisorNotes": list(d.get("advisorNotes") or []),
        }

    async def save_opportunity(self, row, document):
        row.document = dict(document)
        row.stage = str(document.get("stage") or row.stage)
        self.saved_opps.append(dict(document))
        self.opp = row
        return row


class _Db:
    async def commit(self):
        return None


@pytest.mark.asyncio
async def test_update_contract_signed_requires_contract_file(monkeypatch):
    contract = _ContractRow(
        document={
            "id": "ct-1",
            "code": "HT-1",
            "name": "测试合同",
            "status": "pending",
            "attachments": [{"kind": "sow", "id": "s1", "name": "sow.pdf"}],
            "opportunityId": "opp-1",
        }
    )
    svc = CrmService(_Db())  # type: ignore[arg-type]
    svc.repo = _Repo(contract, None)  # type: ignore[assignment]

    async def _no_project(*_a, **_k):
        return None

    monkeypatch.setattr(
        "app.modules.projects.service.should_ensure_project",
        lambda *_a, **_k: False,
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", _no_project)
    monkeypatch.setattr(svc, "_assert_row_access", _no_project)

    with pytest.raises(ValidationError, match=MSG_CONTRACT_SIGN_NEEDS_FILE):
        await svc.update_contract(
            _user(),
            "ct-1",
            {**contract.document, "status": "signed"},
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal_status", ["void", "terminated"])
async def test_update_terminal_contract_rejects_field_edit(monkeypatch, terminal_status):
    """作废/终止的合同不可再编辑合同字段（附件上传除外）。"""
    contract = _ContractRow(
        document={
            "id": "ct-1",
            "code": "HT-1",
            "name": "测试合同",
            "status": terminal_status,
            "attachments": [],
            "opportunityId": "opp-1",
        }
    )
    svc = CrmService(_Db())  # type: ignore[arg-type]
    svc.repo = _Repo(contract, None)  # type: ignore[assignment]

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(
        "app.modules.projects.service.should_ensure_project",
        lambda *_a, **_k: False,
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", _noop)
    monkeypatch.setattr(svc, "_assert_row_access", _noop)

    with pytest.raises(ValidationError, match=MSG_CONTRACT_TERMINAL_READONLY):
        await svc.update_contract(_user(), "ct-1", {**contract.document, "name": "改名"})


@pytest.mark.asyncio
async def test_update_terminal_contract_allows_attachment_only(monkeypatch):
    """作废/终止的合同仍允许补充附件。"""
    contract = _ContractRow(
        document={
            "id": "ct-1",
            "code": "HT-1",
            "name": "测试合同",
            "status": "void",
            "attachments": [],
            "opportunityId": "opp-1",
        }
    )
    svc = CrmService(_Db())  # type: ignore[arg-type]
    svc.repo = _Repo(contract, None)  # type: ignore[assignment]

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(
        "app.modules.projects.service.should_ensure_project",
        lambda *_a, **_k: False,
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", _noop)
    monkeypatch.setattr(svc, "_assert_row_access", _noop)

    result = await svc.update_contract(
        _user(),
        "ct-1",
        {"attachments": [{"id": "a1", "name": "closure.pdf", "kind": "contract"}]},
    )
    assert result.get("status") == "void"


@pytest.mark.asyncio
async def test_update_contract_signed_advances_opportunity_to_won(monkeypatch):
    contract = _ContractRow(
        document={
            "id": "ct-1",
            "code": "HT-1",
            "name": "测试合同",
            "status": "pending",
            "attachments": [{"kind": "contract", "id": "c1", "name": "ht.pdf"}],
            "opportunityId": "opp-1",
        }
    )
    opp = _OppRow(
        stage="signing",
        document={
            "id": "opp-1",
            "name": "测试商机",
            "stage": "signing",
            "stageHistory": [{"stage": "signing", "enteredAt": "2026-07-01 10:00:00"}],
            "requestIds": [],
        },
    )
    repo = _Repo(contract, opp)
    svc = CrmService(_Db())  # type: ignore[arg-type]
    svc.repo = repo  # type: ignore[assignment]

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(
        "app.modules.projects.service.should_ensure_project",
        lambda *_a, **_k: False,
    )
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", _noop)
    monkeypatch.setattr(svc, "_assert_row_access", _noop)

    result = await svc.update_contract(
        _user(),
        "ct-1",
        {**contract.document, "status": "signed"},
    )
    assert result["status"] == "signed"
    updated = result.get("_updatedOpportunity")
    assert updated is not None
    assert updated["stage"] == "won"
    assert repo.opp is not None
    assert repo.opp.stage == "won"
    assert any(h.get("stage") == "won" for h in (updated.get("stageHistory") or []))
