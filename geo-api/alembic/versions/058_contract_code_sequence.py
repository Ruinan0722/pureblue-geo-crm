"""Add concurrency-safe contract code sequence.

Revision ID: 058_contract_code_sequence
Revises: 057_external_lead_fields
"""

from alembic import op
import sqlalchemy as sa


revision = "058_contract_code_sequence"
down_revision = "057_external_lead_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crm_number_sequences",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("current_value", sa.Integer(), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.execute(
        "INSERT INTO crm_number_sequences (name, current_value) "
        "VALUES ('contract_pba', 93)"
    )


def downgrade() -> None:
    op.drop_table("crm_number_sequences")
