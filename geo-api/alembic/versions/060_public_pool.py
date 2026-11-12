"""Add public pool entries, claim workflow and customer pool marker.

Revision ID: 060_public_pool
Revises: 059_payment_plans
"""

from alembic import op
import sqlalchemy as sa


revision = "060_public_pool"
down_revision = "059_payment_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "crm_customers",
        sa.Column("annual_revenue", sa.Numeric(18, 2), nullable=True),
    )
    op.add_column(
        "crm_customers",
        sa.Column("in_public_pool", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_crm_customers_in_public_pool", "crm_customers", ["in_public_pool"])

    op.create_table(
        "crm_public_pool_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("customer_id", sa.String(36), nullable=False),
        sa.Column("coverage_id", sa.String(36), nullable=False),
        sa.Column("region", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="available"),
        sa.Column("release_reason", sa.Text(), nullable=False),
        sa.Column("released_by_user_id", sa.String(36), nullable=False),
        sa.Column("released_by", sa.String(128), nullable=False),
        sa.Column("released_at", sa.DateTime(), nullable=False),
        sa.Column("claimed_by_user_id", sa.String(36), nullable=True),
        sa.Column("claimed_by", sa.String(128), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        mysql_charset="utf8mb4",
    )
    for name, columns in (
        ("ix_public_pool_entries_customer", ["customer_id"]),
        ("ix_public_pool_entries_coverage", ["coverage_id"]),
        ("ix_public_pool_entries_region", ["region"]),
        ("ix_public_pool_entries_status", ["status"]),
        ("ix_public_pool_entries_released_by", ["released_by_user_id"]),
        ("ix_public_pool_entries_released_at", ["released_at"]),
        ("ix_public_pool_entries_claimed_by", ["claimed_by_user_id"]),
        ("ix_public_pool_entries_claimed_at", ["claimed_at"]),
    ):
        op.create_index(name, "crm_public_pool_entries", columns)

    op.create_table(
        "crm_public_pool_claims",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("entry_id", sa.String(36), nullable=False),
        sa.Column("applicant_user_id", sa.String(36), nullable=False),
        sa.Column("applicant_name", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_review"),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("reviewer_user_id", sa.String(36), nullable=True),
        sa.Column("reviewer_name", sa.String(128), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        mysql_charset="utf8mb4",
    )
    for name, columns in (
        ("ix_public_pool_claims_entry", ["entry_id"]),
        ("ix_public_pool_claims_applicant", ["applicant_user_id"]),
        ("ix_public_pool_claims_status", ["status"]),
        ("ix_public_pool_claims_reviewer", ["reviewer_user_id"]),
        ("ix_public_pool_claims_applied_at", ["applied_at"]),
    ):
        op.create_index(name, "crm_public_pool_claims", columns)


def downgrade() -> None:
    op.drop_table("crm_public_pool_claims")
    op.drop_table("crm_public_pool_entries")
    op.drop_index("ix_crm_customers_in_public_pool", table_name="crm_customers")
    op.drop_column("crm_customers", "in_public_pool")
    op.drop_column("crm_customers", "annual_revenue")
