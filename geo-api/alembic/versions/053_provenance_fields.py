"""跟进/附件溯源字段：origin 与 source_*。

Revision ID: 053_provenance_fields
Revises: 052_followup_contact_fields
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "053_provenance_fields"
down_revision: Union[str, None] = "052_followup_contact_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crm_follow_ups", sa.Column("origin", sa.String(32), nullable=True))
    op.add_column("crm_follow_ups", sa.Column("source_lead_id", sa.String(36), nullable=True))
    op.add_column("crm_follow_ups", sa.Column("source_lead_note_id", sa.String(64), nullable=True))

    op.add_column("crm_attachments", sa.Column("origin", sa.String(32), nullable=True))
    op.add_column("crm_attachments", sa.Column("source_lead_id", sa.String(36), nullable=True))
    op.add_column(
        "crm_attachments", sa.Column("source_lead_attachment_id", sa.String(64), nullable=True)
    )
    op.add_column("crm_attachments", sa.Column("source_request_id", sa.String(36), nullable=True))
    op.add_column(
        "crm_attachments",
        sa.Column("source_request_attachment_id", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("crm_attachments", "source_request_attachment_id")
    op.drop_column("crm_attachments", "source_request_id")
    op.drop_column("crm_attachments", "source_lead_attachment_id")
    op.drop_column("crm_attachments", "source_lead_id")
    op.drop_column("crm_attachments", "origin")
    op.drop_column("crm_follow_ups", "source_lead_note_id")
    op.drop_column("crm_follow_ups", "source_lead_id")
    op.drop_column("crm_follow_ups", "origin")
