"""线索/合同附件 compose：list children 与 mutate 响应必须带回 attachments。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.crm.repository import CrmRepository
from app.modules.crm.service.contracts import _contract_response
from app.modules.crm.service.leads import _lead_response


@pytest.mark.asyncio
async def test_list_lead_children_includes_attachments():
    db = AsyncMock()
    repo = CrmRepository(db)

    note = SimpleNamespace(
        id="ln1",
        lead_id="l1",
        author="a",
        content="c",
        date=None,
        follow_type=None,
        wechat_added=False,
        mentions=None,
        next_follow_at=None,
        sort_order=0,
    )
    att = SimpleNamespace(
        id="a1",
        entity_type="lead",
        entity_id="l1",
        name="x.pdf",
        size=10,
        kind="file",
        url="/x",
        storage_path=None,
        content_type="application/pdf",
        description=None,
        checksum=None,
        uploaded_by="u",
        uploaded_at=None,
        origin=None,
        source_lead_id=None,
        source_lead_attachment_id=None,
        source_request_id=None,
        source_request_attachment_id=None,
    )

    # notes query, metas query, attachments query
    notes_result = AsyncMock()
    notes_result.scalars = lambda: SimpleNamespace(all=lambda: [note])
    # simpler: use side_effect on execute
    class _Scalars:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return _Scalars(self._rows)

    db.execute = AsyncMock(
        side_effect=[
            _Result([note]),
            _Result([]),  # metas
            _Result([att]),
        ]
    )

    children = await repo.list_lead_children(["l1"])
    assert children["l1"]["notes"][0]["id"] == "ln1"
    assert children["l1"]["attachments"][0]["id"] == "a1"
    assert children["l1"]["attachments"][0]["name"] == "x.pdf"

    row = SimpleNamespace(
        document={"id": "l1", "companyName": "Acme"},
        created_day=None,
        created_at=None,
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
    )
    out = _lead_response(row, **children["l1"])
    assert out["attachments"][0]["name"] == "x.pdf"


@pytest.mark.asyncio
async def test_list_contract_attachments_and_response():
    db = AsyncMock()
    repo = CrmRepository(db)
    att = SimpleNamespace(
        id="ca1",
        entity_type="contract",
        entity_id="ct1",
        name="合同.pdf",
        size=20,
        kind="contract",
        url="/c",
        storage_path=None,
        content_type="application/pdf",
        description=None,
        checksum=None,
        uploaded_by="u",
        uploaded_at=None,
        origin=None,
        source_lead_id=None,
        source_lead_attachment_id=None,
        source_request_id=None,
        source_request_attachment_id=None,
    )

    class _Scalars:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return _Scalars(self._rows)

    db.execute = AsyncMock(return_value=_Result([att]))
    mapped = await repo.list_contract_attachments(["ct1"])
    assert mapped["ct1"][0]["name"] == "合同.pdf"

    row = SimpleNamespace(
        document={"id": "ct1", "name": "合同A"},
        code=None,
        name="合同A",
        company=None,
        region=None,
        city=None,
        geo_source=None,
        type=None,
        sign_type=None,
        source=None,
        status_reason=None,
        project_status=None,
        signer=None,
        sign_subject=None,
        our_sign_subject=None,
        customer_sign_subject=None,
        signer_manager=None,
        dept=None,
        opportunity_id=None,
        owner=None,
        amount=None,
        valid_months=None,
        effective_date=None,
        dual_sign_date=None,
        end_date=None,
        created_day=None,
        status="pending",
    )
    doc = _contract_response(row, owners=["销售"], attachments=mapped["ct1"])
    assert doc["owners"] == ["销售"]
    assert doc["attachments"][0]["id"] == "ca1"
