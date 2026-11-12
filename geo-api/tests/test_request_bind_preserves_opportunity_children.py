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
async def test_reject_legacy_writes_from_both_sides(setup_db):
    db,crm=setup_db
    opp=await crm.create_opportunity(user(),{'customerId':'customer','name':'legacy-write'})
    db.add(Request(id='req',code='GEO-CN-TEST',status='confirmed',owner='owner',staff_user_id='owner',updated_at=china_now()))
    await db.commit()
    svc=RequestService(db)
    with pytest.raises(ValidationError,match='绑定功能已取消'):
        await svc.patch('req',PatchRequestBody(opportunityId=opp['id']),user())
    with pytest.raises(ValidationError,match='绑定功能已取消'):
        await crm.update_opportunity(user(),opp['id'],{'requestIds':['req']})
    with pytest.raises(ValidationError,match='绑定功能已取消'):
        await crm.create_opportunity(user(),{'customerId':'customer','name':'bad','requestIds':['req']})
    assert (await db.get(Request,'req')).opportunity_id is None
    assert not (await db.execute(sa.select(OpportunityRequestLink))).scalars().all()

