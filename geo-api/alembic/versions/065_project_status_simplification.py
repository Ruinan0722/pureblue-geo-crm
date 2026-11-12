"""项目状态收敛为待执行、执行中、已完成、暂停。

Revision ID: 065_project_status_simplification
Revises: 064_backfill_project_office
"""

from alembic import op


revision = "065_proj_status_simplify"
down_revision = "064_backfill_project_office"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 延期与续约由日期、风险、健康度表达，不再占用项目主状态。
    op.execute("UPDATE projects SET stage = 'active' WHERE stage IN ('delayed', 'renewal')")


def downgrade() -> None:
    # 无法可靠区分哪些 active 曾为延期或续约，不做有损回滚。
    pass
