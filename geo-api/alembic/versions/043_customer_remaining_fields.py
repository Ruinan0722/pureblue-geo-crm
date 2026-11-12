"""客户主档/对接池剩余标量字段列化（回填与兼容）。

Revision ID: 043_customer_remaining
Revises: 042_lead_remaining_collections
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "043_customer_remaining"
down_revision: Union[str, None] = "042_lead_remaining_collections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 1024), 'null'), 'undefined')"


def _jdate(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return (
        f"CASE WHEN {inner} REGEXP '^[0-9]{{4}}[-/][0-9]{{1,2}}[-/][0-9]{{1,2}}' "
        f"THEN CAST(LEFT({inner}, 10) AS DATE) ELSE NULL END"
    )


def upgrade() -> None:
    bind = op.get_bind()

    customer_columns = [
        ("company_uid", sa.String(64)),
        ("website", sa.String(1024)),
        ("city", sa.String(128)),
        ("industry_l2", sa.String(64)),
        ("scale", sa.String(64)),
        ("nature", sa.String(32)),
        ("sdr_user_id", sa.String(36)),
        ("source", sa.String(128)),
        ("source_detail", sa.String(255)),
        ("migration_status", sa.String(32)),
    ]
    for name, col_type in customer_columns:
        op.add_column("crm_customers", sa.Column(name, col_type, nullable=True))
    op.add_column("crm_customers", sa.Column("founded_date", sa.Date(), nullable=True))
    op.add_column("crm_customers", sa.Column("registered_capital", sa.Numeric(18, 2), nullable=True))
    op.add_column("crm_customers", sa.Column("sdr_transfer_date", sa.Date(), nullable=True))
    assigns = ",\n".join(
        f"{name} = {_jstr('$.' + _camel(name))}" for name, _ in customer_columns
    )
    bind.execute(
        sa.text(
            "UPDATE crm_customers SET "
            f"{assigns}, "
            "founded_date = " + _jdate("$.foundedDate") + ", "
            "sdr_transfer_date = " + _jdate("$.sdrTransferDate") + ", "
            "registered_capital = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.registeredCapital')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.registeredCapital')), '') AS DECIMAL(18,2)) END"
        )
    )

    coverage_columns = [
        ("client_dept", sa.String(255)),
        ("source_lead_id", sa.String(36)),
        ("sdr_name", sa.String(128)),
    ]
    for name, col_type in coverage_columns:
        op.add_column("crm_sales_coverages", sa.Column(name, col_type, nullable=True))
    op.add_column("crm_sales_coverages", sa.Column("sdr_transfer_date", sa.Date(), nullable=True))
    op.add_column("crm_sales_coverages", sa.Column("isolation_version", sa.Integer(), nullable=True))
    cov_assigns = ",\n".join(
        f"{name} = {_jstr('$.' + _camel(name))}" for name, _ in coverage_columns
    )
    bind.execute(
        sa.text(
            "UPDATE crm_sales_coverages SET "
            f"{cov_assigns}, "
            "sdr_transfer_date = " + _jdate("$.sdrTransferDate") + ", "
            "isolation_version = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.isolationVersion')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.isolationVersion')), '') AS UNSIGNED) END"
        )
    )


def downgrade() -> None:
    for name in [
        "migration_status",
        "source_detail",
        "source",
        "sdr_transfer_date",
        "sdr_user_id",
        "nature",
        "scale",
        "registered_capital",
        "founded_date",
        "industry_l2",
        "city",
        "website",
        "company_uid",
    ]:
        op.drop_column("crm_customers", name)
    for name in [
        "isolation_version",
        "sdr_transfer_date",
        "sdr_name",
        "source_lead_id",
        "client_dept",
    ]:
        op.drop_column("crm_sales_coverages", name)


def _camel(name: str) -> str:
    """列名 → document 驼峰 key。"""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
