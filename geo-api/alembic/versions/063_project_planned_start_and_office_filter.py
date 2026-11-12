"""项目计划启动时间。

Revision ID: 063_project_planned_start
Revises: 062_project_ops
"""

from alembic import op
import sqlalchemy as sa


revision = "063_project_planned_start"
down_revision = "062_project_ops"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("planned_start_date", sa.Date(), nullable=True))
    # 历史项目没有区分两个日期时，用既有启动时间承接，避免列表出现空白。
    op.execute("UPDATE projects SET planned_start_date = start_date WHERE start_date IS NOT NULL")


def downgrade() -> None:
    op.drop_column("projects", "planned_start_date")
