"""users.feishu_led_department_ids for Feishu department leader sync

Revision ID: 021_feishu_led_department_ids
Revises: 020_invite_geo_variant
Create Date: 2026-07-29

Staging / CRM 链：接在 020 之后（库已 stamp 020）。department_ids 已由 016 引入。
生产独立分支 feat/06 另有接 011 的幂等版本（含补 department_ids）。
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "021_feishu_led_department_ids"
down_revision: Union[str, None] = "020_invite_geo_variant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    if not _has_column("users", "feishu_led_department_ids"):
        op.add_column(
            "users",
            sa.Column("feishu_led_department_ids", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("users", "feishu_led_department_ids"):
        op.drop_column("users", "feishu_led_department_ids")
