"""项目数组字段落子表：project_types / platforms → project_string_items。

Revision ID: 049_project_string_items
Revises: 048_drop_json_columns
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "049_project_string_items"
down_revision: Union[str, None] = "048_drop_json_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "project_string_items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("value", sa.String(128), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("project_id", "kind", "sort_order", name="uq_project_string_items_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_project_string_items_project", "project_string_items", ["project_id", "kind"])

    bind.execute(
        sa.text(
            "INSERT INTO project_string_items (id, project_id, kind, value, sort_order) "
            "SELECT CONCAT(p.id, '-pt-', jt.ordinality - 1), p.id, 'project_types', "
            "JSON_UNQUOTE(jt.value), jt.ordinality - 1 "
            "FROM projects p, "
            "JSON_TABLE(p.project_types, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL "
            "UNION ALL "
            "SELECT CONCAT(p.id, '-pl-', jt.ordinality - 1), p.id, 'platforms', "
            "JSON_UNQUOTE(jt.value), jt.ordinality - 1 "
            "FROM projects p, "
            "JSON_TABLE(p.platforms, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL"
        )
    )
    op.drop_column("projects", "project_types")
    op.drop_column("projects", "platforms")


def downgrade() -> None:
    op.add_column("projects", sa.Column("project_types", sa.JSON(), nullable=False))
    op.add_column("projects", sa.Column("platforms", sa.JSON(), nullable=False))
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE projects p SET "
            "project_types = COALESCE((SELECT JSON_ARRAYAGG(value) FROM ("
            "SELECT value FROM project_string_items WHERE project_id = p.id AND kind = 'project_types' ORDER BY sort_order) t), JSON_ARRAY()), "
            "platforms = COALESCE((SELECT JSON_ARRAYAGG(value) FROM ("
            "SELECT value FROM project_string_items WHERE project_id = p.id AND kind = 'platforms' ORDER BY sort_order) t), JSON_ARRAY())"
        )
    )
    op.drop_index("idx_project_string_items_project", table_name="project_string_items")
    op.drop_table("project_string_items")
