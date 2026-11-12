"""跟进记录绑定联系人：crm_follow_ups.contact_id / contact_name。

Revision ID: 052_followup_contact_fields
Revises: 051_customer_subsidiaries
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "052_followup_contact_fields"
down_revision: Union[str, None] = "051_customer_subsidiaries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crm_follow_ups", sa.Column("contact_id", sa.String(64), nullable=True))
    op.add_column("crm_follow_ups", sa.Column("contact_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("crm_follow_ups", "contact_name")
    op.drop_column("crm_follow_ups", "contact_id")
