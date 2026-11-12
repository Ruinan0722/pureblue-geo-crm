"""crm leads / customers / opportunities / contracts

Revision ID: 012_crm_entities
Revises: 011_checkin_attachments_json
Create Date: 2026-07-17
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_crm_entities"
down_revision: Union[str, None] = "011_checkin_attachments_json"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crm_leads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="untouched"),
        sa.Column("company_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_leads_owner", "crm_leads", ["owner_user_id"])
    op.create_index("idx_crm_leads_status", "crm_leads", ["status"])

    op.create_table(
        "crm_customers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="potential"),
        sa.Column("company_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_customers_owner", "crm_customers", ["owner_user_id"])
    op.create_index("idx_crm_customers_status", "crm_customers", ["status"])

    op.create_table(
        "crm_opportunities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("customer_id", sa.String(36), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False, server_default="contact"),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_opps_owner", "crm_opportunities", ["owner_user_id"])
    op.create_index("idx_crm_opps_customer", "crm_opportunities", ["customer_id"])
    op.create_index("idx_crm_opps_stage", "crm_opportunities", ["stage"])

    op.create_table(
        "crm_contracts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("customer_id", sa.String(36), nullable=False, server_default=""),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_crm_contracts_owner", "crm_contracts", ["owner_user_id"])
    op.create_index("idx_crm_contracts_customer", "crm_contracts", ["customer_id"])
    op.create_index("idx_crm_contracts_status", "crm_contracts", ["status"])


def downgrade() -> None:
    op.drop_table("crm_contracts")
    op.drop_table("crm_opportunities")
    op.drop_table("crm_customers")
    op.drop_table("crm_leads")
