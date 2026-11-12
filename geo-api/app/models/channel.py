from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ChannelPartner(Base):
    """代理商/经销商主体，与直销客户主档保持独立。"""

    __tablename__ = "channel_partners"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    partner_type: Mapped[str] = mapped_column(String(32), nullable=False, default="channel", index=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    channel_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    cooperation_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    signing_method: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    ecosystem_department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_detail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    level: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    owner_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    owner_department: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    region: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    website: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    industries_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    major_customers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    team_support: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    agency_types_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cooperation_project: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    customer_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    customer_subtype: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    service_contents_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    budget_amount: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    bd_user_ids_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bd_names_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_opportunity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    project_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    expected_sign_month: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    demand_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    project_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    execution_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    execution_product: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    execution_intent_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    execution_platform_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    execution_period_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    execution_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    next_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_by_name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class ChannelContact(Base):
    __tablename__ = "channel_contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    method: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    contact_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class ChannelFollowUp(Base):
    __tablename__ = "channel_follow_ups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    contact_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    author_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_name: Mapped[str] = mapped_column(String(128), nullable=False)
    follow_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    mentions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    next_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class ChannelOpportunity(Base):
    __tablename__ = "channel_opportunities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="需求确认", index=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    owner_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    owner_department: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    lost_reason: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class ChannelContract(Base):
    __tablename__ = "channel_contracts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    opportunity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="准备签约", index=True)
    contract_number: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    channel_subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    signing_subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    signer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    project_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    double_signed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    term_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    attachments_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class ChannelHistory(Base):
    __tablename__ = "channel_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    partner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_name: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
