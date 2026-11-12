"""Real isolated SQL regression coverage for retired demand associations."""
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models import Request, CrmOpportunity
from app.models.crm import OpportunityRequestLink
from app.core.exceptions import ValidationError, PermissionDeniedError
from app.core.time_utils import china_now
from app.modules.requests.service import RequestService
from app.modules.requests.schemas import PatchRequestBody
from test_unified_partner_workflow import setup_db, user


@pytest.mark.asyncio
async def test_request_notes_are_not_copied_to_opportunity(setup_db):
    db,crm=setup_db
    opp=await crm.create_opportunity(user(),{'customerId':'customer','name':'no-auto-carry'})
    db.add(Request(id='req',code='GEO-CN-TEST',status='confirmed',owner='owner',staff_user_id='owner',updated_at=china_now()))
    await db.commit()
    svc=RequestService(db)
    svc._invalidate_workbench_caches=AsyncMock()
    svc._enrich_records=AsyncMock(side_effect=lambda records:records)
    saved=await svc.patch('req',PatchRequestBody(note='demand only'),user())
    assert saved.notes[-1].content=='demand only'
    assert (await crm.get_opportunity(user(),opp['id']))['notes']==[]
