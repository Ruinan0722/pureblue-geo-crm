"""Add isolated channel partners, activity, opportunities and contracts.

Revision ID: 071_channel_management
Revises: 070_opp_pm_req
"""

from alembic import op
import sqlalchemy as sa


revision = "071_channel_management"
down_revision = "070_opp_pm_req"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "channel_partners",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("channel_type", sa.String(64)),
        sa.Column("source", sa.String(128)),
        sa.Column("source_detail", sa.String(255)),
        sa.Column("level", sa.String(64)),
        sa.Column("owner_user_id", sa.String(36)),
        sa.Column("owner_name", sa.String(128)),
        sa.Column("owner_department", sa.String(255)),
        sa.Column("region", sa.String(64)),
        sa.Column("city", sa.String(128)),
        sa.Column("website", sa.String(1024)),
        sa.Column("industries_json", sa.Text()),
        sa.Column("major_customers", sa.Text()),
        sa.Column("team_support", sa.Boolean()),
        sa.Column("agency_types_json", sa.Text()),
        sa.Column("cooperation_project", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_by_name", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("name", "channel_type", "source", "level", "owner_user_id", "owner_name", "owner_department", "region", "city", "created_by_user_id"):
        op.create_index(f"ix_channel_partners_{column}", "channel_partners", [column])

    op.create_table(
        "channel_contacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("partner_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("phone", sa.String(64)),
        sa.Column("method", sa.String(128)),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_channel_contacts_partner_id", "channel_contacts", ["partner_id"])

    op.create_table(
        "channel_follow_ups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("partner_id", sa.String(36), nullable=False),
        sa.Column("contact_id", sa.String(36)),
        sa.Column("author_user_id", sa.String(36), nullable=False),
        sa.Column("author_name", sa.String(128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("next_follow_at", sa.Date()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("partner_id", "contact_id", "author_user_id", "created_at"):
        op.create_index(f"ix_channel_follow_ups_{column}", "channel_follow_ups", [column])

    op.create_table(
        "channel_opportunities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("partner_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False, server_default="需求确认"),
        sa.Column("owner_user_id", sa.String(36)),
        sa.Column("owner_name", sa.String(128)),
        sa.Column("owner_department", sa.String(255)),
        sa.Column("lost_reason", sa.String(512)),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("partner_id", "stage", "owner_user_id", "owner_department"):
        op.create_index(f"ix_channel_opportunities_{column}", "channel_opportunities", [column])

    op.create_table(
        "channel_contracts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("partner_id", sa.String(36), nullable=False),
        sa.Column("opportunity_id", sa.String(36)),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="准备签约"),
        sa.Column("contract_number", sa.String(128)),
        sa.Column("signed_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("partner_id", "opportunity_id", "status", "contract_number"):
        op.create_index(f"ix_channel_contracts_{column}", "channel_contracts", [column])

    op.create_table(
        "channel_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("partner_id", sa.String(36), nullable=False),
        sa.Column("actor_user_id", sa.String(36), nullable=False),
        sa.Column("actor_name", sa.String(128), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("partner_id", "actor_user_id", "created_at"):
        op.create_index(f"ix_channel_history_{column}", "channel_history", [column])


def downgrade() -> None:
    op.drop_table("channel_history")
    op.drop_table("channel_contracts")
    op.drop_table("channel_opportunities")
    op.drop_table("channel_follow_ups")
    op.drop_table("channel_contacts")
    op.drop_table("channel_partners")
