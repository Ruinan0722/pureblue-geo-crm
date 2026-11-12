from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    geo_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    goal: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    owner: Mapped[str] = mapped_column(String(128), nullable=False)
    staff_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    invite_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    opportunity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    scope_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    has_overseas_site: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    overseas_site_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    target_customer: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    optimize_background: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    intent_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    intent_rough: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    optimize_period: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    optimize_period_custom: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    expected_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    strength_market: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strength_tech: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strength_brand: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strength_ecosystem: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    strength_other: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    contact_title: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    budget: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    period: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    competitors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    customer_no: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    feishu_code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    project_stage: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    budget_range: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class RequestNote(Base):
    """需求跟进记录：requests.notes 落表。"""

    __tablename__ = "request_notes"
    __table_args__ = (
        UniqueConstraint("request_id", "sort_order", name="uq_request_notes_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class RequestRegion(Base):
    """需求目标区域：data.regions 落表。"""

    __tablename__ = "request_regions"
    __table_args__ = (
        UniqueConstraint(
            "request_id", "platform", "country", "language",
            name="uq_request_regions_platform_locale",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    platform: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    country: Mapped[str] = mapped_column(String(128), nullable=False)
    language: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)


class RequestGoal(Base):
    """需求优化目标：data.goals 落表。"""

    __tablename__ = "request_goals"
    __table_args__ = (
        UniqueConstraint("request_id", "goal", name="uq_request_goals_goal"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    goal: Mapped[str] = mapped_column(String(64), nullable=False)


class RequestProduct(Base):
    """需求产品或服务：data.products 落表（保留客户端 item id 供意图绑定）。"""

    __tablename__ = "request_products"
    __table_args__ = (
        UniqueConstraint("request_id", "sort_order", name="uq_request_products_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    item_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    fn: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    users: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scenario: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    competitors: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class RequestIntentItem(Base):
    """需求用户意图：data.intentQuestions / intentRoughItems 落表。"""

    __tablename__ = "request_intent_items"
    __table_args__ = (
        UniqueConstraint("request_id", "kind", "sort_order", name="uq_request_intent_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    product_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class RequestListItem(Base):
    """需求字符串列表：data.platforms / brandAliases / brandCompetitors / feishuLinks。"""

    __tablename__ = "request_list_items"
    __table_args__ = (
        UniqueConstraint("request_id", "kind", "sort_order", name="uq_request_list_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class RequestImportMeta(Base):
    """需求导入元数据：data.importMeta 落表（1:1）。"""

    __tablename__ = "request_import_meta"

    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    feishu_record_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    imported_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)


class RequestFeishuLink(Base):
    """需求飞书链接：data.feishuLinks 落表（对象形态 {url, text, field}）。"""

    __tablename__ = "request_feishu_links"
    __table_args__ = (
        UniqueConstraint("request_id", "sort_order", name="uq_request_feishu_links_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    text: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    field: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
