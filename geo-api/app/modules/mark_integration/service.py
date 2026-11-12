from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.time_utils import CHINA_TZ, china_now
from app.modules.crm.repository import CrmRepository
from app.modules.crm.service.helpers_common import _doc
from app.modules.mark_integration.models import (
    MarkIntegrationEvent,
    MarkIntegrationFile,
    MarkIntegrationRecord,
)
from app.modules.mark_integration.repository import MarkIntegrationRepository
from app.modules.mark_integration.schemas import (
    MarkMaterialEvent,
    MaterialDeliveryResult,
    PlatformCode,
    UnifiedLeadEvent,
    UnifiedLeadResult,
)
from app.modules.mark_integration.storage import _validate_public_https_url

SOURCE_MAP: dict[str, tuple[str, str]] = {
    "website": ("官网注册", "官网首页"),
    "36kr": ("官网注册", "36氪"),
    "mark": ("官网注册", "Mark"),
}


def _payload_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds") + "+08:00"


def _china_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(CHINA_TZ).replace(tzinfo=None)


class MarkIntegrationService:
    """历史模块名保留以兼容部署；实际承载三平台统一线索入站。"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = MarkIntegrationRepository(db)
        self.crm_repo = CrmRepository(db)
        self.settings = get_settings()

    @staticmethod
    def _validate(platform: PlatformCode, body: UnifiedLeadEvent) -> None:
        if platform == "mark" and not str(body.data.email or "").strip():
            raise ValidationError("缺少必填字段：联系邮箱")

    @staticmethod
    def _lead_document(
        platform: PlatformCode,
        body: UnifiedLeadEvent,
        *,
        now: datetime,
        previous: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        incoming = body.data.model_dump(mode="json", by_alias=True, exclude_none=True)
        merged = dict(previous or {})
        source, default_detail = SOURCE_MAP[platform]
        operator = body.operator.model_dump(by_alias=True, exclude_none=True) if body.operator else None
        old_meta = merged.get("importMeta") if isinstance(merged.get("importMeta"), dict) else {}
        landing_page = incoming.pop("landingPage", old_meta.get("landingpageRaw"))
        utm_source = incoming.pop("utmSource", old_meta.get("utmSource"))
        utm_medium = incoming.pop("utmMedium", old_meta.get("utmMedium"))
        utm_campaign = incoming.pop("utmCampaign", old_meta.get("utmCampaign"))
        merged.update(incoming)
        # UnifiedLeadEvent 不带集合时保留 previous；仅上游显式传 notes/attachments 才覆盖
        if previous is not None:
            if "notes" not in incoming:
                merged["notes"] = list(previous.get("notes") or [])
            if "attachments" not in incoming:
                merged["attachments"] = list(previous.get("attachments") or [])
        merged.update(
            {
                "companyName": str(merged.get("companyName") or "").strip(),
                "brandName": str(merged.get("brandName") or "").strip(),
                "contactName": str(merged.get("contactName") or "").strip(),
                "contactPhone": str(merged.get("contactPhone") or "").strip(),
                "email": str(merged.get("email") or "").strip(),
                "contactTitle": str(merged.get("contactTitle") or "").strip(),
                "source": source,
                # 平台固定二级来源（Mark→Mark、36氪→36氪、官网→官网首页），不接受上游覆盖
                "sourceDetail": default_detail,
                "status": str(merged.get("status") or "untouched"),
                "followState": str(merged.get("followState") or "need"),
                "sales": str(merged.get("sales") or "未分配"),
                "createdAt": str(merged.get("createdAt") or now.date().isoformat()),
                "notes": list(merged.get("notes") or []),
                "attachments": list(merged.get("attachments") or []),
                "importMeta": {
                    **old_meta,
                    "source": "integration",
                    "platform": platform,
                    "externalRecordId": body.external_record_id,
                    "lastEventId": body.event_id,
                    "occurredAt": body.occurred_at.isoformat(),
                    "importedAt": _iso(now),
                    "landingpageRaw": landing_page,
                    "utmSource": utm_source,
                    "utmMedium": utm_medium,
                    "utmCampaign": utm_campaign,
                    **({"operator": operator} if operator else {}),
                },
            }
        )
        return merged

    async def receive_lead(
        self, platform: PlatformCode, body: UnifiedLeadEvent
    ) -> UnifiedLeadResult:
        self._validate(platform, body)
        payload_hash = _payload_hash(
            {"platform": platform, **body.model_dump(mode="json", by_alias=True, exclude_none=True)}
        )
        prior_event = await self.repo.get_event(platform, body.event_id)
        if prior_event:
            if prior_event.payload_hash != payload_hash:
                raise ConflictError("相同 eventId 对应的请求内容不一致")
            if not prior_event.response_json:
                raise ConflictError("该事件正在处理中，请稍后重试")
            saved = UnifiedLeadResult.model_validate(prior_event.response_json)
            return saved.model_copy(update={"created": False, "duplicate": True})

        now = china_now()
        link = await self.repo.get_record(platform, body.external_record_id)
        lead = await self.repo.get_lead(link.crm_lead_id) if link else None
        if link and not lead:
            raise NotFoundError("外部记录关联的 CRM 线索不存在")
        created = lead is None
        previous = None
        if lead:
            children = await self.crm_repo.get_lead_children(lead.id)
            previous = {
                **_doc(lead),
                "notes": list(children.get("notes") or []),
                "attachments": list(children.get("attachments") or []),
                "importMeta": children.get("importMeta"),
            }
        document = self._lead_document(platform, body, now=now, previous=previous)
        if lead:
            lead = await self.crm_repo.save_lead(lead, document)
            link.last_event_id = body.event_id
            link.updated_at = now
        else:
            lead = await self.crm_repo.create_lead(document=document, owner_user_id=None)
            link = MarkIntegrationRecord(
                id=str(uuid.uuid4()),
                platform=platform,
                external_record_id=body.external_record_id,
                crm_lead_id=lead.id,
                last_event_id=body.event_id,
                created_at=now,
                updated_at=now,
            )
            self.db.add(link)

        result = UnifiedLeadResult(
            event_id=body.event_id,
            external_record_id=body.external_record_id,
            crm_lead_id=lead.id,
            created=created,
            received_at=_iso(now),
        )
        self.db.add(
            MarkIntegrationEvent(
                id=str(uuid.uuid4()),
                platform=platform,
                event_id=body.event_id,
                event_type=body.event_type,
                external_record_id=body.external_record_id,
                payload_hash=payload_hash,
                process_status="accepted",
                response_json=result.model_dump(mode="json", by_alias=True, exclude_none=True),
                received_at=now,
                processed_at=now,
            )
        )
        await self.db.commit()
        return result

    async def receive_material(
        self, crm_lead_id: str, body: MarkMaterialEvent
    ) -> MaterialDeliveryResult:
        payload_hash = _payload_hash(body.model_dump(mode="json", by_alias=True))
        prior_event = await self.repo.get_event("mark", body.event_id)
        if prior_event:
            if prior_event.payload_hash != payload_hash:
                raise ConflictError("相同 eventId 对应的材料内容不一致")
            if not prior_event.response_json:
                raise ConflictError("该材料事件正在处理中，请稍后重试")
            saved = MaterialDeliveryResult.model_validate(prior_event.response_json)
            return saved.model_copy(update={"duplicate": True})

        link = await self.repo.get_record_by_lead("mark", crm_lead_id)
        if not link or link.external_record_id != body.external_record_id:
            raise NotFoundError("Mark 记录与 CRM 线索不存在或不匹配")
        if not await self.repo.get_lead(crm_lead_id):
            raise NotFoundError("CRM 线索不存在")
        if await self.repo.get_file("mark", body.external_record_id, version=body.material_version):
            raise ConflictError("该 materialVersion 已存在，请复用原 eventId 或提供新版本号")

        now = china_now()
        expires_at = _china_naive(body.url_expires_at) if body.url_expires_at else None
        if expires_at and expires_at <= now:
            raise ValidationError("PDF fileUrl 已过期")
        if body.size and body.size > self.settings.mark_integration_pdf_max_bytes:
            raise ValidationError("PDF 声明大小超过 CRM 限制")
        # 入站时先校验，给 Mark 明确反馈；下载时再次校验以防 DNS rebinding。
        await _validate_public_https_url(str(body.file_url))
        file_id = str(uuid.uuid4())
        self.db.add(MarkIntegrationFile(
            id=file_id, platform="mark", external_record_id=body.external_record_id,
            crm_lead_id=crm_lead_id, external_file_id=body.file_id,
            file_version=body.material_version, original_name=body.file_name,
            content_type="application/pdf", source_url=str(body.file_url),
            url_expires_at=expires_at, expected_size=body.size,
            expected_checksum=body.checksum, size=None, checksum=None, storage_path=None,
            generated_at=_china_naive(body.occurred_at), uploaded_at=None,
            remark=(body.remark or "").strip()[:500] or None,
            download_status="pending_download", failure_reason=None, download_attempts=0,
            next_attempt_at=None,
            is_current=False,
        ))
        result = MaterialDeliveryResult(
            event_id=body.event_id, external_record_id=body.external_record_id,
            crm_lead_id=crm_lead_id, material_version=body.material_version,
            file_id=file_id, pdf_status="pendingDownload", received_at=_iso(now),
        )
        self.db.add(MarkIntegrationEvent(
            id=str(uuid.uuid4()), platform="mark", event_id=body.event_id,
            event_type=body.event_type, external_record_id=body.external_record_id,
            payload_hash=payload_hash, process_status="accepted",
            response_json=result.model_dump(mode="json", by_alias=True),
            received_at=now, processed_at=now,
        ))
        await self.db.commit()
        return result
