"""邀请链接改为每人固定国内/海外各一条：新增 is_fixed 标记，存量链接作废。

Revision ID: 040_fixed_invites
Revises: 041_opportunity_notes
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "040_fixed_invites"
down_revision: Union[str, None] = "041_opportunity_notes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invites",
        sa.Column(
            "is_fixed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    # 产品决策：每人只保留国内/海外各一条固定链接；存量手工生成的链接全部作废，
    # 新固定链接由服务端按确定性 token 自动配发。
    op.execute(sa.text("UPDATE invites SET revoked_at = NOW() WHERE is_fixed = 0"))
    op.alter_column("invites", "is_fixed", server_default=None)


def downgrade() -> None:
    op.drop_column("invites", "is_fixed")
