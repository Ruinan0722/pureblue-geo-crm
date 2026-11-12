"""商机跟进/顾问反馈子表：opportunity_notes（回填与索引）。

Revision ID: 041_opportunity_notes
Revises: 039_contract_remaining
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "041_opportunity_notes"
down_revision: Union[str, None] = "039_contract_remaining"
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
    """宽松解析跟进日期：兼容 '2026-08-01 09:00' / '2026-8-7 10:30:45'。"""
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
    """把 'YYYY-MM-DD' / '2026-8-7 ...' 归一为 DATE 字符串，供 MySQL 参数绑定。"""
    dt = _parse_dt(value)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d")


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "opportunity_notes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("opportunity_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("author", sa.String(128), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("date", sa.DateTime(timezone=False), nullable=True),
        sa.Column("follow_type", sa.String(32), nullable=True),
        sa.Column("wechat_added", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("mentions", sa.JSON(), nullable=True),
        sa.Column("next_follow_at", sa.Date(), nullable=True),
        sa.Column("origin", sa.String(32), nullable=True),
        sa.Column("source_request_id", sa.String(36), nullable=True),
        sa.Column("source_request_note_id", sa.String(64), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("opportunity_id", "kind", "sort_order", name="uq_opp_notes_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "idx_opp_notes_opportunity",
        "opportunity_notes",
        ["opportunity_id", "kind"],
    )

    # —— 从 document.notes / advisorNotes 回填（Python 逐行，逻辑与仓库 sync 一致）——
    rows = bind.execute(sa.text("SELECT id, document FROM crm_opportunities")).fetchall()
    params: list[dict[str, Any]] = []
    insert_sql = sa.text(
        """
        INSERT INTO opportunity_notes
          (id, opportunity_id, kind, author, content, date, follow_type, wechat_added,
           mentions, next_follow_at, origin, source_request_id, source_request_note_id,
           sort_order)
        VALUES
          (:id, :opportunity_id, :kind, :author, :content, :date, :follow_type, :wechat_added,
           :mentions, :next_follow_at, :origin, :source_request_id, :source_request_note_id,
           :sort_order)
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
        for kind, key in (("sales", "notes"), ("advisor", "advisorNotes")):
            items = doc.get(key)
            if not isinstance(items, list):
                continue
            for index, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                content = _jstr(item.get("content"))
                if not content:
                    continue
                params.append(
                    {
                        "id": str(item.get("id") or f"{row.id}-on-{kind}-{index}"),
                        "opportunity_id": row.id,
                        "kind": kind,
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
                        "origin": _jstr(item.get("origin")),
                        "source_request_id": _jstr(item.get("sourceRequestId")),
                        "source_request_note_id": _jstr(item.get("sourceRequestNoteId")),
                        "sort_order": index,
                    }
                )
    if params:
        bind.execute(insert_sql, params)


def downgrade() -> None:
    op.drop_index("idx_opp_notes_opportunity", table_name="opportunity_notes")
    op.drop_table("opportunity_notes")
