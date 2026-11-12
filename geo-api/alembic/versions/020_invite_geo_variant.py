"""邀请链接国内/海外门户变体。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "020_invite_geo_variant"
down_revision = "019_release_notes"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    if not _has_column("invites", "geo_variant"):
        op.add_column(
            "invites",
            sa.Column(
                "geo_variant",
                sa.String(16),
                nullable=False,
                server_default="overseas",
            ),
        )


def downgrade() -> None:
    if _has_column("invites", "geo_variant"):
        op.drop_column("invites", "geo_variant")
