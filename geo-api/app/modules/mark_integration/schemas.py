from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import AnyHttpUrl, ConfigDict, Field, field_validator

from app.modules.auth.schemas import CamelModel, to_camel

PlatformCode = Literal["website", "36kr", "mark"]


class IntegrationOperator(CamelModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="forbid")

    id: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=128)


class IntegrationLeadData(CamelModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        extra="forbid",
    )

    company_name: str = Field(min_length=1, max_length=200)
    brand_name: str | None = Field(default=None, max_length=200)
    contact_name: str = Field(min_length=1, max_length=100)
    contact_title: str | None = Field(default=None, max_length=100)
    contact_phone: str = Field(min_length=1, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=500)
    requirements: str | None = Field(default=None, max_length=5000)
    landing_page: str | None = Field(default=None, max_length=500)
    source_detail: str | None = Field(default=None, max_length=128)
    utm_source: str | None = Field(default=None, max_length=255)
    utm_medium: str | None = Field(default=None, max_length=255)
    utm_campaign: str | None = Field(default=None, max_length=255)


class MarkMaterialEvent(CamelModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="forbid")

    event_id: str = Field(min_length=1, max_length=64)
    event_type: Literal["materials.created", "materials.updated"]
    external_record_id: str = Field(min_length=1, max_length=128)
    material_version: str = Field(min_length=1, max_length=32)
    occurred_at: datetime
    operator: IntegrationOperator | None = None
    file_id: str = Field(min_length=1, max_length=128)
    file_name: str = Field(min_length=1, max_length=255)
    file_url: AnyHttpUrl
    content_type: Literal["application/pdf"]
    size: int | None = Field(default=None, gt=0)
    checksum: str | None = Field(default=None, min_length=64, max_length=64)
    url_expires_at: datetime | None = None
    remark: str | None = Field(default=None, max_length=500)

    @field_validator("event_id", "external_record_id", "material_version", "file_id", "file_name")
    @classmethod
    def strip_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("checksum")
    @classmethod
    def normalize_checksum(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if any(char not in "0123456789abcdef" for char in value):
            raise ValueError("checksum 必须是 SHA-256 十六进制值")
        return value

    @field_validator("file_name")
    @classmethod
    def require_pdf_extension(cls, value: str) -> str:
        if not value.lower().endswith(".pdf"):
            raise ValueError("文件名必须以 .pdf 结尾")
        return value


class UnifiedLeadEvent(CamelModel):
    """官网、36氪、Mark 统一新增线索事件。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="forbid")

    # 新协议必填；旧 HMAC 请求可在兼容期由 X-Platform-Code 补齐。
    platform_code: PlatformCode | None = None
    event_id: str = Field(min_length=1, max_length=64)
    event_type: Literal["lead.created"]
    external_record_id: str = Field(min_length=1, max_length=128)
    occurred_at: datetime
    operator: IntegrationOperator | None = None
    data: IntegrationLeadData

    @field_validator("event_id", "external_record_id")
    @classmethod
    def strip_ids(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class UnifiedLeadResult(CamelModel):
    event_id: str
    external_record_id: str
    crm_lead_id: str
    created: bool
    duplicate: bool = False
    received_at: str


class MaterialDeliveryResult(CamelModel):
    event_id: str
    external_record_id: str
    crm_lead_id: str
    material_version: str
    file_id: str
    pdf_status: str
    duplicate: bool = False
    received_at: str


class IntegrationEnvelope(CamelModel):
    code: int = 0
    message: str = "success"
    request_id: str = ""
    data: dict[str, Any]
