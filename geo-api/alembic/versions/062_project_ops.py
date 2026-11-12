"""项目交付运营能力：项目扩展字段与结构化事项。

Revision ID: 062_project_ops
Revises: 061_solution_delivery
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "062_project_ops"
down_revision: Union[str, None] = "061_solution_delivery"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for name, column in (
        ("contact_info", sa.Column("contact_info", sa.Text(), nullable=True)),
        ("team_name", sa.Column("team_name", sa.String(128), nullable=False, server_default="")),
        ("office", sa.Column("office", sa.String(32), nullable=False, server_default="")),
        ("customer_level", sa.Column("customer_level", sa.String(32), nullable=False, server_default="")),
        ("acceptance_criteria", sa.Column("acceptance_criteria", sa.Text(), nullable=True)),
        ("original_delivery_date", sa.Column("original_delivery_date", sa.Date(), nullable=True)),
        ("latest_delivery_date", sa.Column("latest_delivery_date", sa.Date(), nullable=True)),
        ("actual_delivery_date", sa.Column("actual_delivery_date", sa.Date(), nullable=True)),
        ("remediation_plan", sa.Column("remediation_plan", sa.Text(), nullable=True)),
        ("delay_customer_note", sa.Column("delay_customer_note", sa.Text(), nullable=True)),
    ):
        op.add_column("projects", column)

    op.create_table(
        "project_work_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(255), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("owner", sa.String(128), nullable=False, server_default=""),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("risk_level", sa.String(16), nullable=False, server_default="low"),
        sa.Column("solution", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("document_json", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_project_work_items_project_id", "project_work_items", ["project_id"])
    op.create_index("ix_project_work_items_kind", "project_work_items", ["kind"])
    op.create_index("ix_project_work_items_status", "project_work_items", ["status"])
    op.create_index("ix_project_work_items_owner_user_id", "project_work_items", ["owner_user_id"])
    op.create_index("ix_project_work_items_due_date", "project_work_items", ["due_date"])
    op.create_index("ix_project_work_items_created_by_user_id", "project_work_items", ["created_by_user_id"])
    op.create_index("ix_project_work_items_created_at", "project_work_items", ["created_at"])
    op.create_index("ix_project_work_items_updated_at", "project_work_items", ["updated_at"])

    op.execute(
        "UPDATE projects SET original_delivery_date = sow_end_date, latest_delivery_date = sow_end_date "
        "WHERE sow_end_date IS NOT NULL"
    )
    op.execute(
        "UPDATE projects SET contact_info = '', acceptance_criteria = '', "
        "remediation_plan = '', delay_customer_note = ''"
    )
    for name in ("contact_info", "acceptance_criteria", "remediation_plan", "delay_customer_note"):
        op.alter_column("projects", name, existing_type=sa.Text(), nullable=False)


def downgrade() -> None:
    op.drop_table("project_work_items")
    for name in (
        "delay_customer_note",
        "remediation_plan",
        "actual_delivery_date",
        "latest_delivery_date",
        "original_delivery_date",
        "acceptance_criteria",
        "customer_level",
        "office",
        "team_name",
        "contact_info",
    ):
        op.drop_column("projects", name)
