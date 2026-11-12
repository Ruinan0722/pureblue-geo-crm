"""对接池 save：未传 importMeta 时不得抹掉已有元数据。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ValidationError
from app.modules.crm.repository import CrmRepository


@pytest.mark.asyncio
async def test_save_coverage_skips_import_meta_sync_when_key_absent(monkeypatch):
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="cv-1",
        customer_id="c-1",
        owner_user_id="u-1",
        status="connected",
        owner_name="销售",
        client_dept=None,
        source_lead_id=None,
        sdr_name=None,
        sdr_transfer_date=None,
        isolation_version=1,
        last_follow_at=None,
        next_follow_at=None,
        is_key=None,
        updated_at=None,
    )

    sync_children = AsyncMock()
    sync_meta = AsyncMock()
    import app.modules.crm.repository.coverages as cov_mod

    monkeypatch.setattr(repo, "_sync_coverage_child_rows", sync_children)
    monkeypatch.setattr(cov_mod, "sync_coverage_import_meta", sync_meta)

    await repo.save_coverage(
        row,
        {
            "contacts": [],
            "notes": [{"id": "n1", "content": "x"}],
            "attachments": [],
            # 故意不传 importMeta
        },
        status="connected",
    )
    sync_children.assert_awaited_once()
    sync_meta.assert_not_awaited()


@pytest.mark.asyncio
async def test_save_coverage_syncs_import_meta_when_key_present(monkeypatch):
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="cv-1",
        customer_id="c-1",
        owner_user_id="u-1",
        status="connected",
        owner_name="销售",
        client_dept=None,
        source_lead_id=None,
        sdr_name=None,
        sdr_transfer_date=None,
        isolation_version=1,
        last_follow_at=None,
        next_follow_at=None,
        is_key=None,
        updated_at=None,
    )
    sync_children = AsyncMock()
    sync_meta = AsyncMock()
    import app.modules.crm.repository.coverages as cov_mod

    monkeypatch.setattr(repo, "_sync_coverage_child_rows", sync_children)
    monkeypatch.setattr(cov_mod, "sync_coverage_import_meta", sync_meta)

    meta = {"source": "auto_leader_coverage", "fromOwnerUserId": "u-2"}
    await repo.save_coverage(
        row,
        {
            "contacts": [],
            "notes": [],
            "attachments": [],
            "importMeta": meta,
        },
    )
    sync_meta.assert_awaited_once()
    assert sync_meta.await_args.args[1] == "cv-1"
    assert sync_meta.await_args.args[2] == meta


@pytest.mark.asyncio
async def test_save_lead_requires_notes_and_attachments_keys():
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="l1",
        status="untouched",
        company_name="x",
        source=None,
        source_detail=None,
        level=None,
        region=None,
        first_contact_date=None,
        contact_name=None,
        follow_state=None,
        brand_name=None,
        sdr=None,
        sales=None,
        transfer_date=None,
        created_day=None,
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
        updated_at=None,
    )
    with pytest.raises(ValidationError, match="notes"):
        await repo.save_lead(row, {"companyName": "x", "status": "untouched"})


@pytest.mark.asyncio
async def test_save_contract_requires_attachments_key():
    db = AsyncMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="ct1",
        customer_id="c1",
        opportunity_id=None,
        status="pending",
        amount=None,
        name=None,
        code=None,
        company=None,
        region=None,
        city=None,
        type=None,
        sign_type=None,
        source=None,
        project_status=None,
        sign_subject=None,
        our_sign_subject=None,
        customer_sign_subject=None,
        signer=None,
        owner=None,
        signer_manager=None,
        dept=None,
        effective_date=None,
        dual_sign_date=None,
        valid_months=None,
        end_date=None,
        status_reason=None,
        created_day=None,
        updated_at=None,
        owner_user_id="u1",
    )
    with pytest.raises(ValidationError, match="attachments"):
        await repo.save_contract(row, {"name": "合同", "status": "pending", "owners": ["销售"]})
