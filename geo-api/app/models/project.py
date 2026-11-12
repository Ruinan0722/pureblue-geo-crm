"""交付项目（项目管理模块）— 签约后客户成功执行实体。"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("source_contract_id", name="uq_projects_source_contract_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, default="")
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    source_contract_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    opportunity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    geo_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)

    stage: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="pending_start")
    health: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="healthy")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, index=True, default="low")

    biz_owner: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    biz_owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    project_manager: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    project_manager_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    executor: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    executor_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    content_ops: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content_ops_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

    contract_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)
    customer_industry: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    customer_type: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    customer_region: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    contact_info: Mapped[str] = mapped_column(Text, nullable=False, default="")
    team_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    office: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    customer_level: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, nullable=False, default="")

    intent_brand: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    intent_content: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    intent_search: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    kpi_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    planned_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    sow_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    original_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    latest_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    actual_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    delay_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    remediation_plan: Mapped[str] = mapped_column(Text, nullable=False, default="")
    delay_customer_note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)


class ProjectSowVersion(Base):
    """不可覆盖的 SOW 版本快照；只有 is_current 状态允许随版本切换。"""

    __tablename__ = "project_sow_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version_no", name="uq_project_sow_version_no"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    sow_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    change_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    confirmer: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    source_change_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class ProjectNote(Base):
    __tablename__ = "project_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="other")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class ProjectWorkItem(Base):
    """项目执行结构化事项：任务、问题、变更、风险、跟进、求助、安抚等共用底表。"""

    __tablename__ = "project_work_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True, default="pending")
    owner: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    solution: Mapped[str] = mapped_column(Text, nullable=False, default="")
    occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    document_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)


class ProjectStringItem(Base):
    """项目字符串列表：project_types / platforms 落子表。"""

    __tablename__ = "project_string_items"
    __table_args__ = (
        UniqueConstraint("project_id", "kind", "sort_order", name="uq_project_string_items_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
