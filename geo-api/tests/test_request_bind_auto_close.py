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
async def test_request_can_finish_and_read_without_touching_opportunity(setup_db):
    db,crm=setup_db
    opp=await crm.create_opportunity(user(),{'customerId':'customer','name':'independent'})
    db.add(Request(id='req',code='GEO-CN-TEST',status='confirmed',owner='owner',staff_user_id='owner',updated_at=china_now(),opportunity_id=opp['id']))
    await db.commit()
    svc=RequestService(db)
    svc._invalidate_workbench_caches=AsyncMock()
    svc._enrich_records=AsyncMock(side_effect=lambda records:records)
    result=await svc.patch('req',PatchRequestBody(status='in_project',owner='owner'),user())
    assert result.status=='in_project' and result.opportunity_id is None
    assert (await crm.get_opportunity(user(),opp['id']))['stage']=='contact'
    # A detail GET must not auto-close a demand or advance a linked legacy opportunity.
    await svc.get_detail('req',user())
    assert (await db.get(Request,'req')).status=='in_project'
    assert (await crm.get_opportunity(user(),opp['id']))['stage']=='contact'

