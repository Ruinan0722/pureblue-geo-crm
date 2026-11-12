"""海外需求国家语言关联 AI 平台。

Revision ID: 066_request_platform_regions
Revises: 065_proj_status_simplify
"""

import sqlalchemy as sa
from alembic import op


revision = "066_request_platform_regions"
down_revision = "065_proj_status_simplify"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("request_regions", sa.Column("platform", sa.String(length=64), nullable=True))
    op.execute(
        "UPDATE request_regions rr SET platform = COALESCE(("
        "SELECT li.value FROM request_list_items li "
        "WHERE li.request_id = rr.request_id AND li.kind = 'platforms' "
        "ORDER BY li.sort_order LIMIT 1"
        "), 'ChatGPT')"
    )
    op.drop_constraint("uq_request_regions_country", "request_regions", type_="unique")
    op.create_unique_constraint(
        "uq_request_regions_platform_locale",
        "request_regions",
        ["request_id", "platform", "country", "language"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_request_regions_platform_locale", "request_regions", type_="unique")
    op.create_unique_constraint(
        "uq_request_regions_country", "request_regions", ["request_id", "country"]
    )
    op.drop_column("request_regions", "platform")
