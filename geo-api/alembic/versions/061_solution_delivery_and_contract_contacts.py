"""Add solution delivery fields and contract signer contact information.

Revision ID: 061_solution_delivery_and_contract_contacts
Revises: 060_public_pool
"""

from alembic import op
import sqlalchemy as sa


revision = "061_solution_delivery"
down_revision = "060_public_pool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("crm_opportunities", sa.Column("solution_link", sa.String(1024), nullable=True))
    op.add_column("crm_opportunities", sa.Column("expected_solution_date", sa.Date(), nullable=True))
    op.add_column("crm_contracts", sa.Column("signer_contact_name", sa.String(128), nullable=True))
    op.add_column("crm_contracts", sa.Column("signer_contact_phone", sa.String(64), nullable=True))
    op.add_column("crm_contracts", sa.Column("signer_contact_address", sa.String(512), nullable=True))
    op.add_column("crm_contracts", sa.Column("signer_contact_email", sa.String(255), nullable=True))
    op.add_column("crm_contracts", sa.Column("invoice_info", sa.Text(), nullable=True))


def downgrade() -> None:
    for table, column in (
        ("crm_contracts", "invoice_info"),
        ("crm_contracts", "signer_contact_email"),
        ("crm_contracts", "signer_contact_address"),
        ("crm_contracts", "signer_contact_phone"),
        ("crm_contracts", "signer_contact_name"),
        ("crm_opportunities", "expected_solution_date"),
        ("crm_opportunities", "solution_link"),
    ):
        op.drop_column(table, column)
