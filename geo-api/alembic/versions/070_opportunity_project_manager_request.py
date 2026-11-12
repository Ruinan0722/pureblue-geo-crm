"""Persist opportunity project manager requests.

Revision ID: 070_opp_pm_req
Revises: 069_follow_up_comments
"""

import sqlalchemy as sa
from alembic import op


revision = "070_opp_pm_req"
down_revision = "069_follow_up_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in ("crm_opportunities", "crm_contracts"):
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "project_manager_request_json" not in columns:
            op.add_column(
                table,
                sa.Column("project_manager_request_json", sa.Text(), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in ("crm_contracts", "crm_opportunities"):
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "project_manager_request_json" in columns:
            op.drop_column(table, "project_manager_request_json")
