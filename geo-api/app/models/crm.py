from datetime import date, datetime
from datetime import date as _date
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CrmLead(Base):
    __tablename__ = "crm_leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="untouched")
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    source_detail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    level: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    first_contact_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    follow_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    sdr: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sales: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    transfer_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    created_day: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    contact_title: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    contact_department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    contact_wechat: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    website: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    invalid_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    wechat_added: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    lead_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    industry: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    channel_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    signing_method: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    duplicate_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    converted_partner_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    assigned_sales_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    converted_customer_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    converted_coverage_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_customer_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class LeadNote(Base):
    """线索跟进：document.notes 落表。"""

    __tablename__ = "lead_notes"
    __table_args__ = (
        UniqueConstraint("lead_id", "sort_order", name="uq_lead_notes_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    lead_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    follow_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    wechat_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mentions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_follow_at: Mapped[Optional[_date]] = mapped_column(Date, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CrmLeadImportMeta(Base):
    """线索导入元数据：document.importMeta 落表（1:1）。"""

    __tablename__ = "crm_lead_import_meta"

    lead_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    imported_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    feishu_lead_no: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_by_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    feishu_record_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    landingpage_raw: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    utm_source: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    utm_medium: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    utm_campaign: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    platform: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    external_record_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    operator_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    operator_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    last_event_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)


class LeadSourceOption(Base):
    __tablename__ = "lead_source_options"
    __table_args__ = (
        UniqueConstraint("primary_source", "start_date", "name", name="uq_lead_source_option_meeting"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    primary_source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    organizer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    deleted_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    deletion_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)

    @property
    def display_name(self) -> str:
        if self.start_date is None:
            return self.name
        return f"{self.start_date.strftime('%Y.%m.%d')} {self.name}"


class CrmCustomer(Base):
    __tablename__ = "crm_customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="potential")
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    company_uid: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    credit_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    website: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    industry_l2: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    founded_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    registered_capital: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    annual_revenue: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    scale: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    nature: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    sdr_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    sdr_transfer_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_detail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    migration_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    industry_l1: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    source_lead_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    sdr: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    isolation_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    in_public_pool: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_day: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmCustomerSubsidiary(Base):
    """客户子公司（公司架构）：从主档 document.subsidiaries 独立落表。"""

    __tablename__ = "crm_customer_subsidiaries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    short_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    credit_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmSalesCoverage(Base):
    """销售对接池：同一公司主档下按销售隔离的经营切片。"""

    __tablename__ = "crm_sales_coverages"
    # 与 023 迁移的 uq_crm_sales_coverages_customer_owner 对齐（create_all 建库同样带约束）
    __table_args__ = (
        UniqueConstraint("customer_id", "owner_user_id", name="uq_crm_sales_coverages_customer_owner"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="awaiting_contact")
    owner_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_dept: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_lead_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    sdr_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sdr_transfer_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    isolation_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    next_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    is_key: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmCoverageImportMeta(Base):
    """对接池导入元数据：crm_sales_coverages.document.importMeta 落表（1:1）。"""

    __tablename__ = "crm_coverage_import_meta"

    coverage_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    backfill: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    from_owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    imported_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)


class CrmContact(Base):
    """联系人独立表（032 起）：从对接池 document.contacts 同步，支持索引/统计。"""

    __tablename__ = "crm_contacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    coverage_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    title: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    wechat: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, index=True, default="awaiting_contact"
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    wechat_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_detail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_lead_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmFollowUp(Base):
    """跟进记录独立表（032 起）：从对接池 document.notes 同步。"""

    __tablename__ = "crm_follow_ups"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    coverage_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    follow_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    contact_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    wechat_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mentions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_follow_at: Mapped[Optional[_date]] = mapped_column(Date, nullable=True)
    origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_lead_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_lead_note_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmFollowUpComment(Base):
    """跟进记录下的 Leader 指导与销售回复。"""

    __tablename__ = "crm_follow_up_comments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    follow_up_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    author_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    author_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    author_role: Mapped[str] = mapped_column(String(32), nullable=False, default="sales")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class CrmOpportunity(Base):
    __tablename__ = "crm_opportunities"

    business_type: Mapped[str] = mapped_column(String(32), nullable=False, default="direct", server_default="direct", index=True)
    partner_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    partner_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="contact")
    amount: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    expected_sign_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    next_follow_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    lost_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    geo_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)
    goal: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    platform: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    period: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    probability: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    advisor: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    customer_success: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    subsidiary_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    subsidiary_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    primary_contact_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    lost_stage: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    lost_reason_l1: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    lost_reason_l2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    competitor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    project_manager_request_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_day: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmTeamMember(Base):
    """客户/商机协作成员关系；不再用固定的协作人字段限制人数。"""

    __tablename__ = "crm_team_members"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "user_id", name="uq_crm_team_member_entity_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_name: Mapped[str] = mapped_column(String(128), nullable=False)
    department: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    team_role: Mapped[str] = mapped_column(String(32), nullable=False, default="其他协作")
    permission: Mapped[str] = mapped_column(String(16), nullable=False, default="read")
    added_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    added_by_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmTeamActivity(Base):
    """协作成员增删与权限调整记录。"""

    __tablename__ = "crm_team_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    operator_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    operator_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    member_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    member_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    detail: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class CrmContract(Base):
    __tablename__ = "crm_contracts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="pending")
    amount: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    project_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)
    sign_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    status_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    code: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    company: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    geo_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)
    signer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sign_subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    our_sign_subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    customer_sign_subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    signer_manager: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dept: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    valid_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    dual_sign_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    opportunity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    owner: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    project_manager_request_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_day: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmPaymentPlan(Base):
    """合同回款计划：一个合同对应多期，状态与未收金额由服务端实时计算。"""

    __tablename__ = "crm_payment_plans"
    __table_args__ = (
        UniqueConstraint("contract_id", "period_index", name="uq_payment_plan_contract_period"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    contract_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    period_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    period_name: Mapped[str] = mapped_column(String(64), nullable=False)
    planned_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    planned_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    invoice_status: Mapped[str] = mapped_column(String(32), nullable=False, default="uninvoiced")
    invoice_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    invoice_amount: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    invoice_attachment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actual_payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    actual_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    receipt_attachment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmPublicPoolEntry(Base):
    """公海资源的一次释放周期；审核通过后保留历史，不复用旧周期。"""

    __tablename__ = "crm_public_pool_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    coverage_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    region: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="available", index=True)
    release_reason: Mapped[str] = mapped_column(Text, nullable=False)
    released_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    released_by: Mapped[str] = mapped_column(String(128), nullable=False)
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    claimed_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    claimed_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmPublicPoolClaim(Base):
    """公海客户认领申请；驳回后允许创建新申请，完整保留审核历史。"""

    __tablename__ = "crm_public_pool_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entry_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    applicant_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    applicant_name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_review", index=True)
    review_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewer_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    reviewer_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmAuditRecord(Base):
    """CRM 操作审计：替代前端 localStorage geo-audit-trail-v1。"""

    __tablename__ = "crm_audit_records"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    module: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    timestamp_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class CrmNotification(Base):
    """CRM @提及通知：替代前端内存 notifications。"""

    __tablename__ = "crm_notifications"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    target_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    message: Mapped[str] = mapped_column(String(512), nullable=False)
    href: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    is_read: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class CrmAttachment(Base):
    """统一附件表：lead/customer(经 coverage)/opportunity/contract 的 document.attachments 落表。"""

    __tablename__ = "crm_attachments"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "id", name="uq_crm_attachment_entity_item"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    kind: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    uploaded_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_lead_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_lead_attachment_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source_request_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_request_attachment_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class OpportunityStageHistory(Base):
    """商机阶段历史：document.stageHistory 落表。"""

    __tablename__ = "opportunity_stage_history"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "sort_order", name="uq_opp_stage_history_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    left_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    change_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CrmAuditChangeItem(Base):
    """审计变更项：audit.changes 数组落表。"""

    __tablename__ = "crm_audit_change_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    audit_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    field: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    before_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CrmAuditRelatedEntity(Base):
    """审计关联实体：audit.related_entity_ids 落表。"""

    __tablename__ = "crm_audit_related_entities"
    __table_args__ = (
        UniqueConstraint("audit_id", "entity_id", name="uq_audit_related_entity"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    audit_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)


class OpportunityProjectType(Base):
    """商机项目类型：document.projectTypes 落表。"""

    __tablename__ = "opportunity_project_types"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "project_type", name="uq_opp_project_type"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_type: Mapped[str] = mapped_column(String(64), nullable=False)


class OpportunityRequestLink(Base):
    """商机关联需求：document.requestIds 落表。"""

    __tablename__ = "opportunity_request_ids"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "request_id", name="uq_opp_request_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False)


class OpportunityNote(Base):
    """商机跟进/顾问反馈：document.notes / advisorNotes 落表。"""

    __tablename__ = "opportunity_notes"
    __table_args__ = (
        UniqueConstraint("opportunity_id", "kind", "sort_order", name="uq_opp_notes_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    opportunity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    follow_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    wechat_added: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mentions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_follow_at: Mapped[Optional[_date]] = mapped_column(Date, nullable=True)
    origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source_request_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_request_note_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ContractOwner(Base):
    """合同销售负责人：document.owners / owner 落表。"""

    __tablename__ = "contract_owners"
    __table_args__ = (
        UniqueConstraint("contract_id", "sort_order", name="uq_contract_owners_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    contract_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    owner_name: Mapped[str] = mapped_column(String(128), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
