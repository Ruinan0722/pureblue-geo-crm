"""feishu contact job title column

Revision ID: 004_feishu_contact_title
Revises: 003_rbac
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_feishu_contact_title"
down_revision: Union[str, None] = "003_rbac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("feishu_sales_contacts", sa.Column("job_title", sa.String(128), nullable=True))
    op.add_column("feishu_sales_contacts", sa.Column("department_names", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("feishu_sales_contacts", "department_names")
    op.drop_column("feishu_sales_contacts", "job_title")
