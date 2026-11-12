"""Channel public intake and lead conversion metadata (additive only)."""
from alembic import op
import sqlalchemy as sa

revision = "072_channel_intake"
down_revision = "071_channel_management"
branch_labels = None
depends_on = None

def upgrade():
    for name, size in [("lead_type",32),("industry",64),("channel_type",32),("signing_method",32),("duplicate_key",64),("converted_partner_id",36)]:
        op.add_column("crm_leads", sa.Column(name, sa.String(size), nullable=True))
    op.create_index("ix_crm_leads_lead_type", "crm_leads", ["lead_type"])
    op.create_index("ix_crm_leads_duplicate_key", "crm_leads", ["duplicate_key"])
    op.add_column("crm_leads", sa.Column("assigned_sales_user_id", sa.String(36), nullable=True))
    op.create_index("ix_crm_leads_assigned_sales_user_id", "crm_leads", ["assigned_sales_user_id"])
    op.add_column("channel_partners", sa.Column("cooperation_type", sa.String(32), nullable=True))
    op.add_column("channel_partners", sa.Column("signing_method", sa.String(32), nullable=True))
    op.add_column("channel_contacts", sa.Column("title", sa.String(128), nullable=True))

def downgrade():
    op.drop_index("ix_crm_leads_assigned_sales_user_id", table_name="crm_leads")
    op.drop_column("crm_leads", "assigned_sales_user_id")
    op.drop_column("channel_contacts", "title")
    op.drop_column("channel_partners", "signing_method")
    op.drop_column("channel_partners", "cooperation_type")
    op.drop_index("ix_crm_leads_duplicate_key", table_name="crm_leads")
    op.drop_index("ix_crm_leads_lead_type", table_name="crm_leads")
    for name in ["converted_partner_id","duplicate_key","signing_method","channel_type","industry","lead_type"]:
        op.drop_column("crm_leads", name)
