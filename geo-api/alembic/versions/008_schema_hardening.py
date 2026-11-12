"""schema hardening: rbac_department_rules, drop sessions, add foreign keys

Revision ID: 008_schema_hardening
Revises: 007_checkin_ts_bigint
Create Date: 2026-07-13
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_schema_hardening"
down_revision: Union[str, None] = "007_checkin_ts_bigint"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_DEPARTMENT_RULES = [
    ("销售部", "sales", 1),
    ("海外运营", "sales", 2),
    ("客户成功", "viewer", 3),
    ("销售运营", "viewer", 4),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "rbac_department_rules" not in inspector.get_table_names():
        op.create_table(
            "rbac_department_rules",
            sa.Column("department_name", sa.String(191), nullable=False),
            sa.Column("role_code", sa.String(64), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.PrimaryKeyConstraint("department_name", "role_code"),
            mysql_charset="utf8mb4",
        )

    for department_name, role_code, sort_order in INITIAL_DEPARTMENT_RULES:
        conn.execute(
            sa.text(
                """
                INSERT IGNORE INTO rbac_department_rules (department_name, role_code, sort_order)
                VALUES (:department_name, :role_code, :sort_order)
                """
            ),
            {
                "department_name": department_name,
                "role_code": role_code,
                "sort_order": sort_order,
            },
        )

    if "sessions" in inspector.get_table_names():
        session_fks = {fk["name"] for fk in inspector.get_foreign_keys("sessions")}
        for fk_name in session_fks:
            op.drop_constraint(fk_name, "sessions", type_="foreignkey")
        op.drop_table("sessions")

    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("requests")}
    if "fk_requests_staff_user" not in existing_fks:
        op.create_foreign_key(
            "fk_requests_staff_user",
            "requests",
            "users",
            ["staff_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "fk_requests_invite" not in existing_fks:
        op.create_foreign_key(
            "fk_requests_invite",
            "requests",
            "invites",
            ["invite_id"],
            ["id"],
            ondelete="SET NULL",
        )

    checkin_fks = {fk["name"] for fk in inspector.get_foreign_keys("checkin_records")}
    if "fk_checkin_user" not in checkin_fks:
        op.create_foreign_key(
            "fk_checkin_user",
            "checkin_records",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    op.drop_constraint("fk_checkin_user", "checkin_records", type_="foreignkey")
    op.drop_constraint("fk_requests_invite", "requests", type_="foreignkey")
    op.drop_constraint("fk_requests_staff_user", "requests", type_="foreignkey")

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

    op.drop_table("rbac_department_rules")
