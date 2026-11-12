"""release_notes

Revision ID: 019_release_notes
Revises: 018_projects
Create Date: 2026-07-27
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019_release_notes"
down_revision: Union[str, None] = "018_projects"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "release_notes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("version", name="uq_release_notes_version"),
    )
    op.create_index("ix_release_notes_version", "release_notes", ["version"])


def downgrade() -> None:
    op.drop_index("ix_release_notes_version", table_name="release_notes")
    op.drop_table("release_notes")
