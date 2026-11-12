"""store checkin attachment links as structured JSON

Revision ID: 011_checkin_attachments_json
Revises: 010_user_employment_status
Create Date: 2026-07-14
"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_checkin_attachments_json"
down_revision: Union[str, None] = "010_user_employment_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "checkin_records",
        sa.Column("attachments", sa.JSON(), nullable=True),
    )

    # 用已有 attachment_ids 回填可读链接，方便库内直接查看
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, attachment_ids FROM checkin_records WHERE attachment_ids IS NOT NULL")
    ).mappings().all()
    for row in rows:
        raw = row["attachment_ids"]
        if not raw:
            continue
        try:
            ids = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            continue
        if not isinstance(ids, list) or not ids:
            continue
        attachments = [
            {
                "id": str(item),
                "url": f"/api/checkin/attachments/{item}",
                "storagePath": f"data/checkin-attachments/{item}",
            }
            for item in ids
            if item
        ]
        conn.execute(
            sa.text("UPDATE checkin_records SET attachments = :attachments WHERE id = :id"),
            {"id": row["id"], "attachments": json.dumps(attachments, ensure_ascii=False)},
        )


def downgrade() -> None:
    op.drop_column("checkin_records", "attachments")
