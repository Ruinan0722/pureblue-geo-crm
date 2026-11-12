"""CRM JSON 关键业务字段补真实列（索引与回填）。

Revision ID: 031_crm_business_columns
Revises: 030_sdr_dashboard
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "031_crm_business_columns"
down_revision: Union[str, None] = "030_sdr_dashboard"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    """JSON 字符串字段回填 SQL 片段：缺失/空 → NULL，截断 255。"""
    return f"LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), ''), 255)"


def _jstr_full(path: str) -> str:
    return f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"


def _jdate(path: str) -> str:
    return f"CAST(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), ''), 10) AS DATE)"


def _jdecimal(path: str) -> str:
    return f"CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '') AS DECIMAL(18,2))"


def upgrade() -> None:
    bind = op.get_bind()

    # —— crm_leads ——
    op.add_column("crm_leads", sa.Column("source", sa.String(128), nullable=True))
    op.add_column("crm_leads", sa.Column("source_detail", sa.String(255), nullable=True))
    op.add_column("crm_leads", sa.Column("level", sa.String(32), nullable=True))
    op.add_column("crm_leads", sa.Column("region", sa.String(128), nullable=True))
    op.add_column("crm_leads", sa.Column("first_contact_date", sa.Date(), nullable=True))
    op.add_column("crm_leads", sa.Column("contact_name", sa.String(255), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_leads SET "
            f"source = {_jstr('$.source')}, "
            f"source_detail = {_jstr('$.sourceDetail')}, "
            f"level = {_jstr('$.level')}, "
            f"region = {_jstr('$.region')}, "
            f"first_contact_date = {_jdate('$.firstContactDate')}, "
            f"contact_name = {_jstr('$.contactName')}"
        )
    )
    op.create_index("idx_crm_leads_source", "crm_leads", ["source"])
    op.create_index("idx_crm_leads_source_detail", "crm_leads", ["source_detail"])
    op.create_index("idx_crm_leads_level", "crm_leads", ["level"])
    op.create_index("idx_crm_leads_region", "crm_leads", ["region"])

    # —— crm_customers ——
    op.add_column("crm_customers", sa.Column("credit_code", sa.String(64), nullable=True))
    op.add_column("crm_customers", sa.Column("region", sa.String(128), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_customers SET "
            f"credit_code = {_jstr_full('$.creditCode')}, "
            f"region = {_jstr_full('$.region')}"
        )
    )
    op.create_index("idx_crm_customers_credit_code", "crm_customers", ["credit_code"])
    op.create_index("idx_crm_customers_region", "crm_customers", ["region"])

    # —— crm_opportunities ——
    op.add_column("crm_opportunities", sa.Column("amount", sa.Numeric(18, 2), nullable=True))
    op.add_column("crm_opportunities", sa.Column("expected_sign_date", sa.Date(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_opportunities SET "
            f"amount = {_jdecimal('$.amount')}, "
            f"expected_sign_date = {_jdate('$.expectedSignDate')}"
        )
    )

    # —— crm_contracts ——
    op.add_column("crm_contracts", sa.Column("amount", sa.Numeric(18, 2), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_contracts SET "
            f"amount = {_jdecimal('$.amount')}"
        )
    )

    # —— crm_sales_coverages ——
    op.add_column("crm_sales_coverages", sa.Column("owner_name", sa.String(255), nullable=True))
    op.add_column("crm_sales_coverages", sa.Column("last_follow_at", sa.Date(), nullable=True))
    op.add_column("crm_sales_coverages", sa.Column("next_follow_at", sa.Date(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE crm_sales_coverages SET "
            f"owner_name = {_jstr('$.ownerName')}, "
            f"last_follow_at = {_jdate('$.lastFollowAt')}, "
            f"next_follow_at = {_jdate('$.nextFollowAt')}"
        )
    )
    op.create_index(
        "idx_crm_sales_coverages_last_follow_at",
        "crm_sales_coverages",
        ["last_follow_at"],
    )
    op.create_index(
        "idx_crm_sales_coverages_next_follow_at",
        "crm_sales_coverages",
        ["next_follow_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_crm_leads_source", table_name="crm_leads")
    op.drop_index("idx_crm_leads_source_detail", table_name="crm_leads")
    op.drop_index("idx_crm_leads_level", table_name="crm_leads")
    op.drop_index("idx_crm_leads_region", table_name="crm_leads")
    op.drop_column("crm_leads", "contact_name")
    op.drop_column("crm_leads", "first_contact_date")
    op.drop_column("crm_leads", "region")
    op.drop_column("crm_leads", "level")
    op.drop_column("crm_leads", "source_detail")
    op.drop_column("crm_leads", "source")

    op.drop_index("idx_crm_customers_credit_code", table_name="crm_customers")
    op.drop_index("idx_crm_customers_region", table_name="crm_customers")
    op.drop_column("crm_customers", "region")
    op.drop_column("crm_customers", "credit_code")

    op.drop_column("crm_opportunities", "expected_sign_date")
    op.drop_column("crm_opportunities", "amount")

    op.drop_column("crm_contracts", "amount")

    op.drop_index("idx_crm_sales_coverages_last_follow_at", table_name="crm_sales_coverages")
    op.drop_index("idx_crm_sales_coverages_next_follow_at", table_name="crm_sales_coverages")
    op.drop_column("crm_sales_coverages", "next_follow_at")
    op.drop_column("crm_sales_coverages", "last_follow_at")
    op.drop_column("crm_sales_coverages", "owner_name")
