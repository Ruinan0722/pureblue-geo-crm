"""request attachments json

Revision ID: 017_request_attachments
Revises: 016_users_department_ids
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017_request_attachments"
down_revision: Union[str, None] = "016_users_department_ids"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("attachments", sa.JSON(), nullable=False, server_default=sa.text("(JSON_ARRAY())")),
    )


def downgrade() -> None:
    op.drop_column("requests", "attachments")
