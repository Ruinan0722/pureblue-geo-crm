"""打卡附件子表补契约列：original_name / uploaded_at / uploaded_by（回填）。

035 只把 id/url/storage_path/content_type/size 落表，CheckinAttachment 响应契约的
originalName/uploadedAt/uploadedBy 缺失；这里补列并从 checkin_records.attachments JSON 回填。

Revision ID: 046_checkin_attachment_columns
Revises: 045_collation_align
"""

from __future__ import annotations

import json
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "046_checkin_attachment_columns"
down_revision: Union[str, None] = "045_collation_align"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstrv(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column("checkin_attachments", sa.Column("original_name", sa.String(255), nullable=True))
    op.add_column("checkin_attachments", sa.Column("uploaded_at", sa.String(64), nullable=True))
    op.add_column("checkin_attachments", sa.Column("uploaded_by", sa.String(128), nullable=True))

    # —— 从 checkin_records.attachments JSON 回填（幂等 UPDATE，按 id 精确匹配） ——
    rows = bind.execute(sa.text("SELECT id, attachments FROM checkin_records")).fetchall()
    update_sql = sa.text(
        "UPDATE checkin_attachments SET original_name = :original_name, "
        "uploaded_at = :uploaded_at, uploaded_by = :uploaded_by "
        "WHERE checkin_id = :checkin_id AND id = :attachment_id"
    )
    params: list[dict[str, Any]] = []
    for row in rows:
        raw = row.attachments
        if isinstance(raw, (str, bytes)):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = []
        if not isinstance(raw, list):
            continue
        for item in raw:
            if not isinstance(item, dict):
                continue
            aid = _jstrv(item.get("id"))
            if not aid:
                continue
            params.append(
                {
                    "checkin_id": row.id,
                    "attachment_id": aid,
                    "original_name": _jstrv(item.get("originalName")),
                    "uploaded_at": _jstrv(item.get("uploadedAt")),
                    "uploaded_by": _jstrv(item.get("uploadedBy")),
                }
            )
    if params:
        bind.execute(update_sql, params)


def downgrade() -> None:
    op.drop_column("checkin_attachments", "uploaded_by")
    op.drop_column("checkin_attachments", "uploaded_at")
    op.drop_column("checkin_attachments", "original_name")
