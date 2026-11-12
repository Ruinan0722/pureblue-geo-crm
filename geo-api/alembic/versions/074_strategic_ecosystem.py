"""Add strategic ecosystem partners to shared channel workflow tables."""
from alembic import op
import sqlalchemy as sa

revision = "074_strategic_ecosystem"
down_revision = "073_channel_contract_details"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("channel_partners", sa.Column("partner_type", sa.String(32), nullable=False, server_default="channel"))
    op.add_column("channel_partners", sa.Column("brand_name", sa.String(255), nullable=True))
    op.create_index("ix_channel_partners_partner_type", "channel_partners", ["partner_type"])
    op.create_index("ix_channel_partners_brand_name", "channel_partners", ["brand_name"])
    op.add_column("channel_contacts", sa.Column("department", sa.String(128), nullable=True))
    op.add_column("channel_contacts", sa.Column("contact_type", sa.String(32), nullable=True))
    op.create_index("ix_channel_contacts_contact_type", "channel_contacts", ["contact_type"])


def downgrade():
    op.drop_index("ix_channel_contacts_contact_type", table_name="channel_contacts")
    op.drop_column("channel_contacts", "contact_type")
    op.drop_column("channel_contacts", "department")
    op.drop_index("ix_channel_partners_brand_name", table_name="channel_partners")
    op.drop_index("ix_channel_partners_partner_type", table_name="channel_partners")
    op.drop_column("channel_partners", "brand_name")
    op.drop_column("channel_partners", "partner_type")
