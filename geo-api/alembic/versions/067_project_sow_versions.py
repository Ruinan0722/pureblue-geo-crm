"""项目 SOW 不可变版本链。

Revision ID: 067_project_sow_versions
Revises: 066_request_platform_regions
"""

import sqlalchemy as sa
from alembic import op


revision = "067_project_sow_versions"
down_revision = "066_request_platform_regions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_sow_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sow_end_date", sa.Date(), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("change_reason", sa.Text(), nullable=False),
        sa.Column("confirmer", sa.String(128), nullable=False, server_default=""),
        sa.Column("source_change_id", sa.String(36), nullable=True),
        sa.Column("created_by", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "version_no", name="uq_project_sow_version_no"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_project_sow_versions_project_id", "project_sow_versions", ["project_id"])
    op.create_index("ix_project_sow_versions_is_current", "project_sow_versions", ["is_current"])
    op.create_index("ix_project_sow_versions_source_change_id", "project_sow_versions", ["source_change_id"])
    op.create_index("ix_project_sow_versions_created_by_user_id", "project_sow_versions", ["created_by_user_id"])
    op.create_index("ix_project_sow_versions_created_at", "project_sow_versions", ["created_at"])


def downgrade() -> None:
    op.drop_table("project_sow_versions")
