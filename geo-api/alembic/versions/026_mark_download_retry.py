"""Add scheduled retry time for Mark PDF downloads.

Revision ID: 026_mark_download_retry
Revises: 025_lead_integration_hardening
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "026_mark_download_retry"
down_revision: Union[str, None] = "025_lead_integration_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mark_integration_files",
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "idx_mark_file_next_attempt",
        "mark_integration_files",
        ["next_attempt_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_mark_file_next_attempt", table_name="mark_integration_files")
    op.drop_column("mark_integration_files", "next_attempt_at")
