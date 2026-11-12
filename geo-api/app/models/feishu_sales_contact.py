from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FeishuSalesContact(Base):
    """销售部通讯录快照（定时从飞书同步）。"""

    __tablename__ = "feishu_sales_contacts"

    feishu_open_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    job_title: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    department_ids: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    department_names: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
