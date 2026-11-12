"""CRM JSON 高频查询字段落真实列（索引与幂等回填）。

Revision ID: 034_crm_json_fields_to_columns
Revises: 033_crm_contacts_follow_ups
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "034_crm_json_fields_to_columns"
down_revision: Union[str, None] = "033_crm_contacts_follow_ups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 255), 'null'), 'undefined')"


def _jdate(path: str) -> str:
    inner = f"NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), ''), 'null')"
    return f"CAST(LEFT({inner}, 10) AS DATE)"


def _jstr_on(column: str, path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 255), 'null'), 'undefined')"


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("crm_leads", sa.Column("follow_state", sa.String(32), nullable=True))
    op.add_column("crm_leads", sa.Column("brand_name", sa.String(255), nullable=True))
    op.add_column("crm_leads", sa.Column("sdr", sa.String(128), nullable=True))
    op.add_column("crm_leads", sa.Column("sales", sa.String(128), nullable=True))
    op.add_column("crm_leads", sa.Column("transfer_date", sa.Date(), nullable=True))
    op.add_column("crm_leads", sa.Column("created_day", sa.Date(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_leads SET "
            f"follow_state = {_jstr('$.followState')}, "
            f"brand_name = {_jstr('$.brandName')}, "
            f"sdr = {_jstr('$.sdr')}, "
            f"sales = {_jstr('$.sales')}, "
            f"transfer_date = {_jdate('$.transferDate')}, "
            f"created_day = {_jdate('$.createdAt')}"
        )
    )
    op.create_index("idx_crm_leads_follow_state", "crm_leads", ["follow_state"])
    op.create_index("idx_crm_leads_brand_name", "crm_leads", ["brand_name"])
    op.create_index("idx_crm_leads_transfer_date", "crm_leads", ["transfer_date"])
    op.create_index("idx_crm_leads_created_day", "crm_leads", ["created_day"])

    op.add_column("crm_customers", sa.Column("brand_name", sa.String(255), nullable=True))
    op.add_column("crm_customers", sa.Column("owner", sa.String(128), nullable=True))
    op.add_column("crm_customers", sa.Column("industry_l1", sa.String(64), nullable=True))
    op.add_column("crm_customers", sa.Column("created_by_user_id", sa.String(36), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_customers SET "
            f"brand_name = {_jstr('$.brandName')}, "
            f"owner = {_jstr('$.owner')}, "
            f"industry_l1 = {_jstr('$.industryL1')}, "
            f"created_by_user_id = {_jstr('$.createdByUserId')}"
        )
    )
    op.create_index("idx_crm_customers_brand_name", "crm_customers", ["brand_name"])
    op.create_index("idx_crm_customers_industry_l1", "crm_customers", ["industry_l1"])
    op.create_index("idx_crm_customers_created_by_user_id", "crm_customers", ["created_by_user_id"])

    op.add_column("crm_sales_coverages", sa.Column("is_key", sa.Boolean(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_sales_coverages SET is_key = CASE "
            "WHEN JSON_EXTRACT(document, '$.isKey') IS NULL "
            "OR JSON_UNQUOTE(JSON_EXTRACT(document, '$.isKey')) IN ('null', '') THEN NULL "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(document, '$.isKey')) IN ('true', '1', 'True') THEN 1 "
            "ELSE 0 END"
        )
    )
    op.create_index("idx_crm_sales_coverages_is_key", "crm_sales_coverages", ["is_key"])

    op.add_column("crm_opportunities", sa.Column("last_follow_at", sa.Date(), nullable=True))
    op.add_column("crm_opportunities", sa.Column("next_follow_at", sa.Date(), nullable=True))
    op.add_column("crm_opportunities", sa.Column("lost_reason", sa.String(255), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_opportunities SET "
            f"last_follow_at = {_jdate('$.lastFollowAt')}, "
            f"next_follow_at = {_jdate('$.nextFollowAt')}, "
            f"lost_reason = {_jstr('$.lostReason')}"
        )
    )
    op.create_index("idx_crm_opportunities_last_follow_at", "crm_opportunities", ["last_follow_at"])
    op.create_index("idx_crm_opportunities_next_follow_at", "crm_opportunities", ["next_follow_at"])

    op.add_column("crm_contracts", sa.Column("project_status", sa.String(32), nullable=True))
    op.add_column("crm_contracts", sa.Column("type", sa.String(32), nullable=True))
    op.add_column("crm_contracts", sa.Column("sign_type", sa.String(64), nullable=True))
    op.add_column("crm_contracts", sa.Column("source", sa.String(128), nullable=True))
    op.add_column("crm_contracts", sa.Column("status_reason", sa.String(255), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_contracts SET "
            f"project_status = {_jstr('$.projectStatus')}, "
            f"type = {_jstr('$.type')}, "
            f"sign_type = {_jstr('$.signType')}, "
            f"source = {_jstr('$.source')}, "
            f"status_reason = {_jstr('$.statusReason')}"
        )
    )
    op.create_index("idx_crm_contracts_project_status", "crm_contracts", ["project_status"])
    op.create_index("idx_crm_contracts_type", "crm_contracts", ["type"])
    op.create_index("idx_crm_contracts_source", "crm_contracts", ["source"])

    op.add_column("requests", sa.Column("geo_source", sa.String(16), nullable=True))
    op.add_column("requests", sa.Column("company_name", sa.String(255), nullable=True))
    op.add_column("requests", sa.Column("brand_name", sa.String(255), nullable=True))
    op.add_column("requests", sa.Column("goal", sa.String(64), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE requests SET "
            "geo_source = CASE "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '国内GEO需求' THEN 'domestic' "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '海外GEO需求' THEN 'overseas' "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.importMeta.source')) = '麦思博GEO需求' THEN 'mestbo' "
            "WHEN code LIKE 'GEO-CN%' THEN 'domestic' "
            "WHEN code LIKE 'GEO-OV%' THEN 'overseas' "
            "WHEN code LIKE 'GEO-MS%' THEN 'mestbo' "
            "ELSE 'manual' END, "
            f"company_name = {_jstr_on('data', '$.companyName')}, "
            f"brand_name = {_jstr_on('data', '$.brandName')}, "
            f"goal = {_jstr_on('data', '$.goal')}"
        )
    )
    op.create_index("idx_requests_geo_source", "requests", ["geo_source"])
    op.create_index("idx_requests_company_name", "requests", ["company_name"])


def downgrade() -> None:
    op.drop_index("idx_crm_leads_created_day", table_name="crm_leads")
    op.drop_index("idx_crm_leads_transfer_date", table_name="crm_leads")
    op.drop_index("idx_crm_leads_brand_name", table_name="crm_leads")
    op.drop_index("idx_crm_leads_follow_state", table_name="crm_leads")
    op.drop_column("crm_leads", "created_day")
    op.drop_column("crm_leads", "transfer_date")
    op.drop_column("crm_leads", "sales")
    op.drop_column("crm_leads", "sdr")
    op.drop_column("crm_leads", "brand_name")
    op.drop_column("crm_leads", "follow_state")

    op.drop_index("idx_crm_customers_created_by_user_id", table_name="crm_customers")
    op.drop_index("idx_crm_customers_industry_l1", table_name="crm_customers")
    op.drop_index("idx_crm_customers_brand_name", table_name="crm_customers")
    op.drop_column("crm_customers", "created_by_user_id")
    op.drop_column("crm_customers", "industry_l1")
    op.drop_column("crm_customers", "owner")
    op.drop_column("crm_customers", "brand_name")

    op.drop_index("idx_crm_sales_coverages_is_key", table_name="crm_sales_coverages")
    op.drop_column("crm_sales_coverages", "is_key")

    op.drop_index("idx_crm_opportunities_next_follow_at", table_name="crm_opportunities")
    op.drop_index("idx_crm_opportunities_last_follow_at", table_name="crm_opportunities")
    op.drop_column("crm_opportunities", "lost_reason")
    op.drop_column("crm_opportunities", "next_follow_at")
    op.drop_column("crm_opportunities", "last_follow_at")

    op.drop_index("idx_crm_contracts_source", table_name="crm_contracts")
    op.drop_index("idx_crm_contracts_type", table_name="crm_contracts")
    op.drop_index("idx_crm_contracts_project_status", table_name="crm_contracts")
    op.drop_column("crm_contracts", "status_reason")
    op.drop_column("crm_contracts", "source")
    op.drop_column("crm_contracts", "sign_type")
    op.drop_column("crm_contracts", "type")
    op.drop_column("crm_contracts", "project_status")

    op.drop_index("idx_requests_company_name", table_name="requests")
    op.drop_index("idx_requests_geo_source", table_name="requests")
    op.drop_column("requests", "goal")
    op.drop_column("requests", "brand_name")
    op.drop_column("requests", "company_name")
    op.drop_column("requests", "geo_source")
