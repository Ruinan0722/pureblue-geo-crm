"""rbac tables and user role columns

Revision ID: 003_rbac
Revises: 002_feishu_contacts
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_rbac"
down_revision: Union[str, None] = "002_feishu_contacts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role_source", sa.String(16), nullable=False, server_default="feishu"))
    op.add_column("users", sa.Column("role_locked", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.add_column("users", sa.Column("data_scope_override", sa.String(16), nullable=True))

    op.create_table(
        "rbac_permissions",
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("module", sa.String(64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "rbac_roles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(512), nullable=False, server_default=""),
        sa.Column("data_scope", sa.String(16), nullable=False, server_default="own"),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.UniqueConstraint("code", name="uk_rbac_roles_code"),
        mysql_charset="utf8mb4",
    )

    op.create_table(
        "rbac_role_permissions",
        sa.Column("role_id", sa.String(36), sa.ForeignKey("rbac_roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_code", sa.String(64), sa.ForeignKey("rbac_permissions.code", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("role_id", "permission_code"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_rbac_role_permissions_role", "rbac_role_permissions", ["role_id"])

    op.create_table(
        "user_role_assignments",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.String(36), sa.ForeignKey("rbac_roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("assigned_at", sa.DateTime(timezone=False), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "role_id"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_user_role_assignments_user", "user_role_assignments", ["user_id"])

    op.create_table(
        "user_permission_overrides",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_code", sa.String(64), sa.ForeignKey("rbac_permissions.code", ondelete="CASCADE"), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "permission_code"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("user_permission_overrides")
    op.drop_table("user_role_assignments")
    op.drop_table("rbac_role_permissions")
    op.drop_table("rbac_roles")
    op.drop_table("rbac_permissions")
    op.drop_column("users", "data_scope_override")
    op.drop_column("users", "role_locked")
    op.drop_column("users", "role_source")
