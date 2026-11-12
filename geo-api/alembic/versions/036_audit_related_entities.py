"""审计关联实体落子表（related_entity_ids 不再用 JSON 查询）。

Revision ID: 036_audit_related_entities
Revises: 035_crm_child_tables
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "036_audit_related_entities"
down_revision: Union[str, None] = "035_crm_child_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "crm_audit_related_entities",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("audit_id", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.UniqueConstraint("audit_id", "entity_id", name="uq_audit_related_entity"),
    )
    op.create_index("idx_audit_related_audit", "crm_audit_related_entities", ["audit_id"])
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_audit_related_entities (id, audit_id, entity_id) "
            "SELECT CONCAT(a.id, '-re-', jt.ordinality - 1), a.id, JSON_UNQUOTE(jt.value) "
            "FROM crm_audit_records a, "
            "JSON_TABLE(a.related_entity_ids, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_table("crm_audit_related_entities")
