from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MarkIntegrationRecord(Base):
    __tablename__ = "mark_integration_records"
    __table_args__ = (
        UniqueConstraint("platform", "external_record_id", name="uk_mark_record_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="mark")
    external_record_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    crm_lead_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    last_event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class MarkIntegrationNonce(Base):
    __tablename__ = "mark_integration_nonces"
    __table_args__ = (
        UniqueConstraint("platform", "nonce", name="uk_mark_nonce_platform_nonce"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="mark")
    nonce: Mapped[str] = mapped_column(String(128), nullable=False)
    request_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class MarkIntegrationEvent(Base):
    __tablename__ = "mark_integration_events"
    __table_args__ = (
        UniqueConstraint("platform", "event_id", name="uk_mark_event_platform_event"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="mark")
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    external_record_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    process_status: Mapped[str] = mapped_column(String(32), nullable=False)
    response_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)


class MarkIntegrationFile(Base):
    __tablename__ = "mark_integration_files"
    __table_args__ = (
        UniqueConstraint(
            "platform", "external_record_id", "file_version", name="uk_mark_file_version"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="mark")
    external_record_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    crm_lead_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    external_file_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    file_version: Mapped[str] = mapped_column(String(32), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    url_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    expected_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    expected_checksum: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    remark: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    download_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_download", index=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    download_attempts: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True, index=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)


class MarkReviewCallback(Base):
    __tablename__ = "mark_review_callbacks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    external_record_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    crm_lead_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    attempts: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
