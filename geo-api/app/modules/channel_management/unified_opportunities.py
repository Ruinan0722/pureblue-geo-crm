"""Partner adapters for the single CRM opportunity service and repository."""
from uuid import uuid4
from sqlalchemy import select
from app.core.exceptions import ValidationError
from app.core.time_utils import china_now
from app.models.channel import ChannelContact, ChannelContract, ChannelHistory, ChannelPartner
from app.modules.channel_management.access import require_partner

PARTNER_TYPES = frozenset({"channel", "strategic_ecosystem"})
LEGACY_STAGES = {"需求确认": "contact", "商务沟通": "business_negotiation", "签署中": "signing", "赢单": "won", "输单": "lost"}

async def stamp_partner_opportunity(db, user, document):
    kind = str(document.get("businessType") or "direct")
    if kind not in {"direct", *PARTNER_TYPES}:
        raise ValidationError("商机来源类型无效")
    if kind == "direct":
        if document.get("partnerId"):
            raise ValidationError("直客商机不能绑定渠道或生态伙伴")
        return {**document, "businessType": "direct", "partnerId": None, "partnerName": None}, user.id
    partner = await require_partner(db, user, str(document.get("partnerId") or ""))
    if partner.partner_type != kind:
        raise ValidationError("商机来源与合作伙伴类型不一致")
    if not partner.owner_user_id:
        raise ValidationError("请先为合作伙伴指定负责人")
    contacts = (await db.execute(select(ChannelContact).where(ChannelContact.partner_id == partner.id).order_by(ChannelContact.is_primary.desc(), ChannelContact.created_at))).scalars().all()
    contact = contacts[0] if contacts else None
    return {
        **document, "customerId": "", "businessType": kind, "partnerId": partner.id,
        "partnerName": partner.name or partner.brand_name, "brandName": partner.brand_name or partner.name,
        "region": partner.region or "", "owner": partner.owner_name or user.name,
        "geoSource": "manual", "primaryContactId": contact.id if contact else "",
    }, partner.owner_user_id

def partner_opportunity_view(document):
    from app.modules.contracts.status_catalog import OPP_STAGE_META
    code = document.get("stage") or "contact"
    return {
        **document, "partnerId": document.get("partnerId"), "partnerName": document.get("partnerName"),
        "partnerType": document.get("businessType"), "ownerName": document.get("owner"),
        "stageCode": code, "stage": OPP_STAGE_META.get(code, {}).get("label", code),
        "updatedAt": document.get("lastFollowAt") or document.get("createdAt") or "",
    }

async def ensure_partner_contract(service, user, opportunity):
    """Called inside the locked CRM opportunity stage transaction; no parallel pipeline."""
    partner = await service.db.get(ChannelPartner, opportunity.get("partnerId"))
    if partner is None:
        raise ValidationError("关联合作伙伴不存在")
    existing = (await service.db.execute(select(ChannelContract).where(ChannelContract.opportunity_id == opportunity["id"]))).scalars().first()
    if existing is not None:
        return
    contact = (await service.db.execute(select(ChannelContact).where(ChannelContact.partner_id == partner.id).order_by(ChannelContact.is_primary.desc(), ChannelContact.created_at))).scalars().first()
    now = china_now()
    label = "战略生态合同" if partner.partner_type == "strategic_ecosystem" else "渠道合同"
    row = ChannelContract(
        id=str(uuid4()), partner_id=partner.id, opportunity_id=opportunity["id"],
        name=f"{opportunity.get('name') or partner.name} {label}", status="准备签约",
        contract_number=await service.repo.next_contract_code(), channel_subject=partner.name or partner.brand_name,
        contact_name=contact.name if contact else None, contact_phone=contact.phone if contact else None,
        contact_email=contact.method if contact and "@" in (contact.method or "") else None,
        region=partner.region, signer=opportunity.get("owner") or user.name,
        project_status="无", created_at=now, updated_at=now,
    )
    service.db.add(row)
    service.db.add(ChannelHistory(id=str(uuid4()), partner_id=partner.id, actor_user_id=user.id, actor_name=user.name, action="contract_auto_created", detail=row.name, created_at=now))

async def record_partner_opportunity_event(service, user, row, document, action):
    partner_id = document.get("partnerId")
    if not partner_id:
        return
    partner = await service.db.get(ChannelPartner, partner_id)
    if partner and not partner.primary_opportunity_id:
        partner.primary_opportunity_id = row.id
    service.db.add(ChannelHistory(id=str(uuid4()), partner_id=partner_id, actor_user_id=user.id, actor_name=user.name, action=action, detail=str(document.get("name") or row.id), created_at=china_now()))
