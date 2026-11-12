"""projects + project_notes

Revision ID: 018_projects
Revises: 017_request_attachments
Create Date: 2026-07-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018_projects"
down_revision: Union[str, None] = "017_request_attachments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("customer_id", sa.String(length=36), nullable=False, server_default=""),
        sa.Column("customer_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_contract_id", sa.String(length=36), nullable=False),
        sa.Column("opportunity_id", sa.String(length=36), nullable=True),
        sa.Column("stage", sa.String(length=32), nullable=False, server_default="pending_start"),
        sa.Column("health", sa.String(length=32), nullable=False, server_default="healthy"),
        sa.Column("risk_level", sa.String(length=16), nullable=False, server_default="low"),
        sa.Column("biz_owner", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("biz_owner_user_id", sa.String(length=36), nullable=True),
        sa.Column("project_manager", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("project_manager_user_id", sa.String(length=36), nullable=True),
        sa.Column("executor", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("executor_user_id", sa.String(length=36), nullable=True),
        sa.Column("content_ops", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("content_ops_user_id", sa.String(length=36), nullable=True),
        sa.Column("contract_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("customer_industry", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("customer_type", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("customer_region", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("project_types", sa.JSON(), nullable=False),
        sa.Column("intent_brand", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("intent_content", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("intent_search", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("platforms", sa.JSON(), nullable=False),
        sa.Column("kpi_notes", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("sow_end_date", sa.Date(), nullable=True),
        sa.Column("delay_reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column("updated_by", sa.String(length=128), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("source_contract_id", name="uq_projects_source_contract_id"),
    )
    op.create_index("ix_projects_customer_id", "projects", ["customer_id"])
    op.create_index("ix_projects_source_contract_id", "projects", ["source_contract_id"])
    op.create_index("ix_projects_opportunity_id", "projects", ["opportunity_id"])
    op.create_index("ix_projects_stage", "projects", ["stage"])
    op.create_index("ix_projects_health", "projects", ["health"])
    op.create_index("ix_projects_risk_level", "projects", ["risk_level"])
    op.create_index("ix_projects_updated_at", "projects", ["updated_at"])
    op.create_index("ix_projects_project_manager_user_id", "projects", ["project_manager_user_id"])
    op.create_index("ix_projects_executor_user_id", "projects", ["executor_user_id"])
    op.create_index("ix_projects_content_ops_user_id", "projects", ["content_ops_user_id"])

    op.create_table(
        "project_notes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="other"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
    )
    op.create_index("ix_project_notes_project_id", "project_notes", ["project_id"])
    op.create_index("ix_project_notes_kind", "project_notes", ["kind"])
    op.create_index("ix_project_notes_created_at", "project_notes", ["created_at"])


def downgrade() -> None:
    op.drop_table("project_notes")
    op.drop_table("projects")
