"""Add conversations below follow-up records.

Revision ID: 069_follow_up_comments
Revises: 068_crm_team_collaboration
"""

import sqlalchemy as sa
from alembic import op


revision = "069_follow_up_comments"
down_revision = "068_crm_team_collaboration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crm_follow_up_comments",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("follow_up_id", sa.String(128), nullable=False),
        sa.Column("author_user_id", sa.String(36), nullable=True),
        sa.Column("author_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(32), nullable=False, server_default="sales"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_crm_follow_up_comments_follow_up_id", "crm_follow_up_comments", ["follow_up_id"])
    op.create_index("ix_crm_follow_up_comments_author_user_id", "crm_follow_up_comments", ["author_user_id"])
    op.create_index("ix_crm_follow_up_comments_created_at", "crm_follow_up_comments", ["created_at"])


def downgrade() -> None:
    op.drop_table("crm_follow_up_comments")
