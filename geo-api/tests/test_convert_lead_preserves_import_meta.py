"""转客户：save_lead / 响应必须含 importMeta 与 notes/attachments。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.auth.schemas import AuthUser
from app.modules.crm.service import CrmService


def _user() -> AuthUser:
    return AuthUser(
        id="u1",
        feishu_open_id="ou-u1",
        name="销售",
        role="sales",
        permissions=["section:leads", "leads:convert", "section:customers"],
        data_scope="own",
    )


@pytest.mark.asyncio
async def test_convert_lead_preserves_import_meta_and_returns_composed(monkeypatch):
    notes = [{"id": "n1", "content": "follow", "author": "a", "date": "2026-08-01"}]
    attachments = [{"id": "a1", "name": "x.pdf", "size": 1}]
    import_meta = {"platform": "mark", "externalRecordId": "M-1"}
    saved: list[dict] = []

    row = SimpleNamespace(
        id="l-1",
        owner_user_id="u1",
        status="following",
        company_name="示例公司",
        document={
            "id": "l-1",
            "companyName": "示例公司",
            "brandName": "品牌",
            "contactName": "张三",
            "contactPhone": "13800138000",
            "sales": "销售",
            "sdr": "SDR",
            "source": "官网注册",
            "region": "国内",
        },
        contact_title=None,
        contact_department=None,
        contact_phone="13800138000",
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
        created_at=None,
        source=None,
        source_detail=None,
        level=None,
        region="国内",
        first_contact_date=None,
        contact_name="张三",
        follow_state="need",
        brand_name="品牌",
        sdr="SDR",
        sales="销售",
        transfer_date=None,
    )

    children = {
        "notes": list(notes),
        "attachments": list(attachments),
        "importMeta": dict(import_meta),
    }

    class FakeRepo:
        async def get_lead(self, lid):
            return row if lid == "l-1" else None

        async def get_lead_children(self, lid):
            return dict(children)

        async def save_lead(self, lead_row, doc):
            saved.append(dict(doc))
            lead_row.document = doc
            lead_row.status = str(doc.get("status") or lead_row.status)
            lead_row.converted_customer_id = doc.get("convertedCustomerId")
            lead_row.converted_coverage_id = doc.get("convertedCoverageId")
            return lead_row

        async def get_customer(self, *_a, **_k):
            return None

        async def create_customer(self, *, document, owner_user_id):
            return SimpleNamespace(
                id=document["id"],
                owner_user_id=owner_user_id,
                document=document,
                company_name=document.get("companyName"),
            )

        async def list_customer_subsidiaries(self, *_a, **_k):
            return []

        async def append_related_entity_to_audits(self, **_k):
            return None

        async def save_customer(self, crow, doc):
            crow.document = doc
            return crow

    svc = CrmService.__new__(CrmService)
    svc.db = AsyncMock()
    svc.repo = FakeRepo()  # type: ignore[assignment]

    async def assert_access(*_a, **_k):
        return None

    async def resolve_owner(user, _name):
        return user.id

    async def assert_assignable(*_a, **_k):
        return None

    async def raise_conflict(*_a, **_k):
        return None

    coverage = SimpleNamespace(id="cov-1", owner_user_id="u1", document={})

    async def get_or_create_coverage(**_k):
        carried = _k["seed"]["attachments"]
        assert len(carried) == 1
        assert carried[0]["id"] != "a1"
        assert carried[0]["sourceLeadAttachmentId"] == "a1"
        return coverage, True

    async def compose_view(user, customer_row, coverages):
        return {"id": customer_row.id, "companyName": "示例公司", "coverages": []}

    async def commit_invalidate(*_a, **_k):
        return None

    monkeypatch.setattr(svc, "_assert_section", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_assert_lead_write", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_assert_row_access", assert_access)
    monkeypatch.setattr(svc, "_resolve_owner_user_id", resolve_owner)
    monkeypatch.setattr(svc, "_assert_assignable_owner", assert_assignable)
    monkeypatch.setattr(svc, "_raise_if_company_conflict", raise_conflict)
    monkeypatch.setattr(svc, "_get_or_create_coverage", get_or_create_coverage)
    monkeypatch.setattr(svc, "_compose_customer_view_async", compose_view)
    monkeypatch.setattr(svc, "_commit_and_invalidate_crm", commit_invalidate)
    monkeypatch.setattr(svc, "_is_sdr_role", lambda *_a, **_k: False)

    out = await svc.convert_lead(_user(), "l-1", mode="create")
    assert saved, "应 save_lead"
    assert saved[0].get("importMeta") == import_meta
    assert saved[0].get("notes") == notes
    assert saved[0].get("attachments") == attachments
    assert out["lead"].get("importMeta") == import_meta
    assert out["lead"].get("notes") == notes
    assert out["lead"].get("attachments") == attachments
    assert out["lead"].get("status") == "converted"
