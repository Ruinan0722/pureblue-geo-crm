"""Add contract payment plans.

Revision ID: 059_payment_plans
Revises: 058_contract_code_sequence
"""

from alembic import op
import sqlalchemy as sa


revision = "059_payment_plans"
down_revision = "058_contract_code_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crm_payment_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contract_id", sa.String(36), nullable=False),
        sa.Column("period_index", sa.Integer(), nullable=False),
        sa.Column("period_name", sa.String(64), nullable=False),
        sa.Column("planned_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("planned_date", sa.Date(), nullable=False),
        sa.Column("invoice_status", sa.String(32), nullable=False, server_default="uninvoiced"),
        sa.Column("invoice_date", sa.Date(), nullable=True),
        sa.Column("invoice_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("invoice_attachment", sa.Text(), nullable=True),
        sa.Column("actual_payment_date", sa.Date(), nullable=True),
        sa.Column("actual_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("receipt_attachment", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=True),
        sa.Column("created_by", sa.String(128), nullable=True),
        sa.Column("updated_by", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("contract_id", "period_index", name="uq_payment_plan_contract_period"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_payment_plans_contract_id", "crm_payment_plans", ["contract_id"])
    op.create_index("ix_payment_plans_planned_date", "crm_payment_plans", ["planned_date"])
    op.create_index("ix_payment_plans_created_by_user_id", "crm_payment_plans", ["created_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_payment_plans_created_by_user_id", table_name="crm_payment_plans")
    op.drop_index("ix_payment_plans_planned_date", table_name="crm_payment_plans")
    op.drop_index("ix_payment_plans_contract_id", table_name="crm_payment_plans")
    op.drop_table("crm_payment_plans")
