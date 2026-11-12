"""商机剩余单值字段列化 + projectTypes/requestIds 子表（回填与索引）。

Revision ID: 037_opportunity_remaining
Revises: 036_audit_related_entities
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "037_opportunity_remaining"
down_revision: Union[str, None] = "036_audit_related_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 255), 'null'), 'undefined')"


def upgrade() -> None:
    bind = op.get_bind()

    columns = [
        ("name", sa.String(255)),
        ("brand_name", sa.String(255)),
        ("region", sa.String(128)),
        ("geo_source", sa.String(16)),
        ("goal", sa.String(64)),
        ("platform", sa.String(128)),
        ("period", sa.String(32)),
        ("probability", sa.Integer()),
        ("owner", sa.String(128)),
        ("advisor", sa.String(128)),
        ("customer_success", sa.String(128)),
        ("subsidiary_id", sa.String(36)),
        ("subsidiary_name", sa.String(128)),
        ("primary_contact_id", sa.String(64)),
        ("lost_stage", sa.String(32)),
        ("lost_reason_l1", sa.String(128)),
        ("lost_reason_l2", sa.String(255)),
        ("competitor", sa.String(255)),
    ]
    for name, col_type in columns:
        op.add_column("crm_opportunities", sa.Column(name, col_type, nullable=True))

    assigns = ",\n".join(
        f"{name} = {_jstr('$.' + _camel(name))}"
        for name, _ in columns
        if name != "probability"
    )
    bind.execute(
        sa.text(
            "UPDATE crm_opportunities SET "
            f"{assigns}, "
            "probability = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.probability')), '') IS NULL THEN NULL "
            "ELSE CAST(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.probability')), '') AS DECIMAL(8,1)) AS UNSIGNED) END"
        )
    )
    op.create_index("idx_crm_opp_geo_source", "crm_opportunities", ["geo_source"])
    op.create_index("idx_crm_opp_lost_reason_l1", "crm_opportunities", ["lost_reason_l1"])

    op.create_table(
        "opportunity_project_types",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("opportunity_id", sa.String(36), nullable=False),
        sa.Column("project_type", sa.String(64), nullable=False),
        sa.UniqueConstraint("opportunity_id", "project_type", name="uq_opp_project_type"),
    )
    op.create_index("idx_opp_project_types_opp", "opportunity_project_types", ["opportunity_id"])
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO opportunity_project_types (id, opportunity_id, project_type) "
            "SELECT CONCAT(o.id, '-pt-', jt.ordinality - 1), o.id, JSON_UNQUOTE(jt.value) "
            "FROM crm_opportunities o, "
            "JSON_TABLE(o.document, '$.projectTypes[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL"
        )
    )

    op.create_table(
        "opportunity_request_ids",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("opportunity_id", sa.String(36), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.UniqueConstraint("opportunity_id", "request_id", name="uq_opp_request_id"),
    )
    op.create_index("idx_opp_request_ids_opp", "opportunity_request_ids", ["opportunity_id"])
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO opportunity_request_ids (id, opportunity_id, request_id) "
            "SELECT CONCAT(o.id, '-ri-', jt.ordinality - 1), o.id, JSON_UNQUOTE(jt.value) "
            "FROM crm_opportunities o, "
            "JSON_TABLE(o.document, '$.requestIds[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_table("opportunity_request_ids")
    op.drop_table("opportunity_project_types")
    op.drop_index("idx_crm_opp_lost_reason_l1", table_name="crm_opportunities")
    op.drop_index("idx_crm_opp_geo_source", table_name="crm_opportunities")
    for name, _ in [
        ("name", sa.String(255)),
        ("brand_name", sa.String(255)),
        ("region", sa.String(128)),
        ("geo_source", sa.String(16)),
        ("goal", sa.String(64)),
        ("platform", sa.String(128)),
        ("period", sa.String(32)),
        ("probability", sa.Integer()),
        ("owner", sa.String(128)),
        ("advisor", sa.String(128)),
        ("customer_success", sa.String(128)),
        ("subsidiary_id", sa.String(36)),
        ("subsidiary_name", sa.String(128)),
        ("primary_contact_id", sa.String(64)),
        ("lost_stage", sa.String(32)),
        ("lost_reason_l1", sa.String(128)),
        ("lost_reason_l2", sa.String(255)),
        ("competitor", sa.String(255)),
    ]:
        op.drop_column("crm_opportunities", name)


def _camel(name: str) -> str:
    """列名 → document 驼峰 key。"""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
