"""Isolated SQLite workflow tests; never touches the configured CRM database.

Run: python -m unittest discover -s tests -p test_channel_intake_unittest.py -v
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from pydantic import ValidationError as PydanticError
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from fastapi import HTTPException

import app.models
from app.models.base import Base
from app.models.crm import CrmLead, CrmAuditRecord, LeadNote
from app.models.channel import ChannelPartner, ChannelContact, ChannelFollowUp
from app.models.user import User
from app.models.feishu_sales_contact import FeishuSalesContact
from app.core.exceptions import PermissionDeniedError, ValidationError
from app.core.time_utils import china_now
from app.modules.auth.schemas import AuthUser
from app.modules.channel_intake.router import (
    Submission, AssignBody, FollowBody, submit, assign, convert, list_leads,
    assigned_leads, follow_up, share, qr,
)
from app.modules.crm.service import CrmService
from app.modules.crm.repository import CrmRepository


class AsyncFacade:
    """Run real ORM statements against a synchronous in-memory test database."""
    def __init__(self, session): self.session = session
    def add(self, row): self.session.add(row)
    async def get(self, *args, **kwargs): return self.session.get(*args, **kwargs)
    async def execute(self, *args, **kwargs): return self.session.execute(*args, **kwargs)
    async def flush(self): self.session.flush()
    async def commit(self): self.session.commit()
    async def rollback(self): self.session.rollback()


def actor(role="sdr", *, identity=None, scope="own", permissions=None):
    return AuthUser(id=identity or role, feishu_open_id="ou-"+role, name=role, role=role,
                    permissions=permissions if permissions is not None else ["section:leads", "leads:edit", "leads:convert"], data_scope=scope)


class ChannelIntakeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.db = AsyncFacade(self.session)
        self.cache = patch.object(CrmService, "_invalidate_crm_read_caches", new=AsyncMock())
        self.cache.start()
        # The production list orders by MySQL LEFT/DATE_FORMAT; this test replaces
        # only that expression, preserving the real owner and pool predicates.
        self.order = patch.object(CrmRepository, "_lead_created_day_expr", lambda _: CrmLead.created_day)
        self.order.start()
        for identity, role in [("sdr", "sdr"), ("sales-a", "sales"), ("sales-b", "sales")]:
            self.session.add(User(id=identity, feishu_open_id="ou-"+identity, name=identity, role=role, employment_status="active"))
            if role == "sales":
                self.session.add(FeishuSalesContact(feishu_open_id="ou-"+identity, name=identity, is_active=True, synced_at=china_now(), created_at=china_now(), updated_at=china_now()))
        self.session.commit()

    async def asyncTearDown(self):
        self.cache.stop(); self.order.stop(); self.session.close(); self.engine.dispose()

    def body(self, **extra):
        return Submission(**{"submissionKey": str(uuid4()), "companyName": "渠道测试公司", "contactName": "张三", "contactPhone": "13800000000", "contactTitle": "市场经理", "city": "北京", "industry": "消费零售", "channelType": "渠道", "signingMethod": "渠道代理", **extra})

    async def new_lead(self, **extra):
        await submit(self.body(**extra), self.db)
        return self.session.scalars(select(CrmLead).order_by(CrmLead.created_at.desc())).first()

    async def test_submit_persists_all_fields_and_is_idempotent(self):
        body = self.body()
        self.assertEqual(await submit(body, self.db), {"ok": True})
        self.assertEqual(await submit(body, self.db), {"ok": True})
        self.assertEqual(self.session.scalar(select(func.count()).select_from(CrmLead)), 1)
        row = self.session.scalars(select(CrmLead)).one()
        self.assertIsNone(row.owner_user_id)
        self.assertEqual((row.lead_type, row.source, row.sales), ("channel", "渠道资料单", "未分配"))
        self.assertEqual((row.contact_name,row.contact_title,row.contact_phone,row.city,row.industry,row.channel_type,row.signing_method), ("张三","市场经理","13800000000","北京","消费零售","渠道","渠道代理"))
        self.assertEqual(self.session.scalar(select(func.count()).select_from(CrmAuditRecord)), 1)

    async def test_key_reuse_with_changed_payload_is_rejected(self):
        body = self.body(); await submit(body, self.db)
        with self.assertRaises(HTTPException) as caught:
            await submit(body.model_copy(update={"city": "上海"}), self.db)
        self.assertEqual(caught.exception.status_code, 409)

    def test_required_options_phone_and_injected_owner_are_validated(self):
        for extra in [{"companyName":" "}, {"contactName":""}, {"contactTitle":" "}, {"city":""}, {"contactPhone":"abc"}, {"contactPhone":"12345678901"}, {"industry":"未知"}, {"channelType":"其他"}, {"signingMethod":"其他"}, {"ownerUserId":"admin"}]:
            with self.subTest(extra=extra), self.assertRaises(PydanticError): self.body(**extra)
        self.assertEqual(self.body(contactPhone="010-12345678").contact_phone, "01012345678")

    async def test_duplicates_are_separate_leads_and_marked_for_sdr(self):
        await self.new_lead(); await self.new_lead(companyName=" 渠道测试公司 ", contactPhone="138 0000 0000")
        data = await list_leads(page=1,name="",db=self.db,user=actor())
        self.assertEqual(data["total"], 2)
        self.assertEqual([row["duplicateCount"] for row in data["items"]], [2,2])
        self.assertTrue(all("duplicateKey" not in row for row in data["items"]))

    async def test_assign_follow_and_convert_preserves_information_once(self):
        row = await self.new_lead()
        await assign(row.id, AssignBody(salesUserId="sales-a"), self.db, actor())
        self.assertEqual((row.sales,row.assigned_sales_user_id,row.sdr,row.owner_user_id), ("sales-a","sales-a","sdr","sdr"))
        sales = actor("sales", identity="sales-a", permissions=["section:channels","channels:create","channels:write"])
        data = await assigned_leads(page=1,name="",db=self.db,user=sales)
        self.assertEqual(data["total"], 1)
        await follow_up(row.id, FollowBody(content="已确认合作意向"), self.db, sales)
        result = await convert(row.id,self.db,sales)
        self.assertEqual(await convert(row.id,self.db,sales), result)
        partner = self.session.get(ChannelPartner, result["partnerId"])
        contact = self.session.scalars(select(ChannelContact)).one()
        self.assertEqual((partner.name,partner.cooperation_type,partner.signing_method,partner.city,partner.owner_user_id), ("渠道测试公司","渠道","渠道代理","北京","sales-a"))
        self.assertIn("消费零售",partner.industries_json)
        self.assertEqual((contact.name,contact.phone,contact.title),("张三","13800000000","市场经理"))
        self.assertEqual(self.session.scalar(select(func.count()).select_from(ChannelPartner)),1)
        self.assertEqual(self.session.scalar(select(func.count()).select_from(ChannelFollowUp)),1)
        self.assertEqual(row.status,"converted")

    async def test_readonly_denied_and_assignable_sales_enforced(self):
        row = await self.new_lead()
        readonly = actor("ops", scope="all", permissions=["section:leads"])
        with self.assertRaises(PermissionDeniedError): await assign(row.id,AssignBody(salesUserId="sales-a"),self.db,readonly)
        with self.assertRaises(PermissionDeniedError): await convert(row.id,self.db,readonly)
        with self.assertRaises(HTTPException) as caught: await assign(row.id,AssignBody(salesUserId="sdr"),self.db,actor())
        self.assertEqual(caught.exception.status_code,403)
        with self.assertRaises(HTTPException): await convert(row.id,self.db,actor())

    async def test_sales_cannot_read_or_mutate_another_sales_lead(self):
        row=await self.new_lead(); await assign(row.id,AssignBody(salesUserId="sales-a"),self.db,actor())
        other = actor("sales", identity="sales-b", permissions=["section:channels","channels:create","channels:write"])
        self.assertEqual((await assigned_leads(page=1,name="",db=self.db,user=other))["total"],0)
        with self.assertRaises(HTTPException) as caught: await convert(row.id,self.db,other)
        self.assertEqual(caught.exception.status_code,404)
        with self.assertRaises(HTTPException): await follow_up(row.id,FollowBody(content="越权"),self.db,other)
        with self.assertRaises(PermissionDeniedError): await assign(row.id,AssignBody(salesUserId="sales-b"),self.db,other)

    async def test_no_section_denied_and_direct_customer_conversion_blocked(self):
        with self.assertRaises(PermissionDeniedError): await list_leads(page=1,name="",db=self.db,user=actor("overseas",permissions=[]))
        row=await self.new_lead()
        with self.assertRaises(ValidationError): await CrmService(self.db).convert_lead(actor(),row.id)

    async def test_share_url_and_qr_use_same_fixed_public_path(self):
        data=await share(actor(),self.db)
        self.assertTrue(data["url"].endswith("/channel-profile"))
        response=await qr(actor(),self.db)
        self.assertEqual(response.media_type,"image/svg+xml")
        self.assertIn(b"<svg",response.body)


if __name__ == "__main__": unittest.main()
