"""Add requests.target_customer for B2B/B2C intake field.

国内 / 海外需求填报新增必选字段「目标客户群体」（B端 / C端），
落库为 requests.target_customer（String(8)），旧数据为 NULL。

Revision ID: 056_request_target_customer
Revises: 055_opportunity_assign_advisor
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "056_request_target_customer"
down_revision: Union[str, None] = "055_opportunity_assign_advisor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requests", sa.Column("target_customer", sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column("requests", "target_customer")
