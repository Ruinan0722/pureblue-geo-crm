"""联系人/跟进独立表：crm_contacts / crm_follow_ups（从对接池 document 回填）。

Revision ID: 033_crm_contacts_follow_ups
Revises: 032_rbac_timestamps
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "033_crm_contacts_follow_ups"
down_revision: Union[str, None] = "032_rbac_timestamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _jbool(value) -> bool:
    return value is True or str(value).strip().lower() in ("true", "1")


def _parse_date(value) -> datetime | None:
    """宽松解析 '2026-08-01 09:00' / '2026-8-6 1:30' / '2026-08-01'。"""
    if value is None:
        return None
    text = str(value).strip()
    match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if not match:
        return None
    year, month, day = (int(x) for x in match.groups())
    try:
        return datetime(year, month, day).replace(microsecond=0)
    except ValueError:
        return None


def upgrade() -> None:
    op.create_table(
        "crm_contacts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("coverage_id", sa.String(36), nullable=False, index=True),
        sa.Column("customer_id", sa.String(36), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False, default=""),
        sa.Column("title", sa.String(128), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("wechat", sa.String(128), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="awaiting_contact",
            index=True,
        ),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("wechat_added", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("source", sa.String(128), nullable=True),
        sa.Column("source_detail", sa.String(255), nullable=True),
        sa.Column("source_lead_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_contacts_coverage", "crm_contacts", ["coverage_id"])
    op.create_index("idx_crm_contacts_customer", "crm_contacts", ["customer_id"])
    op.create_index("idx_crm_contacts_status", "crm_contacts", ["status"])

    op.create_table(
        "crm_follow_ups",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("coverage_id", sa.String(36), nullable=False, index=True),
        sa.Column("customer_id", sa.String(36), nullable=False, index=True),
        sa.Column("author", sa.String(128), nullable=False, default=""),
        sa.Column("content", sa.Text(), nullable=False, default=""),
        sa.Column("follow_type", sa.String(32), nullable=True),
        sa.Column("wechat_added", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("mentions", sa.JSON(), nullable=True),
        sa.Column("next_follow_at", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_follow_ups_coverage", "crm_follow_ups", ["coverage_id"])
    op.create_index("idx_crm_follow_ups_customer", "crm_follow_ups", ["customer_id"])

    # —— 从对接池 document 回填（Python 逐行，逻辑与仓库 sync 一致）——
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, customer_id, document FROM crm_sales_coverages")).fetchall()
    now = datetime.now().replace(microsecond=0)
    contact_sql = sa.text(
        """
        INSERT INTO crm_contacts
          (id, coverage_id, customer_id, name, title, phone, wechat, email, status,
           is_primary, active, wechat_added, source, source_detail, source_lead_id,
           created_at, updated_at)
        VALUES
          (:id, :coverage_id, :customer_id, :name, :title, :phone, :wechat, :email, :status,
           :is_primary, :active, :wechat_added, :source, :source_detail, :source_lead_id,
           :created_at, :updated_at)
        """
    )
    follow_sql = sa.text(
        """
        INSERT INTO crm_follow_ups
          (id, coverage_id, customer_id, author, content, follow_type, wechat_added,
           mentions, next_follow_at, created_at, updated_at)
        VALUES
          (:id, :coverage_id, :customer_id, :author, :content, :follow_type, :wechat_added,
           :mentions, :next_follow_at, :created_at, :updated_at)
        """
    )
    for coverage_id, customer_id, doc_raw in rows:
        doc = doc_raw
        if isinstance(doc_raw, (str, bytes)):
            try:
                doc = json.loads(doc_raw)
            except Exception:
                doc = {}
        doc = doc if isinstance(doc, dict) else {}
        for idx, contact in enumerate(doc.get("contacts") or []):
            if not isinstance(contact, dict):
                continue
            bind.execute(
                contact_sql,
                {
                    "id": f"{coverage_id}-ct-{idx}",
                    "coverage_id": coverage_id,
                    "customer_id": customer_id,
                    "name": _jstr(contact.get("name")) or "",
                    "title": _jstr(contact.get("title")),
                    "phone": _jstr(contact.get("phone")),
                    "wechat": _jstr(contact.get("wechat")),
                    "email": _jstr(contact.get("email")),
                    "status": _jstr(contact.get("status")) or "awaiting_contact",
                    "is_primary": _jbool(contact.get("isPrimary")),
                    "active": False if contact.get("active") is False else True,
                    "wechat_added": _jbool(contact.get("wechatAdded")),
                    "source": _jstr(contact.get("source")),
                    "source_detail": _jstr(contact.get("sourceDetail")),
                    "source_lead_id": _jstr(contact.get("sourceLeadId")),
                    "created_at": now,
                    "updated_at": now,
                },
            )
        for idx, note in enumerate(doc.get("notes") or []):
            if not isinstance(note, dict):
                continue
            created_at = _parse_date(note.get("date")) or now
            next_follow = _parse_date(note.get("nextFollowAt"))
            bind.execute(
                follow_sql,
                {
                    "id": f"{coverage_id}-fu-{idx}",
                    "coverage_id": coverage_id,
                    "customer_id": customer_id,
                    "author": _jstr(note.get("author")) or "",
                    "content": _jstr(note.get("content")) or "",
                    "follow_type": _jstr(note.get("followType")),
                    "wechat_added": _jbool(note.get("wechatAdded")),
                    "mentions": json.dumps(note.get("mentions") or [], ensure_ascii=False),
                    "next_follow_at": next_follow.date() if next_follow else None,
                    "created_at": created_at,
                    "updated_at": now,
                },
            )


def downgrade() -> None:
    op.drop_index("idx_crm_follow_ups_customer", table_name="crm_follow_ups")
    op.drop_index("idx_crm_follow_ups_coverage", table_name="crm_follow_ups")
    op.drop_table("crm_follow_ups")
    op.drop_index("idx_crm_contacts_status", table_name="crm_contacts")
    op.drop_index("idx_crm_contacts_customer", table_name="crm_contacts")
    op.drop_index("idx_crm_contacts_coverage", table_name="crm_contacts")
    op.drop_table("crm_contacts")
