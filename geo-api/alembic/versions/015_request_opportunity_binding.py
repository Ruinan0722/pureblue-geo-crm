"""request opportunity binding

Revision ID: 015_request_opportunity_binding
Revises: 014_crm_notifications
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_request_opportunity_binding"
down_revision: Union[str, None] = "014_crm_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("opportunity_id", sa.String(36), nullable=True),
    )
    op.create_index("idx_requests_opportunity", "requests", ["opportunity_id"])


def downgrade() -> None:
    op.drop_index("idx_requests_opportunity", table_name="requests")
    op.drop_column("requests", "opportunity_id")
