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
async def test_stage_rollback_does_not_reset_request(setup_db):
    db,crm=setup_db
    opp=await crm.create_opportunity(user(),{'customerId':'customer','name':'rollback'})
    db.add(Request(id='req',code='GEO-CN-TEST',status='in_project',owner='owner',updated_at=china_now()))
    await db.commit()
    for stage in ('demand_research','demand_diagnosis','solution_confirm','demand_research'):
        saved=await crm.update_opportunity(user(),opp['id'],{'stage':stage})
        assert saved['stage']==stage and saved['requestIds']==[]
        assert (await db.get(Request,'req')).status=='in_project'
    with pytest.raises(ValidationError):
        await crm.update_opportunity(user(),opp['id'],{'stage':'contact'})

