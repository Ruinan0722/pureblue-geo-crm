"""线索跟进/导入元数据子表：lead_notes / crm_lead_import_meta（回填与索引）。

Revision ID: 042_lead_remaining_collections
Revises: 040_fixed_invites
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "042_lead_remaining_collections"
down_revision: Union[str, None] = "040_fixed_invites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _jbool(value: Any) -> bool:
    return value is True or str(value).strip().lower() in ("true", "1")


def _parse_dt(value: Any) -> datetime | None:
    """宽松解析：兼容 '2026-08-01 09:00' / '2026-8-7 10:30:45' / ISO。"""
    if value is None:
        return None
    text = str(value).strip()
    match = re.match(
        r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?",
        text,
    )
    if not match:
        return None
    try:
        year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        hour = int(match.group(4) or 0)
        minute = int(match.group(5) or 0)
        second = int(match.group(6) or 0)
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def _parse_date(value: Any) -> str | None:
    dt = _parse_dt(value)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d")


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "lead_notes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("lead_id", sa.String(36), nullable=False),
        sa.Column("author", sa.String(128), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("date", sa.DateTime(timezone=False), nullable=True),
        sa.Column("follow_type", sa.String(32), nullable=True),
        sa.Column("wechat_added", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("mentions", sa.JSON(), nullable=True),
        sa.Column("next_follow_at", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("lead_id", "sort_order", name="uq_lead_notes_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_lead_notes_lead", "lead_notes", ["lead_id"])

    op.create_table(
        "crm_lead_import_meta",
        sa.Column("lead_id", sa.String(36), primary_key=True),
        sa.Column("imported_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("feishu_lead_no", sa.String(64), nullable=True),
        sa.Column("created_by_name", sa.String(128), nullable=True),
        sa.Column("feishu_record_id", sa.String(64), nullable=True),
        sa.Column("landingpage_raw", sa.String(512), nullable=True),
        sa.Column("utm_source", sa.String(128), nullable=True),
        sa.Column("platform", sa.String(32), nullable=True),
        sa.Column("external_record_id", sa.String(128), nullable=True),
        sa.Column("operator_name", sa.String(128), nullable=True),
        mysql_charset="utf8mb4",
    )

    # —— 从 document.importMeta / notes 回填（Python 逐行，逻辑与仓库 sync 一致）——
    rows = bind.execute(sa.text("SELECT id, document FROM crm_leads")).fetchall()
    note_params: list[dict[str, Any]] = []
    meta_params: list[dict[str, Any]] = []
    note_sql = sa.text(
        """
        INSERT INTO lead_notes
          (id, lead_id, author, content, date, follow_type, wechat_added,
           mentions, next_follow_at, sort_order)
        VALUES
          (:id, :lead_id, :author, :content, :date, :follow_type, :wechat_added,
           :mentions, :next_follow_at, :sort_order)
        """
    )
    meta_sql = sa.text(
        """
        INSERT IGNORE INTO crm_lead_import_meta
          (lead_id, imported_at, feishu_lead_no, created_by_name, feishu_record_id,
           landingpage_raw, utm_source, platform, external_record_id, operator_name)
        VALUES
          (:lead_id, :imported_at, :feishu_lead_no, :created_by_name, :feishu_record_id,
           :landingpage_raw, :utm_source, :platform, :external_record_id, :operator_name)
        """
    )
    for row in rows:
        doc_raw = row.document
        if isinstance(doc_raw, (str, bytes)):
            try:
                doc_raw = json.loads(doc_raw)
            except Exception:
                doc_raw = {}
        doc = doc_raw if isinstance(doc_raw, dict) else {}

        meta = doc.get("importMeta")
        if isinstance(meta, dict) and meta:
            operator = meta.get("operator")
            operator_name = None
            if isinstance(operator, dict):
                operator_name = _jstr(operator.get("name"))
            meta_params.append(
                {
                    "lead_id": row.id,
                    "imported_at": _parse_dt(meta.get("importedAt")),
                    "feishu_lead_no": _jstr(meta.get("feishuLeadNo")),
                    "created_by_name": _jstr(meta.get("createdByName")),
                    "feishu_record_id": _jstr(meta.get("feishuRecordId")),
                    "landingpage_raw": _jstr(meta.get("landingpageRaw")),
                    "utm_source": _jstr(meta.get("utmSource")),
                    "platform": _jstr(meta.get("platform")),
                    "external_record_id": _jstr(meta.get("externalRecordId")),
                    "operator_name": operator_name,
                }
            )

        notes = doc.get("notes")
        if isinstance(notes, list):
            for index, item in enumerate(notes):
                if not isinstance(item, dict):
                    continue
                content = _jstr(item.get("content"))
                if not content:
                    continue
                note_params.append(
                    {
                        "id": str(item.get("id") or f"{row.id}-ln-{index}"),
                        "lead_id": row.id,
                        "author": _jstr(item.get("author")) or "",
                        "content": content,
                        "date": _parse_dt(item.get("date")),
                        "follow_type": _jstr(item.get("followType")),
                        "wechat_added": int(_jbool(item.get("wechatAdded"))),
                        "mentions": json.dumps(
                            item.get("mentions") or [],
                            ensure_ascii=False,
                        )
                        if isinstance(item.get("mentions"), list)
                        else None,
                        "next_follow_at": _parse_date(item.get("nextFollowAt")),
                        "sort_order": index,
                    }
                )
    if note_params:
        bind.execute(note_sql, note_params)
    if meta_params:
        bind.execute(meta_sql, meta_params)


def downgrade() -> None:
    op.drop_table("crm_lead_import_meta")
    op.drop_index("idx_lead_notes_lead", table_name="lead_notes")
    op.drop_table("lead_notes")
