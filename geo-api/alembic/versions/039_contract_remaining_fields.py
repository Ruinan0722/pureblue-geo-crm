"""合同剩余单值字段列化 + owners 子表（回填与索引）。

Revision ID: 039_contract_remaining
Revises: 038_lead_remaining
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "039_contract_remaining"
down_revision: Union[str, None] = "038_lead_remaining"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 255), 'null'), 'undefined')"


def upgrade() -> None:
    bind = op.get_bind()
    columns = [
        ("code", sa.String(32)),
        ("name", sa.String(255)),
        ("company", sa.String(255)),
        ("region", sa.String(128)),
        ("city", sa.String(128)),
        ("geo_source", sa.String(16)),
    ]
    for name, col_type in columns:
        op.add_column("crm_contracts", sa.Column(name, col_type, nullable=True))
    assigns = ",\n".join(f"{name} = {_jstr('$.' + name)}" for name, _ in columns)
    bind.execute(sa.text(f"UPDATE crm_contracts SET {assigns}"))
    op.create_index("idx_crm_contracts_geo_source", "crm_contracts", ["geo_source"])

    op.create_table(
        "contract_owners",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("contract_id", sa.String(36), nullable=False),
        sa.Column("owner_name", sa.String(128), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("contract_id", "sort_order", name="uq_contract_owners_order"),
    )
    op.create_index("idx_contract_owners_contract", "contract_owners", ["contract_id"])
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO contract_owners (id, contract_id, owner_name, sort_order) "
            "SELECT CONCAT(c.id, '-ow-', jt.ordinality - 1), c.id, JSON_UNQUOTE(jt.value), jt.ordinality - 1 "
            "FROM crm_contracts c, "
            "JSON_TABLE(c.document, '$.owners[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL "
            "UNION ALL "
            "SELECT CONCAT(c.id, '-ow-0'), c.id, JSON_UNQUOTE(JSON_EXTRACT(c.document, '$.owner')), 0 "
            "FROM crm_contracts c "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(c.document, '$.owner')) IS NOT NULL "
            "AND JSON_LENGTH(c.document, '$.owners') = 0"
        )
    )


def downgrade() -> None:
    op.drop_table("contract_owners")
    op.drop_index("idx_crm_contracts_geo_source", table_name="crm_contracts")
    for name in ["geo_source", "city", "region", "company", "name", "code"]:
        op.drop_column("crm_contracts", name)
