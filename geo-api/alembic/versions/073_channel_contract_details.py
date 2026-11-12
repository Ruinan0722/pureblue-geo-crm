"""Add channel contract register fields without changing existing contracts."""
from alembic import op
import sqlalchemy as sa

revision = "073_channel_contract_details"
down_revision = "072_channel_intake"
branch_labels = None
depends_on = None


def upgrade():
    for name, size in [("channel_subject", 255), ("contact_name", 128), ("contact_phone", 64),
                       ("contact_email", 255), ("region", 64), ("signing_subject", 255),
                       ("signer", 128), ("project_status", 16)]:
        op.add_column("channel_contracts", sa.Column(name, sa.String(size), nullable=True))
    for name in ["effective_date", "double_signed_date", "end_date"]:
        op.add_column("channel_contracts", sa.Column(name, sa.Date(), nullable=True))
    op.add_column("channel_contracts", sa.Column("term_months", sa.Integer(), nullable=True))
    op.add_column("channel_contracts", sa.Column("attachments_json", sa.Text(), nullable=True))


def downgrade():
    for name in ["attachments_json", "term_months", "end_date", "double_signed_date", "effective_date",
                 "project_status", "signer", "signing_subject", "region", "contact_email",
                 "contact_phone", "contact_name", "channel_subject"]:
        op.drop_column("channel_contracts", name)
