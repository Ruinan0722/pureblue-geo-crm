"""Add structured meeting details and deletion audit to lead source options.

Revision ID: 029_lead_source_meeting
Revises: 028_lead_source_options
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "029_lead_source_meeting"
down_revision: Union[str, None] = "028_lead_source_options"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lead_source_options", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("lead_source_options", sa.Column("organizer", sa.String(128), nullable=True))
    op.add_column("lead_source_options", sa.Column("deleted_by", sa.String(36), nullable=True))
    op.add_column("lead_source_options", sa.Column("deletion_reason", sa.Text(), nullable=True))
    op.add_column("lead_source_options", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.execute(sa.text("UPDATE lead_source_options SET start_date = DATE(created_at) WHERE start_date IS NULL"))
    op.execute(sa.text("UPDATE lead_source_options SET organizer = '历史数据（待补充）' WHERE organizer IS NULL"))
    op.alter_column("lead_source_options", "start_date", existing_type=sa.Date(), nullable=False)
    op.alter_column("lead_source_options", "organizer", existing_type=sa.String(128), nullable=False)
    op.drop_constraint("uq_lead_source_option_name", "lead_source_options", type_="unique")
    op.create_unique_constraint("uq_lead_source_option_meeting", "lead_source_options", ["primary_source", "start_date", "name"])
    op.create_index("idx_lead_source_options_start_date", "lead_source_options", ["start_date"])
    op.create_index("idx_lead_source_options_deleted_at", "lead_source_options", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("idx_lead_source_options_deleted_at", table_name="lead_source_options")
    op.drop_index("idx_lead_source_options_start_date", table_name="lead_source_options")
    op.drop_constraint("uq_lead_source_option_meeting", "lead_source_options", type_="unique")
    op.create_unique_constraint("uq_lead_source_option_name", "lead_source_options", ["primary_source", "name"])
    op.drop_column("lead_source_options", "deleted_at")
    op.drop_column("lead_source_options", "deletion_reason")
    op.drop_column("lead_source_options", "deleted_by")
    op.drop_column("lead_source_options", "organizer")
    op.drop_column("lead_source_options", "start_date")
