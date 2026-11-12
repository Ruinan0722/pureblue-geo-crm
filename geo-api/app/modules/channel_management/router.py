from __future__ import annotations

import json
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user, user_data_scope
from app.core.time_utils import china_now
from app.models.channel import (
    ChannelContact,
    ChannelContract,
    ChannelFollowUp,
    ChannelHistory,
    ChannelOpportunity,
    ChannelPartner,
)
from app.modules.auth.schemas import AuthUser
from app.modules.contracts.status_catalog import (
    CHANNEL_AGENCY_TYPES,
    CHANNEL_CONTRACT_STATUSES,
    CHANNEL_LEVELS,
    CHANNEL_OPPORTUNITY_STAGES,
    CHANNEL_REGIONS,
    CHANNEL_TYPES,
    LEAD_SOURCE_CONTENT_CHANNELS,
    LEAD_SOURCE_WEBSITE_ENTRIES,
    LEAD_SOURCES,
    INDUSTRIES,
    MEETING_PRIMARY_SOURCES,
)
from app.modules.crm.schemas import CamelModel
from app.models.user import User
from app.models.crm import CrmOpportunity
from app.modules.crm.service import CrmService
from app.modules.channel_management.access import (
    require_partner_permission as _require, managed_partner_owner_ids as _managed_ids,
    partner_visible as _visible, require_partner as _partner,
)
from app.modules.channel_management.unified_opportunities import partner_opportunity_view, LEGACY_STAGES
from app.modules.contracts.status_catalog import FOLLOW_TYPE_OPTIONS
from app.modules.channel_management.contract_fields import ContractBody, ContractAttachmentsBody, apply_contract_fields, contract_dict, contract_attachments
from app.modules.crm.attachment_store import build_attachment_records, load_attachment
from app.core.exceptions import AppError

router = APIRouter(prefix="/channels", tags=["channel-management"])
OPPORTUNITY_STAGES = tuple(CHANNEL_OPPORTUNITY_STAGES)


ECOSYSTEM_PRIMARY_SOURCES = {"KA客户", "阿里集团", "蓝色光标", "新华网", "其他渠道"}
ECOSYSTEM_SECONDARY_REQUIRED = {"阿里集团", "蓝色光标", "其他渠道"}


def _is_ecosystem_source(body):
    return body.partner_type == "strategic_ecosystem" and body.source in ECOSYSTEM_PRIMARY_SOURCES | {"战略生态"}


class EcosystemContactInput(CamelModel):
    name: str = Field(min_length=1, max_length=128)
    phone: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=128)


class PartnerBody(CamelModel):
    ecosystem_department: str | None = Field(default=None, max_length=128)
    ecosystem_contacts: list[EcosystemContactInput] = Field(default_factory=list, max_length=50)
    name: str = Field(default="", max_length=255)
    partner_type: str = "channel"
    brand_name: str | None = None
    channel_type: str | None = None
    source: str | None = None
    source_detail: str | None = None
    level: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    region: str | None = None
    city: str | None = None
    website: str | None = None
    industries: list[str] = Field(default_factory=list)
    major_customers: str | None = None
    team_support: bool | None = None
    agency_types: list[str] = Field(default_factory=list)
    cooperation_project: str | None = None


    customer_type: str | None = Field(default=None, max_length=128)
    customer_subtype: str | None = Field(default=None, max_length=128)
    service_contents: list[str] = Field(default_factory=list)
    budget_amount: float | None = Field(default=None, ge=0)
    bd_user_ids: list[str] = Field(default_factory=list)
    primary_opportunity_id: str | None = None
    project_status: str | None = None
    expected_sign_month: date | None = None
    demand_description: str | None = None
    project_notes: str | None = None
    execution_status: str | None = None
    execution_product: str | None = None
    execution_intent_count: int | None = Field(default=None, ge=0)
    execution_platform_count: int | None = Field(default=None, ge=0)
    execution_period_months: int | None = Field(default=None, ge=0, le=1200)
    execution_end_date: date | None = None


class ContactBody(CamelModel):
    name: str = Field(min_length=1, max_length=128)
    title: str | None = None
    department: str | None = None
    contact_type: str | None = None
    phone: str | None = None
    method: str | None = None
    is_primary: bool = False


class FollowUpBody(CamelModel):
    content: str = Field(min_length=1)
    follow_type: str
    mentions: list[str] = Field(default_factory=list)
    contact_id: str | None = None
    next_follow_at: date | None = None


class OpportunityBody(CamelModel):
    name: str = Field(min_length=1, max_length=255)


class StageBody(CamelModel):
    stage: str
    lost_reason: str | None = None


async def _history(db: AsyncSession, row: ChannelPartner, user: AuthUser, action: str, detail: str | None = None) -> None:
    db.add(ChannelHistory(id=str(uuid4()), partner_id=row.id, actor_user_id=user.id, actor_name=user.name, action=action, detail=detail, created_at=china_now()))


async def _contract_status(db: AsyncSession, partner_id: str) -> str:
    statuses = (await db.execute(select(ChannelContract.status).where(ChannelContract.partner_id == partner_id))).scalars().all()
    return "是" if any(value == "是" for value in statuses) else "走入库流程了" if any(value == "走入库流程了" for value in statuses) else "准备签约" if any(value == "准备签约" for value in statuses) else "否"


def _json_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return []


def _partner_dict(row: ChannelPartner, contract_status: str = "否") -> dict:
    return {
        "id": row.id, "name": row.name, "partnerType": row.partner_type or "channel", "brandName": row.brand_name,
        "channelType": row.channel_type, "source": row.source,
        "cooperationType": row.cooperation_type, "signingMethod": row.signing_method,
        "sourceDetail": row.source_detail, "ecosystemDepartment": row.ecosystem_department, "level": row.level, "ownerUserId": row.owner_user_id,
        "ownerName": row.owner_name, "region": row.region, "city": row.city, "website": row.website,
        "industries": _json_list(row.industries_json), "majorCustomers": row.major_customers,
        "teamSupport": row.team_support, "agencyTypes": _json_list(row.agency_types_json),
        "cooperationProject": row.cooperation_project, "contractStatus": contract_status,
        "customerType": row.customer_type, "customerSubtype": row.customer_subtype,
        "serviceContents": _json_list(row.service_contents_json), "budgetAmount": float(row.budget_amount) if row.budget_amount is not None else None,
        "bdUserIds": _json_list(row.bd_user_ids_json), "bdNames": _json_list(row.bd_names_json),
        "primaryOpportunityId": row.primary_opportunity_id, "projectStatus": row.project_status,
        "expectedSignMonth": row.expected_sign_month.isoformat() if row.expected_sign_month else None,
        "demandDescription": row.demand_description, "projectNotes": row.project_notes,
        "executionStatus": row.execution_status, "executionProduct": row.execution_product,
        "executionIntentCount": row.execution_intent_count, "executionPlatformCount": row.execution_platform_count,
        "executionPeriodMonths": row.execution_period_months,
        "executionEndDate": row.execution_end_date.isoformat() if row.execution_end_date else None,
        "nextFollowAt": row.next_follow_at.isoformat() if row.next_follow_at else None,
        "createdByName": row.created_by_name, "createdAt": row.created_at.isoformat(), "updatedAt": row.updated_at.isoformat(),
    }


def _validate_partner(body: PartnerBody) -> None:
    if body.partner_type not in {"channel", "strategic_ecosystem"}:
        raise HTTPException(status_code=400, detail="合作伙伴类型无效")
    if body.partner_type == "channel" and not body.name.strip():
        raise HTTPException(status_code=400, detail="主体名称不能为空")
    if body.partner_type == "strategic_ecosystem" and not (body.brand_name or "").strip():
        raise HTTPException(status_code=400, detail="战略生态客户必须填写品牌")
    if body.execution_status and body.execution_status not in {"执行中", "执行完成"}:
        raise HTTPException(status_code=400, detail="执行状态仅支持执行中、执行完成")
    if body.channel_type and body.channel_type not in CHANNEL_TYPES:
        raise HTTPException(status_code=400, detail="渠道类型无效")
    if body.source and body.source not in LEAD_SOURCES and not _is_ecosystem_source(body):
        raise HTTPException(status_code=400, detail="渠道来源必须使用现有线索来源选项")
    if body.level and body.level not in CHANNEL_LEVELS:
        raise HTTPException(status_code=400, detail="渠道级别无效")
    if body.region and body.region not in CHANNEL_REGIONS:
        raise HTTPException(status_code=400, detail="区域无效")
    if body.partner_type == "channel" and body.city and body.region and body.city not in CHANNEL_REGIONS[body.region]:
        raise HTTPException(status_code=400, detail="城市与所属区域不匹配")
    valid_industries = {"消费零售"} | set(INDUSTRIES) | {item for values in INDUSTRIES.values() for item in values}
    if set(body.industries) - valid_industries:
        raise HTTPException(status_code=400, detail="意向行业选项无效")
    if set(body.agency_types) - set(CHANNEL_AGENCY_TYPES):
        raise HTTPException(status_code=400, detail="代理类型仅支持服务、产品")


async def _validate_source(db: AsyncSession, body: PartnerBody) -> None:
    detail = (body.source_detail or "").strip()
    if _is_ecosystem_source(body):
        if len(detail) > 255 or (not detail and body.source in ECOSYSTEM_SECONDARY_REQUIRED | {"战略生态"}):
            raise HTTPException(status_code=400, detail="请填写有效的项目来源（二级）")
        if len(body.industries) != 1 or not body.bd_user_ids or not (body.ecosystem_department or "").strip():
            raise HTTPException(status_code=400, detail="请选择一个行业、至少一位 BD 负责人，并填写对接部门")
        return
    if body.source in MEETING_PRIMARY_SOURCES or body.source == "机构引荐":
        from app.modules.crm.service import CrmService

        await CrmService(db)._validate_lead_source_option({"source": body.source, "sourceDetail": detail})
    elif body.source == "内容营销" and detail and detail not in LEAD_SOURCE_CONTENT_CHANNELS:
        raise HTTPException(status_code=400, detail="来源二级选项无效")
    elif body.source == "官网注册" and detail and detail not in LEAD_SOURCE_WEBSITE_ENTRIES:
        raise HTTPException(status_code=400, detail="来源二级选项无效")
    elif body.source == "其他来源" and not detail:
        raise HTTPException(status_code=400, detail="请填写具体来源")


async def _apply_ecosystem_fields(db, row, body):
    for key in ("customer_type", "customer_subtype", "budget_amount", "project_status", "expected_sign_month", "demand_description", "project_notes", "execution_status", "execution_product", "execution_intent_count", "execution_platform_count", "execution_period_months", "execution_end_date"):
        if body.partner_type != "strategic_ecosystem" or key in body.model_fields_set:
            setattr(row, key, getattr(body, key))
    if body.partner_type != "strategic_ecosystem" or "service_contents" in body.model_fields_set:
        row.service_contents_json = json.dumps(list(dict.fromkeys(body.service_contents)), ensure_ascii=False)
    ids = list(dict.fromkeys(body.bd_user_ids))
    names = []
    for uid in ids:
        member = await db.get(User, uid)
        if not member or member.employment_status != "active":
            raise HTTPException(status_code=400, detail="BD 必须选择在职通讯录成员")
        names.append(member.name)
    if body.partner_type != "strategic_ecosystem" or "bd_user_ids" in body.model_fields_set:
        row.bd_user_ids_json = json.dumps(ids, ensure_ascii=False)
        row.bd_names_json = json.dumps(names, ensure_ascii=False)
    if body.primary_opportunity_id:
        opp = await db.get(CrmOpportunity, body.primary_opportunity_id)
        if not opp or opp.partner_id != row.id:
            raise HTTPException(status_code=400, detail="主要商机必须属于当前合作伙伴")
    if body.partner_type != "strategic_ecosystem" or "primary_opportunity_id" in body.model_fields_set:
        row.primary_opportunity_id = body.primary_opportunity_id


@router.get("")
async def list_channels(partner_type: str = Query(default="channel", alias="partnerType"), db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    if partner_type not in {"channel", "strategic_ecosystem"}:
        raise HTTPException(status_code=400, detail="合作伙伴类型无效")
    managed_ids = await _managed_ids(db, user)
    rows = (await db.execute(select(ChannelPartner).where(ChannelPartner.partner_type == partner_type).order_by(ChannelPartner.updated_at.desc()))).scalars().all()
    visible_rows = [row for row in rows if _visible(user, row, managed_ids)]
    primary_contacts = {}
    if visible_rows:
        contacts = (await db.execute(select(ChannelContact).where(ChannelContact.partner_id.in_([row.id for row in visible_rows])).order_by(ChannelContact.is_primary.desc(), ChannelContact.created_at))).scalars().all()
        for contact in contacts:
            primary_contacts.setdefault(contact.partner_id, contact.name)
    result = []
    for row in visible_rows:
        status = await _contract_status(db, row.id)
        item = _partner_dict(row, status)
        item["primaryContactName"] = primary_contacts.get(row.id)
        result.append(item)
    return result


@router.post("")
async def create_channel(body: PartnerBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:create")
    _validate_partner(body)
    await _validate_source(db, body)
    now = china_now()
    owner_id = body.owner_user_id or user.id
    if owner_id != user.id and user.role not in {"admin", "super_admin", "ops", "leader", "sales_leader"}:
        raise HTTPException(status_code=403, detail="仅渠道管理员可指定其他负责人")
    owner_user = await db.get(User, owner_id)
    if not owner_user or owner_user.employment_status != "active":
        raise HTTPException(status_code=400, detail="渠道负责人不在当前通讯录中")
    owner_name = owner_user.name if owner_id != user.id else user.name
    owner_departments = list(owner_user.department_names or []) if owner_id != user.id else list(user.department_names or [])
    if owner_id != user.id and user.role in {"leader", "sales_leader"} and owner_id not in await _managed_ids(db, user):
        raise HTTPException(status_code=403, detail="Leader 只能在本人管辖范围内分配渠道负责人")
    row = ChannelPartner(
        id=str(uuid4()), name=body.name.strip(), partner_type=body.partner_type, brand_name=(body.brand_name or "").strip() or None,
        channel_type=body.channel_type, source=body.source,
        source_detail=body.source_detail, ecosystem_department=body.ecosystem_department, level=body.level, owner_user_id=owner_id,
        owner_name=owner_name, owner_department=owner_departments[0] if owner_departments else None,
        region=body.region, city=body.city, website=body.website, industries_json=json.dumps(body.industries, ensure_ascii=False),
        major_customers=body.major_customers, team_support=body.team_support,
        agency_types_json=json.dumps(body.agency_types, ensure_ascii=False), cooperation_project=body.cooperation_project,
        created_by_user_id=user.id, created_by_name=user.name, created_at=now, updated_at=now,
    )
    await _apply_ecosystem_fields(db, row, body)
    db.add(row)
    if _is_ecosystem_source(body):
        if not body.ecosystem_contacts or any(not item.name.strip() for item in body.ecosystem_contacts):
            raise HTTPException(status_code=400, detail="请填写至少一位战略生态对接人")
        await db.flush()
        for index, item in enumerate(body.ecosystem_contacts):
            db.add(ChannelContact(id=str(uuid4()), partner_id=row.id, name=item.name.strip(),
                department=body.ecosystem_department, contact_type="strategic_ecosystem",
                phone=(item.phone or "").strip() or None, method=(item.email or "").strip() or None,
                is_primary=index == 0, created_at=now, updated_at=now))
    await _history(db, row, user, "create", row.name or row.brand_name)
    await db.commit()
    return _partner_dict(row)


@router.get("/opportunities")
async def list_all_channel_opportunities(partner_type: str = Query(default="channel", alias="partnerType"), db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    docs = await CrmService(db).list_opportunities(user)
    return [partner_opportunity_view(doc) for doc in docs if doc.get("businessType") == partner_type]



def _require_contracts(user):
    _require(user)
    if "section:contracts" not in set(user.permissions or []):
        raise HTTPException(status_code=403, detail="无权访问合同管理")


@router.get("/contracts")
async def list_all_channel_contracts(partner_type: str = Query(default="channel", alias="partnerType"), db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require_contracts(user)
    managed_ids = await _managed_ids(db, user)
    rows = (await db.execute(select(ChannelContract, ChannelPartner).join(ChannelPartner, ChannelPartner.id == ChannelContract.partner_id).where(ChannelPartner.partner_type == partner_type).order_by(ChannelContract.updated_at.desc()))).all()
    return [contract_dict(contract, partner) for contract, partner in rows if _visible(user, partner, managed_ids)]


async def _contract(db, user, contract_id):
    _require_contracts(user)
    row = await db.get(ChannelContract, contract_id)
    if row is None:
        raise HTTPException(status_code=404, detail="渠道合同不存在")
    partner = await _partner(db, user, row.partner_id)
    return row, partner


@router.get("/contracts/{contract_id}")
async def get_channel_contract(contract_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    row, partner = await _contract(db, user, contract_id)
    opp = await db.get(CrmOpportunity, row.opportunity_id) if row.opportunity_id else None
    return contract_dict(row, partner, opp.name if opp and opp.partner_id == partner.id else None)


@router.patch("/contracts/{contract_id}")
async def update_channel_contract(contract_id: str, body: ContractBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:write")
    row, partner = await _contract(db, user, contract_id)
    if body.status not in {"准备签约", "走入库流程了"} and not (row.status == "是" and body.status == "是"):
        raise HTTPException(status_code=400, detail="请通过确认签约操作更新已签约状态")
    if row.status == "是" and (body.status != "是" or body.opportunity_id != row.opportunity_id):
        raise HTTPException(status_code=400, detail="已签约合同不能回退状态或更换关联商机")
    if body.opportunity_id:
        opp = await db.get(CrmOpportunity, body.opportunity_id)
        if opp is None or opp.partner_id != partner.id:
            raise HTTPException(status_code=400, detail="关联商机不属于该渠道商")
    apply_contract_fields(row, body, partner, user)
    row.opportunity_id = body.opportunity_id
    row.status = body.status
    row.updated_at = china_now()
    await _history(db, partner, user, "contract_updated", row.name)
    await db.commit()
    return await get_channel_contract(contract_id, db, user)


@router.post("/contracts/{contract_id}/attachments")
async def attach_channel_contract_files(contract_id: str, body: ContractAttachmentsBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:write")
    row, partner = await _contract(db, user, contract_id)
    records = build_attachment_records([item.id for item in body.attachments])
    descriptions = {item.id: item.description.strip() for item in body.attachments}
    for item in records:
        if item.get("uploadedBy") != user.id or not item.get("name"):
            raise HTTPException(status_code=403, detail="仅可关联本人上传的合同文件")
        item["description"] = descriptions[item["id"]]
        item["uploadedBy"] = user.name
    existing = contract_attachments(row)
    known = {item["id"] for item in existing}
    row.attachments_json = json.dumps(existing + [item for item in records if item["id"] not in known], ensure_ascii=False)
    row.updated_at = china_now()
    await _history(db, partner, user, "contract_attachment", f"{row.name}：上传 {len(records)} 份合同扫描件")
    await db.commit()
    return contract_dict(row, partner)


@router.get("/contracts/{contract_id}/attachments/{attachment_id}")
async def get_channel_contract_file(contract_id: str, attachment_id: str, download: bool = False, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    row, _ = await _contract(db, user, contract_id)
    if not any(item["id"] == attachment_id for item in contract_attachments(row)):
        raise HTTPException(status_code=404, detail="合同附件不存在")
    try:
        stored = load_attachment(attachment_id)
    except AppError as error:
        raise HTTPException(status_code=404, detail="合同附件不存在") from error
    return FileResponse(path=stored.path, media_type=stored.content_type, filename=stored.original_name,
                        content_disposition_type="attachment" if download else "inline")


@router.get("/{partner_id}")
async def get_channel(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    row = await _partner(db, user, partner_id)
    return _partner_dict(row, await _contract_status(db, row.id))


@router.patch("/{partner_id}")
async def update_channel(partner_id: str, body: PartnerBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:write")
    row = await _partner(db, user, partner_id)
    _validate_partner(body)
    if body.partner_type != row.partner_type:
        raise HTTPException(status_code=400, detail="合作伙伴类型不能通过编辑更换")
    await _validate_source(db, body)
    await _apply_ecosystem_fields(db, row, body)
    for key, value in body.model_dump(exclude_unset=row.partner_type == "strategic_ecosystem").items():
        if key in {"service_contents", "bd_user_ids", "ecosystem_contacts"}:
            continue
        if key in {"industries", "agency_types"}:
            setattr(row, f"{key}_json", json.dumps(value, ensure_ascii=False))
        elif key in {"owner_user_id", "owner_name"}:
            # 负责人不能由常规档案更新接口改写，避免伪造负责人/数据范围。
            continue
        else:
            setattr(row, key, value)
    row.updated_at = china_now()
    await _history(db, row, user, "update", "更新基本信息")
    await db.commit()
    return _partner_dict(row)


@router.get("/{partner_id}/contacts")
async def list_contacts(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    await _partner(db, user, partner_id)
    rows = (await db.execute(select(ChannelContact).where(ChannelContact.partner_id == partner_id).order_by(ChannelContact.is_primary.desc(), ChannelContact.name))).scalars().all()
    return [{"id": r.id, "name": r.name, "phone": r.phone, "title": r.title, "department": r.department, "contactType": r.contact_type, "method": r.method, "isPrimary": r.is_primary} for r in rows]


@router.post("/{partner_id}/contacts")
async def create_contact(partner_id: str, body: ContactBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:write")
    partner = await _partner(db, user, partner_id)
    now = china_now()
    if body.is_primary:
        for previous in (await db.execute(select(ChannelContact).where(ChannelContact.partner_id == partner_id))).scalars():
            previous.is_primary = False
    row = ChannelContact(id=str(uuid4()), partner_id=partner_id, name=body.name.strip(), title=body.title, department=body.department, contact_type=body.contact_type, phone=body.phone, method=body.method, is_primary=body.is_primary, created_at=now, updated_at=now)
    db.add(row)
    await _history(db, partner, user, "contact_added", row.name)
    await db.commit()
    return {"id": row.id, "name": row.name, "title": row.title, "department": row.department, "contactType": row.contact_type, "phone": row.phone, "method": row.method, "isPrimary": row.is_primary}


@router.get("/{partner_id}/follow-ups")
async def list_followups(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    await _partner(db, user, partner_id)
    rows = (await db.execute(select(ChannelFollowUp).where(ChannelFollowUp.partner_id == partner_id).order_by(ChannelFollowUp.created_at.desc()))).scalars().all()
    return [{"id": r.id, "contactId": r.contact_id, "contactName": r.contact_name, "followType": r.follow_type, "mentions": _json_list(r.mentions_json), "authorName": r.author_name, "content": r.content, "nextFollowAt": r.next_follow_at.isoformat() if r.next_follow_at else None, "createdAt": r.created_at.isoformat()} for r in rows]


@router.post("/{partner_id}/follow-ups")
async def create_followup(partner_id: str, body: FollowUpBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user, "channels:write")
    partner = await _partner(db, user, partner_id)
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="请填写跟进内容")
    if body.follow_type not in {item["value"] for item in FOLLOW_TYPE_OPTIONS}:
        raise HTTPException(status_code=400, detail="请选择有效的跟进方式")
    if not body.contact_id:
        raise HTTPException(status_code=400, detail="请选择联系人")
    if body.next_follow_at and body.next_follow_at < china_now().date():
        raise HTTPException(status_code=400, detail="下次跟进不能早于今天")
    if body.contact_id:
        contact = await db.get(ChannelContact, body.contact_id)
        if not contact or contact.partner_id != partner_id:
            raise HTTPException(status_code=404, detail="联系人不存在")
    now = china_now()
    row = ChannelFollowUp(id=str(uuid4()), partner_id=partner_id, contact_id=body.contact_id, author_user_id=user.id, author_name=user.name, content=body.content.strip(), follow_type=body.follow_type, contact_name=contact.name, mentions_json=json.dumps(list(dict.fromkeys(body.mentions)), ensure_ascii=False), next_follow_at=body.next_follow_at, created_at=now)
    db.add(row)
    partner.next_follow_at = body.next_follow_at
    partner.updated_at = now
    await _history(db, partner, user, "follow_up_added", row.content[:300])
    await db.commit()
    return {"id": row.id, "content": row.content, "authorName": row.author_name, "createdAt": row.created_at.isoformat()}


@router.get("/{partner_id}/opportunities")
async def list_opportunities(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    await _partner(db, user, partner_id)
    docs = await CrmService(db).list_opportunities(user)
    return [partner_opportunity_view(doc) for doc in docs if doc.get("partnerId") == partner_id]


@router.post("/{partner_id}/opportunities")
async def create_opportunity(partner_id: str, body: OpportunityBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    partner = await _partner(db, user, partner_id)
    document = {"name": body.name.strip(), "partnerId": partner.id, "businessType": partner.partner_type, "stage": "contact"}
    return partner_opportunity_view(await CrmService(db).create_opportunity(user, document))


@router.patch("/{partner_id}/opportunities/{opportunity_id}/stage")
async def move_opportunity(partner_id: str, opportunity_id: str, body: StageBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    await _partner(db, user, partner_id)
    service = CrmService(db)
    document = await service.get_opportunity(user, opportunity_id)
    if document.get("partnerId") != partner_id:
        raise HTTPException(status_code=404, detail="商机不存在")
    return partner_opportunity_view(await service.update_opportunity(user, opportunity_id, {"stage": LEGACY_STAGES.get(body.stage, body.stage), "lostReason": body.lost_reason}))



@router.get("/{partner_id}/contracts")
async def list_contracts(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require_contracts(user)
    partner = await _partner(db, user, partner_id)
    rows = (await db.execute(select(ChannelContract).where(ChannelContract.partner_id == partner_id).order_by(ChannelContract.updated_at.desc()))).scalars().all()
    return [contract_dict(r, partner) for r in rows]


@router.post("/{partner_id}/contracts")
async def create_contract(partner_id: str, body: ContractBody, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require_contracts(user)
    _require(user, "channels:create")
    partner = await _partner(db, user, partner_id)
    if body.status not in CHANNEL_CONTRACT_STATUSES or body.status in {"是", "否"}:
        raise HTTPException(status_code=400, detail="新建合同状态仅支持准备签约或走入库流程了")
    if body.opportunity_id:
        opp = await db.get(CrmOpportunity, body.opportunity_id)
        if opp is None or opp.partner_id != partner_id:
            raise HTTPException(status_code=400, detail="关联商机不属于该渠道商")
        if opp.stage == "lost":
            raise HTTPException(status_code=400, detail="输单商机不能转为合同")
    now = china_now()
    row = ChannelContract(id=str(uuid4()), partner_id=partner_id, opportunity_id=body.opportunity_id, name=body.name.strip(), status=body.status, contract_number=body.contract_number, created_at=now, updated_at=now)
    apply_contract_fields(row, body, partner, user, creating=True)
    db.add(row)
    await _history(db, partner, user, "contract_created", row.name)
    await db.commit()
    return contract_dict(row, partner)


@router.patch("/{partner_id}/contracts/{contract_id}/sign")
async def sign_contract(partner_id: str, contract_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require_contracts(user)
    _require(user, "channels:write")
    partner = await _partner(db, user, partner_id)
    row = await db.get(ChannelContract, contract_id)
    if row is None or row.partner_id != partner_id:
        raise HTTPException(status_code=404, detail="渠道合同不存在")
    if row.status == "是":
        return {"id": row.id, "status": row.status, "signedAt": row.signed_at.isoformat() if row.signed_at else None, "projectCreated": False}
    now = china_now()
    row.status = "是"
    row.signed_at = now
    if not getattr(row, "double_signed_date", None):
        row.double_signed_date = now.date()
    row.updated_at = now
    if row.opportunity_id:
        service = CrmService(db)
        opp = await service.repo.get_opportunity_for_update(row.opportunity_id)
        if opp and opp.partner_id == partner_id and opp.stage != "won":
            if opp.stage == "lost":
                raise HTTPException(status_code=400, detail="输单商机不能确认签约")
            document = await service._compose_opportunity(opp)
            document["stage"] = "won"
            document["stageHistory"].append({"stage": "won", "enteredAt": now.isoformat(), "reason": "合同确认签约"})
            await service.repo.save_opportunity(opp, document)
            await db.flush()
    opportunity_label = "战略生态商机" if partner.partner_type == "strategic_ecosystem" else "渠道商机"
    await _history(db, partner, user, "contract_signed", f"{row.name}；关联{opportunity_label}推进赢单；未创建交付项目")
    await CrmService(db)._commit_and_invalidate_crm(user.id)
    return {"id": row.id, "status": row.status, "signedAt": row.signed_at.isoformat(), "projectCreated": False}


@router.get("/{partner_id}/history")
async def list_history(partner_id: str, db: AsyncSession = Depends(get_db_session), user: AuthUser = Depends(require_user)):
    _require(user)
    await _partner(db, user, partner_id)
    rows = (await db.execute(select(ChannelHistory).where(ChannelHistory.partner_id == partner_id).order_by(ChannelHistory.created_at.desc()))).scalars().all()
    return [{"id": r.id, "actorName": r.actor_name, "action": r.action, "detail": r.detail, "createdAt": r.created_at.isoformat()} for r in rows]
