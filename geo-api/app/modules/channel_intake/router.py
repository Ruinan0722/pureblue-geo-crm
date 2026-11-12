"""Public, write-only channel intake; authenticated lead workflow reuses CRM scope."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Literal
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.time_utils import china_now
from app.models.channel import ChannelContact, ChannelHistory, ChannelPartner
from app.models.crm import CrmLead, LeadNote
from app.models.user import User
from app.modules.auth.schemas import AuthUser, CamelModel
from app.modules.crm.service import CrmService
from app.modules.crm.service.leads import _lead_response
from app.modules.users.repository import UsersRepository

router = APIRouter(prefix="/channel-intake", tags=["channel-intake"])
SOURCE = "渠道资料单"
INDUSTRIES = ("工业制造", "科技互联网", "消费零售", "医疗健康", "金融", "教育", "地产建筑", "文旅餐饮", "农林牧渔", "政府与公共事业")


def _public_url() -> str:
    settings = get_settings()
    return settings.channel_intake_public_url.strip() or settings.customer_portal_url.rstrip("/") + "/channel-profile"


class Submission(CamelModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, populate_by_name=True, alias_generator=lambda s: s.split('_')[0] + ''.join(p.title() for p in s.split('_')[1:]))
    submission_key: UUID
    company_name: str = Field(min_length=1, max_length=255)
    contact_name: str = Field(min_length=1, max_length=128)
    contact_phone: str = Field(min_length=1, max_length=64)
    contact_title: str = Field(min_length=1, max_length=128)
    city: str = Field(min_length=1, max_length=128)
    industry: str
    channel_type: Literal["个人", "分销", "渠道", "生态"]
    signing_method: Literal["直销", "渠道代理"]

    @field_validator("industry")
    @classmethod
    def industry_valid(cls, value):
        if value not in INDUSTRIES:
            raise ValueError("请选择有效行业")
        return value

    @field_validator("contact_phone")
    @classmethod
    def phone_valid(cls, value):
        compact = re.sub(r"[\s()（）-]", "", value)
        # Domestic mobile, landline with area code, or international contact number.
        if not re.fullmatch(r"(?:1[3-9]\d{9}|0\d{9,11}|\+\d{7,15})(?:转\d{1,6})?", compact):
            raise ValueError("请输入有效手机号或带区号的联系电话")
        return compact


class AssignBody(CamelModel):
    sales_user_id: str = Field(min_length=1, max_length=36)


class FollowBody(CamelModel):
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def content_valid(cls, value):
        if not value.strip():
            raise ValueError("请填写跟进内容")
        return value.strip()


def _duplicate_key(body: Submission) -> str:
    company = re.sub(r"\s+", "", body.company_name).casefold()
    return hashlib.sha256(f"{company}|{body.contact_phone}".encode()).hexdigest()


def _submission_id(body: Submission) -> str:
    return str(uuid5(NAMESPACE_URL, f"channel-profile:{body.submission_key}"))


def _same_submission(row: CrmLead, body: Submission) -> bool:
    return all(getattr(row, key, None) == value for key, value in body.model_dump(exclude={"submission_key"}).items()) and row.lead_type == "channel"


async def _audit(svc, row, action, user=None, changes=None):
    await svc.repo.create_audit_record(
        record_id=str(uuid4()), module="线索管理", entity_type="lead", entity_id=row.id,
        related_entity_ids=None, entity_name=row.company_name, action=action,
        actor=user.name if user else "渠道资料单", actor_user_id=user.id if user else None,
        timestamp_at=china_now(), changes=changes or [],
    )


@router.post("/submit")
async def submit(body: Submission, db: AsyncSession = Depends(get_db_session)):
    """No reads or record identifiers in the public response. Retries are idempotent."""
    lead_id = _submission_id(body)
    previous = await db.get(CrmLead, lead_id)
    if previous:
        if not _same_submission(previous, body):
            raise HTTPException(409, "提交内容已变更，请刷新页面后重试")
        return {"ok": True}
    svc = CrmService(db)
    document = body.model_dump(by_alias=True, exclude={"submission_key"})
    document.update(id=lead_id, leadType="channel", source=SOURCE, status="untouched",
                    sales="未分配", sdr="", notes=[], attachments=[],
                    duplicateKey=_duplicate_key(body), createdAt=china_now().date().isoformat())
    try:
        row = await svc.repo.create_lead(document=document, owner_user_id=None)
        await _audit(svc, row, "提交渠道资料单")
        await svc._commit_and_invalidate_crm()
    except IntegrityError:
        await db.rollback()
        row = await db.get(CrmLead, lead_id)
        if not row or not _same_submission(row, body):
            raise
    return {"ok": True}


def _reader(user, svc):
    svc._assert_section(user, "leads")


async def _locked_lead(db, user, svc, lead_id, *, allow_sales=False):
    row = (await db.execute(select(CrmLead).where(CrmLead.id == lead_id).with_for_update())).scalar_one_or_none()
    if not row or row.lead_type != "channel":
        raise HTTPException(404, "渠道线索不存在")
    if "section:leads" in user.permissions:
        await svc._assert_row_access(user, row.owner_user_id, lead_pool=True, lead_sdr_name=row.sdr)
    elif allow_sales:
        from app.modules.channel_management.router import _require, _managed_ids
        from app.core.deps import user_data_scope
        _require(user)
        if user_data_scope(user) != "all" and row.assigned_sales_user_id not in await _managed_ids(db, user):
            raise HTTPException(404, "渠道线索不存在")
    else:
        _reader(user, svc)
    return row


@router.get("/share")
async def share(user: AuthUser = Depends(require_user), db: AsyncSession = Depends(get_db_session)):
    _reader(user, CrmService(db))
    return {"url": _public_url()}


@router.get("/qr")
async def qr(user: AuthUser = Depends(require_user), db: AsyncSession = Depends(get_db_session)):
    _reader(user, CrmService(db))
    from reportlab.graphics import renderSVG
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing, Rect
    url = _public_url()
    widget = QrCodeWidget(url, barLevel="M")
    drawing = Drawing(240, 240)
    drawing.add(Rect(0, 0, 240, 240, fillColor=__import__('reportlab.lib.colors', fromlist=['white']).white, strokeColor=None))
    widget.barWidth = widget.barHeight = 240
    drawing.add(widget)
    return Response(renderSVG.drawToString(drawing), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@router.get("/leads")
async def list_leads(page: int = Query(1, ge=1), name: str = "", db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    result = await svc.list_leads(user, source=SOURCE, page=page, page_size=10, name=name)
    # Duplicate indicators use the same owner/SDR pool scope as the list itself.
    owner_clause = svc.repo._lead_owner_clause(await svc._owner_filter(user, lead_pool=True), include_unassigned=svc._include_unassigned(user, lead_pool=True))
    scope = svc.repo._lead_pool_clause(owner_clause, await svc._sdr_pool_names(user))
    keys = [item.get("duplicateKey") for item in result["items"] if item.get("duplicateKey")]
    query = select(CrmLead.duplicate_key, func.count()).where(CrmLead.lead_type == "channel", CrmLead.duplicate_key.in_(keys)).group_by(CrmLead.duplicate_key)
    if scope is not None:
        query = query.where(scope)
    counts = dict((await db.execute(query)).all()) if keys else {}
    for item in result["items"]:
        item["duplicateCount"] = counts.get(item.pop("duplicateKey", None), 1)
    return result


@router.get("/assigned-leads")
async def assigned_leads(page: int = Query(1, ge=1), name: str = "", db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    from app.modules.channel_management.router import _require, _managed_ids
    from app.core.deps import user_data_scope
    _require(user)
    conditions = [CrmLead.lead_type == "channel", CrmLead.assigned_sales_user_id.is_not(None)]
    if user_data_scope(user) != "all":
        conditions.append(CrmLead.assigned_sales_user_id.in_(await _managed_ids(db, user)))
    if name.strip():
        conditions.append(CrmLead.company_name.contains(name.strip(), autoescape=True))
    total = (await db.execute(select(func.count()).select_from(CrmLead).where(*conditions))).scalar_one()
    rows = (await db.execute(select(CrmLead).where(*conditions).order_by(CrmLead.created_at.desc()).offset((page-1)*10).limit(10))).scalars().all()
    return {"items": [{**_lead_response(row), "duplicateCount": 1} for row in rows], "total": total}


@router.get("/leads/{lead_id}/follow-ups")
async def follow_ups(lead_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    row = await _locked_lead(db, user, svc, lead_id, allow_sales=True)
    children = await svc.repo.get_lead_children(row.id)
    return sorted(children.get("notes") or [], key=lambda note: str(note.get("date") or ""), reverse=True)


@router.post("/leads/{lead_id}/follow-up")
async def follow_up(lead_id: str, body: FollowBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    row = await _locked_lead(db, user, svc, lead_id, allow_sales=True)
    if "section:leads" in user.permissions:
        svc._assert_lead_write(user, "leads:edit")
    else:
        from app.modules.channel_management.router import _require
        _require(user, "channels:write")
    if row.status in {"invalid", "converted"}:
        raise HTTPException(409, "该线索已关闭")
    count = (await db.execute(select(func.coalesce(func.max(LeadNote.sort_order), -1)).where(LeadNote.lead_id == row.id))).scalar_one()
    db.add(LeadNote(id=str(uuid4()), lead_id=row.id, author=user.name, content=body.content, date=china_now(), wechat_added=False, sort_order=int(count)+1))
    row.status, row.updated_at = "touched", china_now()
    await _audit(svc, row, "记录渠道线索跟进", user)
    await svc._commit_and_invalidate_crm(user.id, row.owner_user_id)
    return {"ok": True}


@router.get("/sales")
async def sales(db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    _reader(user, svc)
    ids = await UsersRepository(db).get_sales_directory_user_ids()
    rows = (await db.execute(select(User).where(User.id.in_(ids), User.employment_status == "active").order_by(User.name))).scalars().all()
    return [{"id": row.id, "name": row.name} for row in rows]


@router.post("/leads/{lead_id}/assign")
async def assign(lead_id: str, body: AssignBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    row = await _locked_lead(db, user, svc, lead_id)
    svc._assert_lead_write(user, "leads:edit")
    if row.status in {"converted", "invalid"}:
        raise HTTPException(409, "该线索已关闭，不能分配")
    # Always require an active sales-directory member, including for all-scope users.
    if body.sales_user_id not in await UsersRepository(db).get_sales_directory_user_ids():
        raise HTTPException(403, "只能分配给在职销售成员")
    target = await db.get(User, body.sales_user_id)
    if not target or target.employment_status != "active":
        raise HTTPException(400, "销售成员已停用")
    before = row.sales or "未分配"
    row.sales, row.assigned_sales_user_id = target.name, target.id
    if not row.owner_user_id and svc._is_sdr_role(user):
        row.owner_user_id, row.sdr = user.id, user.name
    row.updated_at = china_now()
    await _audit(svc, row, "分配渠道销售", user, [{"field": "sales", "label": "销售负责人", "before": before, "after": target.name}])
    await svc._commit_and_invalidate_crm(user.id, row.owner_user_id)
    return {"ok": True}


@router.post("/leads/{lead_id}/convert")
async def convert(lead_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    svc = CrmService(db)
    row = await _locked_lead(db, user, svc, lead_id, allow_sales=True)
    if "section:leads" in user.permissions:
        svc._assert_lead_write(user, "leads:convert")
    else:
        from app.modules.channel_management.router import _require
        _require(user, "channels:create")
    if row.converted_partner_id:
        return {"partnerId": row.converted_partner_id}
    if row.status in {"invalid", "converted"}:
        raise HTTPException(409, "该线索已关闭")
    if not row.sales or row.sales in {"未分配", "待分配"}:
        raise HTTPException(400, "请先分配渠道销售")
    owner = await db.get(User, row.assigned_sales_user_id) if row.assigned_sales_user_id else None
    if not owner or owner.id not in await UsersRepository(db).get_sales_directory_user_ids():
        raise HTTPException(400, "原销售成员已失效，请重新分配")
    now = china_now()
    partner = ChannelPartner(
        id=str(uuid4()), name=row.company_name, source=SOURCE, city=row.city,
        cooperation_type=row.channel_type, signing_method=row.signing_method,
        industries_json=json.dumps([row.industry] if row.industry else [], ensure_ascii=False),
        owner_user_id=owner.id, owner_name=owner.name, owner_department=(owner.department_names or [None])[0],
        created_by_user_id=user.id, created_by_name=user.name, created_at=now, updated_at=now,
    )
    db.add(partner)
    db.add(ChannelContact(id=str(uuid4()), partner_id=partner.id, name=row.contact_name or "", title=row.contact_title,
                          phone=row.contact_phone, is_primary=True, created_at=now, updated_at=now))
    children = await svc.repo.get_lead_children(row.id)
    from app.models.channel import ChannelFollowUp
    for note in children.get("notes") or []:
        from app.modules.crm.repository.base import _doc_datetime
        db.add(ChannelFollowUp(id=str(uuid4()), partner_id=partner.id, author_user_id=user.id,
                               author_name=note.get("author") or user.name, content=note.get("content") or "",
                               created_at=_doc_datetime(note, "date") or now))
    db.add(ChannelHistory(id=str(uuid4()), partner_id=partner.id, actor_user_id=user.id, actor_name=user.name,
                          action="lead_converted", detail=f"渠道资料单线索 {row.id} 转入；签约意向：{row.signing_method}", created_at=now))
    row.status, row.converted_partner_id = "converted", partner.id
    row.transfer_date, row.updated_at = now.date(), now
    await _audit(svc, row, "转为渠道商", user, [{"field": "convertedPartnerId", "label": "渠道商", "before": "", "after": partner.id}])
    await svc._commit_and_invalidate_crm(user.id, owner.id)
    return {"partnerId": partner.id}
