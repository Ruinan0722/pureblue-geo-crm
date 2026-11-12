"""Isolated SQL integration tests: common pipeline, routing and partner fields."""
import importlib.util
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models.base import Base
from app.models import ChannelPartner, ChannelContract, CrmOpportunity, User, Request
from app.models.crm import CrmContract
from app.core.exceptions import ValidationError, PermissionDeniedError
from app.core.time_utils import china_now
from app.modules.auth.schemas import AuthUser
from app.modules.auth.permissions import ROLE_PERMISSIONS
from app.modules.crm.service import CrmService
from app.modules.channel_management.router import PartnerBody, FollowUpBody, _apply_ecosystem_fields, _partner_dict, _validate_partner, create_followup, list_followups, sign_contract

def user(role='admin', uid='owner'):
    return AuthUser(id=uid, feishu_open_id='ou-'+uid, name=uid, role=role, permissions=list(ROLE_PERMISSIONS[role]), data_scope='all' if role in ('admin','overseas') else 'own')

@pytest_asyncio.fixture
async def setup_db():
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add(User(id='owner',feishu_open_id='ou-owner',name='owner',employment_status='active'))
        for kind in ('channel','strategic_ecosystem'):
            db.add(ChannelPartner(id=kind,name=kind,partner_type=kind,brand_name='品牌',owner_user_id='owner',owner_name='owner',created_by_user_id='owner',created_by_name='owner',created_at=china_now(),updated_at=china_now()))
        await db.commit()
        service=CrmService(db)
        async def commit(*args): await db.commit()
        service._commit_and_invalidate_crm=commit
        service.repo.next_contract_code=AsyncMock(side_effect=['PBA90001','PBA90002','PBA90003'])
        yield db,service
    await engine.dispose()

@pytest.mark.asyncio
@pytest.mark.parametrize('kind',['channel','strategic_ecosystem'])
async def test_common_pipeline_routing_gates_and_idempotence(setup_db,kind):
    db,service=setup_db
    doc=await service.create_opportunity(user(),{'name':'品牌-总部-监测-202610','businessType':kind,'partnerId':kind,'owner':'forged','stage':'contact','projectTypes':['监测']})
    assert doc['businessType']==kind and doc['partnerId']==kind and doc['customerId']==''
    assert doc['owner']=='owner'
    row=await db.get(CrmOpportunity,doc['id'])
    assert row.owner_user_id=='owner'
    assert len(await service.list_opportunities(user()))==1
    with pytest.raises(ValidationError):
        await service.update_opportunity(user(),doc['id'],{'businessType':'direct'})
    # No demand is created or bound; use the real common pipeline and SQL writes.
    result=await service.update_opportunity(user(),doc['id'],{'stage':'signing'})
    assert result['stage']=='signing'
    contracts=(await db.execute(select(ChannelContract))).scalars().all()
    assert len(contracts)==1 and contracts[0].partner_id==kind and contracts[0].opportunity_id==doc['id']
    assert ('战略生态合同' if kind=='strategic_ecosystem' else '渠道合同') in contracts[0].name
    assert not (await db.execute(select(CrmContract))).scalars().all()
    await service.update_opportunity(user(),doc['id'],{'stage':'signing'})
    await service.update_opportunity(user(),doc['id'],{'stage':'bidding'})
    await service.update_opportunity(user(),doc['id'],{'stage':'signing'})
    assert len((await db.execute(select(ChannelContract))).scalars().all())==1

@pytest.mark.asyncio
async def test_direct_sales_contract_is_still_sales_contract(setup_db):
    db,service=setup_db
    doc=await service.create_opportunity(user(),{'name':'直销-总部-监测-202610','customerId':'customer','projectTypes':['监测']})
    result=await service.update_opportunity(user(),doc['id'],{'stage':'signing'})
    assert result['_createdContract']['opportunityId']==doc['id']
    assert len((await db.execute(select(CrmContract))).scalars().all())==1
    assert not (await db.execute(select(ChannelContract))).scalars().all()

@pytest.mark.asyncio
async def test_partner_create_denies_cross_owner_and_wrong_kind(setup_db):
    db,service=setup_db
    with pytest.raises(HTTPException) as error:
        await service.create_opportunity(user('sales','other'),{'name':'越权','businessType':'channel','partnerId':'channel'})
    assert error.value.status_code==404
    with pytest.raises(ValidationError):
        await service.create_opportunity(user(),{'name':'错来源','businessType':'channel','partnerId':'strategic_ecosystem'})
    with pytest.raises(HTTPException):
        await service.create_opportunity(user('overseas'),{'name':'海外越权','businessType':'channel','partnerId':'channel'})

@pytest.mark.asyncio
async def test_ecosystem_merged_fields_round_trip_and_validation(setup_db):
    db,service=setup_db
    partner=await db.get(ChannelPartner,'strategic_ecosystem')
    body=PartnerBody(name=partner.name,partnerType='strategic_ecosystem',brandName='品牌',customerType='伙伴',customerSubtype='蓝色光标',serviceContents=['监测','监测'],budgetAmount=12345.67,bdUserIds=['owner'],projectStatus='执行中',expectedSignMonth='2026-11-01',demandDescription='需求',projectNotes='备注',executionStatus='执行完成',executionProduct='本品',executionIntentCount=12,executionPlatformCount=3,executionPeriodMonths=6,executionEndDate='2027-04-01')
    _validate_partner(body)
    await _apply_ecosystem_fields(db,partner,body)
    await db.commit(); await db.refresh(partner)
    result=_partner_dict(partner)
    assert result['customerSubtype']=='蓝色光标' and result['serviceContents']==['监测']
    assert result['bdNames']==['owner'] and result['budgetAmount']==12345.67
    assert result['executionStatus']=='执行完成' and result['executionIntentCount']==12
    assert result['expectedSignMonth']=='2026-11-01' and result['executionEndDate']=='2027-04-01'
    with pytest.raises(HTTPException): _validate_partner(body.model_copy(update={'execution_status':'待执行'}))
    with pytest.raises(HTTPException): await _apply_ecosystem_fields(db,partner,body.model_copy(update={'bd_user_ids':['forged']}))

@pytest.mark.asyncio
async def test_shared_follow_up_validation_contacts_and_plan(setup_db):
    from app.models.channel import ChannelContact
    db,service=setup_db
    db.add(ChannelContact(id='contact',partner_id='channel',name='对接人',created_at=china_now(),updated_at=china_now()))
    await db.commit()
    body=FollowUpBody(content='沟通记录',followType='online',contactId='contact',mentions=['owner'],nextFollowAt=(china_now()+timedelta(days=1)).date())
    await create_followup('channel',body,db,user())
    rows=await list_followups('channel',db,user())
    assert rows[0]['contactName']=='对接人' and rows[0]['followType']=='online' and rows[0]['mentions']==['owner']
    with pytest.raises(HTTPException): await create_followup('strategic_ecosystem',body,db,user())
    with pytest.raises(HTTPException): await create_followup('channel',body.model_copy(update={'next_follow_at':china_now().date()-timedelta(days=1)}),db,user())
    await create_followup('channel',body.model_copy(update={'next_follow_at':None}),db,user())
    assert (await db.get(ChannelPartner,'channel')).next_follow_at is None
