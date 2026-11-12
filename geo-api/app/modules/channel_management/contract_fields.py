"""Channel contract register: dates, snapshots and serialization."""
import calendar
import json
from datetime import date

from fastapi import HTTPException
from pydantic import Field

from app.modules.crm.schemas import CamelModel
from app.modules.contracts.status_catalog import CHANNEL_REGIONS


class ContractBody(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    opportunity_id: str | None = None
    status: str = "准备签约"
    contract_number: str | None = Field(default=None, max_length=128)
    channel_subject: str | None = Field(default=None, max_length=255)
    contact_name: str | None = Field(default=None, max_length=128)
    contact_phone: str | None = Field(default=None, max_length=64)
    contact_email: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=64)
    signing_subject: str | None = Field(default=None, max_length=255)
    signer: str | None = Field(default=None, max_length=128)
    project_status: str = "无"
    effective_date: date | None = None
    double_signed_date: date | None = None
    term_months: int | None = Field(default=None, ge=1, le=1200)


class AttachmentItem(CamelModel):
    id: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)


class ContractAttachmentsBody(CamelModel):
    attachments: list[AttachmentItem] = Field(min_length=1, max_length=20)


def end_date_for(start: date | None, months: int | None) -> date | None:
    if not start or not months:
        return None
    total = start.year * 12 + start.month - 1 + months
    year, month_zero = divmod(total, 12)
    if year > 9999:
        raise HTTPException(status_code=400, detail="合同结束日期超出有效范围")
    month = month_zero + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def contract_attachments(row) -> list[dict]:
    try:
        value = json.loads(row.attachments_json or "[]")
        return [item for item in value if isinstance(item, dict) and item.get("id")] if isinstance(value, list) else []
    except (ValueError, TypeError):
        return []


def apply_contract_fields(row, body: ContractBody, partner, user, *, creating=False):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="请填写合同名称")
    if body.project_status not in {"有", "无"}:
        raise HTTPException(status_code=400, detail="项目状态仅支持有或无")
    if body.region and body.region not in CHANNEL_REGIONS:
        raise HTTPException(status_code=400, detail="区域无效")
    row.name = body.name.strip()
    for key in ["contract_number", "channel_subject", "contact_name", "contact_phone", "contact_email",
                "region", "signing_subject", "signer", "project_status", "effective_date", "double_signed_date", "term_months"]:
        value = getattr(body, key)
        setattr(row, key, value.strip() or None if isinstance(value, str) else value)
    if creating:
        row.channel_subject = row.channel_subject or partner.name
        row.region = row.region or partner.region
        row.signer = row.signer or user.name
    row.end_date = end_date_for(row.effective_date, row.term_months)


def contract_dict(row, partner=None, opportunity_name=None):
    def day(value):
        return value.isoformat() if value else None
    files = contract_attachments(row)
    for item in files:
        item["url"] = f"/api/channels/contracts/{row.id}/attachments/{item['id']}"
    return {
        "id": row.id, "partnerId": row.partner_id, "partnerName": partner.name if partner else None,
        "partnerType": partner.partner_type if partner else "channel",
        "ownerUserId": partner.owner_user_id if partner else None, "ownerName": partner.owner_name if partner else None,
        "name": row.name, "status": row.status, "contractNumber": row.contract_number,
        "opportunityId": row.opportunity_id, "opportunityName": opportunity_name,
        "channelSubject": row.channel_subject or (partner.name if partner else None),
        "contactName": row.contact_name, "contactPhone": row.contact_phone, "contactEmail": row.contact_email,
        "region": row.region or (partner.region if partner else None), "signingSubject": row.signing_subject,
        "signer": row.signer, "projectStatus": row.project_status or "无",
        "effectiveDate": day(row.effective_date), "doubleSignedDate": day(row.double_signed_date),
        "termMonths": row.term_months, "endDate": day(row.end_date), "signedAt": day(row.signed_at),
        "createdAt": day(row.created_at), "updatedAt": day(row.updated_at), "attachments": files,
    }
