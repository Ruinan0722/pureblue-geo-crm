"""项目字符串子表补齐审计列：created_by / created_by_user_id。

049 建表时未包含模型 ProjectStringItem 的审计列，导致 ORM 查询
（select(ProjectStringItem) 全列带出）在库上 1054 报错。

Revision ID: 050_project_string_items_audit
Revises: 049_project_string_items
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "050_project_string_items_audit"
down_revision: Union[str, None] = "049_project_string_items"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_string_items",
        sa.Column("created_by", sa.String(128), nullable=False, server_default=""),
    )
    op.add_column(
        "project_string_items",
        sa.Column("created_by_user_id", sa.String(36), nullable=True),
    )
    # 与 SQLAlchemy 模型 index=True 的默认命名一致：ix_<table>_<column>
    op.create_index(
        "ix_project_string_items_created_by_user_id",
        "project_string_items",
        ["created_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_project_string_items_created_by_user_id",
        table_name="project_string_items",
    )
    op.drop_column("project_string_items", "created_by_user_id")
    op.drop_column("project_string_items", "created_by")
