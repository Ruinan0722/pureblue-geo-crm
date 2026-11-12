from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time_utils import utc_now
from app.models.base import Base

# active=在职可登录；resigned=已离职（保留账号与历史跟进关系，禁止登录）
EMPLOYMENT_ACTIVE = "active"
EMPLOYMENT_RESIGNED = "resigned"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    feishu_open_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="sales")
    role_source: Mapped[str] = mapped_column(String(16), nullable=False, default="feishu")
    role_locked: Mapped[bool] = mapped_column(nullable=False, default=False)
    data_scope_override: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    department_names: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    department_ids: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    manual_department_open_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    manual_department_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    manual_department_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manual_department_leader: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    feishu_led_department_ids: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    employment_status: Mapped[str] = mapped_column(String(16), nullable=False, default=EMPLOYMENT_ACTIVE, index=True)
    left_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now, onupdate=utc_now
    )

    @property
    def is_resigned(self) -> bool:
        return self.employment_status == EMPLOYMENT_RESIGNED
