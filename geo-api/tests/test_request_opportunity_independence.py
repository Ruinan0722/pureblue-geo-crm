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
async def test_existing_scope_and_permission_checks_are_enforced(setup_db):
    db,crm=setup_db
    opp=await crm.create_opportunity(user(),{'customerId':'customer','name':'scope'})
    db.add(Request(id='req',code='GEO-CN-TEST',status='confirmed',owner='owner',staff_user_id='owner',updated_at=china_now()))
    await db.commit()
    with pytest.raises(PermissionDeniedError):
        await crm.update_opportunity(user('sales','other'),opp['id'],{'stage':'demand_research'})
    with pytest.raises(PermissionDeniedError):
        await RequestService(db).patch('req',PatchRequestBody(status='in_project'),user('sales','other'))
    with pytest.raises(PermissionDeniedError):
        await crm.get_opportunity(user('overseas'),opp['id'])
    with pytest.raises(ValidationError):
        await crm.update_opportunity(user(),opp['id'],{'geoSource':'overseas'})

def test_migration_archives_both_sides_preserves_stages_and_effective_geo():
    spec=importlib.util.spec_from_file_location('retire',Path(__file__).resolve().parents[1]/'alembic/versions/076_retire_request_bindings.py')
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    engine=sa.create_engine('sqlite:///:memory:')
    meta=sa.MetaData()
    req=sa.Table('requests',meta,sa.Column('id',sa.String,primary_key=True),sa.Column('code',sa.String),sa.Column('opportunity_id',sa.String),sa.Column('status',sa.String),sa.Column('owner',sa.String))
    imports=sa.Table('request_import_meta',meta,sa.Column('request_id',sa.String),sa.Column('source',sa.String))
    opp=sa.Table('crm_opportunities',meta,sa.Column('id',sa.String,primary_key=True),sa.Column('stage',sa.String),sa.Column('geo_source',sa.String),sa.Column('owner_user_id',sa.String))
    links=sa.Table('opportunity_request_ids',meta,sa.Column('id',sa.String,primary_key=True),sa.Column('request_id',sa.String),sa.Column('opportunity_id',sa.String))
    meta.create_all(engine)
    with engine.begin() as conn:
        conn.execute(req.insert(),[{'id':'r','code':'GEO-CN-TEST','opportunity_id':'o','status':'in_project','owner':'owner'}])
        conn.execute(opp.insert(),[{'id':'o','stage':'signing','geo_source':'overseas','owner_user_id':'owner'},{'id':'no-link','stage':'contact','geo_source':'overseas','owner_user_id':'owner'}])
        conn.execute(links.insert(),[{'id':'link','request_id':'r','opportunity_id':'o'}])
        migration.op=Operations(MigrationContext.configure(conn));migration.upgrade()
        archive=sa.Table('retired_request_opportunity_links',sa.MetaData(),autoload_with=conn)
        assert len(conn.execute(sa.select(archive)).all())==2
        assert not conn.execute(sa.select(links)).all()
        record=conn.execute(sa.select(req)).mappings().one()
        assert record['opportunity_id'] is None and record['status']=='in_project' and record['owner']=='owner'
        records={r['id']:r for r in conn.execute(sa.select(opp)).mappings()}
        assert records['o']['stage']=='signing' and records['o']['geo_source']=='domestic'
        assert records['no-link']['geo_source']=='overseas'
