"""projects.geo_source for domestic/overseas attribution

Revision ID: 022_project_geo_source
Revises: 021_feishu_led_department_ids
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022_project_geo_source"
down_revision: Union[str, None] = "021_feishu_led_department_ids"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    if not _has_column("projects", "geo_source"):
        op.add_column(
            "projects",
            sa.Column("geo_source", sa.String(length=16), nullable=True, index=True),
        )


def downgrade() -> None:
    if _has_column("projects", "geo_source"):
        op.drop_column("projects", "geo_source")
