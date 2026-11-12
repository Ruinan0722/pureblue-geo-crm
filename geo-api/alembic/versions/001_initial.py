"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("feishu_open_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("role", sa.String(32), nullable=False, server_default="sales"),
        sa.Column("department_names", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.UniqueConstraint("feishu_open_id", name="uk_users_feishu_open_id"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Index("idx_sessions_user_id", "user_id"),
        sa.Index("idx_sessions_expires_at", "expires_at"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "invites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token", sa.String(128), nullable=False),
        sa.Column("staff_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.UniqueConstraint("token", name="uk_invites_token"),
        sa.Index("idx_invites_staff", "staff_user_id"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("owner", sa.String(128), nullable=False),
        sa.Column("staff_user_id", sa.String(36), nullable=True),
        sa.Column("invite_id", sa.String(36), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("notes", sa.JSON(), nullable=False),
        sa.UniqueConstraint("code", name="uk_requests_code"),
        sa.Index("idx_requests_status", "status"),
        sa.Index("idx_requests_submitted_at", "submitted_at"),
        sa.Index("idx_requests_staff_user", "staff_user_id"),
        sa.Index("idx_requests_invite", "invite_id"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("requests")
    op.drop_table("invites")
    op.drop_table("sessions")
    op.drop_table("users")
