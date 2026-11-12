"""批量改负责人：save_customer 的 document 必须含 compose 后的 subsidiaries。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user() -> AuthUser:
    return AuthUser(
        id="u-admin",
        feishu_open_id="ou-admin",
        name="管理员",
        role="admin",
        permissions=["section:customers", "customers:write"],
        data_scope="all",
    )


@pytest.mark.asyncio
async def test_batch_assign_save_includes_subsidiaries(monkeypatch):
    row = SimpleNamespace(
        id="c-1",
        owner_user_id="u-old",
        company_name="Acme",
        status="connected",
        document={"id": "c-1", "companyName": "Acme", "owner": "旧销售"},
    )
    saved_docs: list[dict] = []
    subsidiaries = [
        {"id": "SUB-1", "name": "子A", "shortName": None, "creditCode": None, "city": None}
    ]

    class Repo:
        async def get_customer(self, cid):
            return row if cid == "c-1" else None

        async def list_customer_subsidiaries(self, cid):
            assert cid == "c-1"
            return list(subsidiaries)

        async def save_customer(self, r, document, owner_user_id=None):
            saved_docs.append(dict(document))
            r.owner_user_id = owner_user_id
            r.document = document
            return r

    svc = CrmService(AsyncMock())
    svc.repo = Repo()  # type: ignore[assignment]

    async def noop(*_a, **_k):
        return None

    async def resolve(_user, _name):
        return "u-new"

    monkeypatch.setattr(svc, "_assert_customer_access", noop)
    monkeypatch.setattr(svc, "_assert_assignable_owner", noop)
    monkeypatch.setattr(svc, "_resolve_owner_user_id", resolve)
    monkeypatch.setattr(svc, "_write_customer_owner_audit", noop)
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", noop)

    result = await svc.batch_assign_customer_owner(
        _user(),
        customer_ids=["c-1"],
        owner="新销售",
    )
    assert saved_docs, "应调用 save_customer"
    assert saved_docs[0].get("subsidiaries") == subsidiaries
    assert result["succeeded"]
