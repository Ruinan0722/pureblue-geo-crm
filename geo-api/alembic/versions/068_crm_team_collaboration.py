"""CRM customer and opportunity team collaboration.

Revision ID: 068_crm_team_collaboration
Revises: 067_project_sow_versions
"""

import sqlalchemy as sa
from alembic import op


revision = "068_crm_team_collaboration"
down_revision = "067_project_sow_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crm_team_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("member_name", sa.String(128), nullable=False),
        sa.Column("department", sa.String(255), nullable=False, server_default=""),
        sa.Column("team_role", sa.String(32), nullable=False, server_default="其他协作"),
        sa.Column("permission", sa.String(16), nullable=False, server_default="read"),
        sa.Column("added_by_user_id", sa.String(36), nullable=True),
        sa.Column("added_by_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_type", "entity_id", "user_id", name="uq_crm_team_member_entity_user"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_crm_team_members_entity_type", "crm_team_members", ["entity_type"])
    op.create_index("ix_crm_team_members_entity_id", "crm_team_members", ["entity_id"])
    op.create_index("ix_crm_team_members_user_id", "crm_team_members", ["user_id"])

    op.create_table(
        "crm_team_activities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("operator_user_id", sa.String(36), nullable=True),
        sa.Column("operator_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("member_user_id", sa.String(36), nullable=True),
        sa.Column("member_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("detail", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_crm_team_activities_entity_type", "crm_team_activities", ["entity_type"])
    op.create_index("ix_crm_team_activities_entity_id", "crm_team_activities", ["entity_id"])
    op.create_index("ix_crm_team_activities_created_at", "crm_team_activities", ["created_at"])


def downgrade() -> None:
    op.drop_table("crm_team_activities")
    op.drop_table("crm_team_members")
