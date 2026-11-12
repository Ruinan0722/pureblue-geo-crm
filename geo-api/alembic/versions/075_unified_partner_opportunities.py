"""Unify partner opportunities and complete ecosystem / follow-up fields.

Legacy rows are preserved; central opportunity IDs match legacy IDs so existing
contract references and bookmarks remain usable.
"""
from uuid import uuid4
from alembic import op
import sqlalchemy as sa

revision = "075_unified_opportunities"
down_revision = "074_strategic_ecosystem"
branch_labels = None
depends_on = None

PARTNER_COLUMNS = [
    ("customer_type", sa.String(128)), ("customer_subtype", sa.String(128)),
    ("service_contents_json", sa.Text()), ("budget_amount", sa.Numeric(18, 2)),
    ("bd_user_ids_json", sa.Text()), ("bd_names_json", sa.Text()),
    ("primary_opportunity_id", sa.String(36)), ("project_status", sa.String(64)),
    ("expected_sign_month", sa.Date()), ("demand_description", sa.Text()),
    ("project_notes", sa.Text()), ("execution_status", sa.String(32)),
    ("execution_product", sa.Text()), ("execution_intent_count", sa.Integer()),
    ("execution_platform_count", sa.Integer()), ("execution_period_months", sa.Integer()),
    ("execution_end_date", sa.Date()), ("next_follow_at", sa.Date()),
]
STAGES = {"需求确认": "contact", "商务沟通": "business_negotiation", "签署中": "signing", "赢单": "won", "输单": "lost"}

def upgrade():
    op.add_column("crm_opportunities", sa.Column("business_type", sa.String(32), nullable=False, server_default="direct"))
    op.add_column("crm_opportunities", sa.Column("partner_id", sa.String(36), nullable=True))
    op.add_column("crm_opportunities", sa.Column("partner_name", sa.String(255), nullable=True))
    op.create_index("ix_crm_opportunities_business_type", "crm_opportunities", ["business_type"])
    op.create_index("ix_crm_opportunities_partner_id", "crm_opportunities", ["partner_id"])
    for name, kind in PARTNER_COLUMNS:
        op.add_column("channel_partners", sa.Column(name, kind, nullable=True))
    op.add_column("channel_follow_ups", sa.Column("follow_type", sa.String(32), nullable=True))
    op.add_column("channel_follow_ups", sa.Column("contact_name", sa.String(128), nullable=True))
    op.add_column("channel_follow_ups", sa.Column("mentions_json", sa.Text(), nullable=True))
    bind = op.get_bind()
    meta = sa.MetaData()
    partners = sa.Table("channel_partners", meta, autoload_with=bind)
    legacy = sa.Table("channel_opportunities", meta, autoload_with=bind)
    opportunities = sa.Table("crm_opportunities", meta, autoload_with=bind)
    history = sa.Table("opportunity_stage_history", meta, autoload_with=bind)
    partner_map = {row["id"]: row for row in bind.execute(sa.select(partners)).mappings()}
    for old in bind.execute(sa.select(legacy)).mappings():
        parent = partner_map.get(old["partner_id"])
        if parent is None:
            raise RuntimeError("Legacy partner opportunity has no partner: " + old["id"])
        stage = STAGES.get(old["stage"])
        if stage is None:
            raise RuntimeError("Unsupported legacy opportunity stage: " + str(old["stage"]))
        existing = bind.execute(sa.select(opportunities.c.id, opportunities.c.partner_id).where(opportunities.c.id == old["id"])).mappings().first()
        if existing:
            if existing["partner_id"] != old["partner_id"]:
                raise RuntimeError("Conflicting central opportunity ID: " + old["id"])
            continue
        bind.execute(opportunities.insert().values(
            id=old["id"], owner_user_id=old["owner_user_id"] or parent["owner_user_id"],
            customer_id="", business_type=parent["partner_type"], partner_id=parent["id"], partner_name=parent["name"],
            stage=stage, name=old["name"], brand_name=parent["brand_name"] or parent["name"],
            region=parent["region"], geo_source="manual", owner=old["owner_name"] or parent["owner_name"],
            amount=0, probability=20, goal="recommend", platform="ChatGPT", period="6 个月",
            lost_reason=old["lost_reason"], created_day=old["created_at"].date(),
            created_at=old["created_at"], updated_at=old["updated_at"],
        ))
        bind.execute(history.insert().values(id=str(uuid4()), opportunity_id=old["id"], stage=stage,
            entered_at=old["updated_at"], reason="从原渠道商机迁入，保留迁移时阶段", change_type="advance", sort_order=0))

def downgrade():
    # Do not delete central opportunities created after upgrade. An operator must
    # migrate them back before a destructive schema downgrade can be considered.
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT COUNT(*) FROM crm_opportunities WHERE partner_id IS NOT NULL")).scalar():
        raise RuntimeError("Partner opportunities must be exported/migrated before downgrade")
    for name in ("mentions_json", "contact_name", "follow_type"):
        op.drop_column("channel_follow_ups", name)
    for name, _ in reversed(PARTNER_COLUMNS):
        op.drop_column("channel_partners", name)
    op.drop_index("ix_crm_opportunities_partner_id", table_name="crm_opportunities")
    op.drop_index("ix_crm_opportunities_business_type", table_name="crm_opportunities")
    for name in ("partner_name", "partner_id", "business_type"):
        op.drop_column("crm_opportunities", name)
