"""widen checkin_records.timestamp for millisecond epoch values

Revision ID: 007_checkin_ts_bigint
Revises: 006_checkin_records
Create Date: 2026-07-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_checkin_ts_bigint"
down_revision: Union[str, None] = "006_checkin_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "checkin_records",
        "timestamp",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "checkin_records",
        "timestamp",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
