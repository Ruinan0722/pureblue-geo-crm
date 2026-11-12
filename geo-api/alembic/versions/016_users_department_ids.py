"""users department_ids for hierarchical data scope

Revision ID: 016_users_department_ids
Revises: 015_request_opportunity_binding
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_users_department_ids"
down_revision: Union[str, None] = "015_request_opportunity_binding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("department_ids", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "department_ids")
