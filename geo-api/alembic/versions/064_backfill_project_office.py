"""回填历史项目交付地点。

Revision ID: 064_backfill_project_office
Revises: 063_project_planned_start
"""

from alembic import op


revision = "064_backfill_project_office"
down_revision = "063_project_planned_start"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE projects SET office = '北京' "
        "WHERE (office IS NULL OR office = '') AND customer_region LIKE '%北京%'"
    )
    op.execute(
        "UPDATE projects SET office = '厦门' "
        "WHERE (office IS NULL OR office = '') AND customer_region LIKE '%厦门%'"
    )


def downgrade() -> None:
    # 仅补齐空值，不在降级时清除用户后续维护过的交付地点。
    pass
