"""Mark integration records, events and PDF files.

Revision ID: 024_mark_integration
Revises: 023_crm_sales_coverages
Create Date: 2026-08-04
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "024_mark_integration"
down_revision: Union[str, None] = "023_crm_sales_coverages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mark_integration_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("platform", sa.String(32), nullable=False, server_default="mark"),
        sa.Column("external_record_id", sa.String(128), nullable=False),
        sa.Column("crm_request_id", sa.String(36), nullable=False),
        sa.Column("last_event_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.UniqueConstraint("platform", "external_record_id", name="uk_mark_record_external"),
        sa.Index("idx_mark_record_external", "external_record_id"),
        sa.Index("idx_mark_record_request", "crm_request_id"),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "mark_integration_nonces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("platform", sa.String(32), nullable=False, server_default="mark"),
        sa.Column("nonce", sa.String(128), nullable=False),
        sa.Column("request_timestamp", sa.DateTime(timezone=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.UniqueConstraint("platform", "nonce", name="uk_mark_nonce_platform_nonce"),
        sa.Index("idx_mark_nonce_created", "created_at"),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "mark_integration_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("platform", sa.String(32), nullable=False, server_default="mark"),
        sa.Column("event_id", sa.String(64), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("external_record_id", sa.String(128), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("process_status", sa.String(32), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=False), nullable=True),
        sa.UniqueConstraint("platform", "event_id", name="uk_mark_event_platform_event"),
        sa.Index("idx_mark_event_id", "event_id"),
        sa.Index("idx_mark_event_external", "external_record_id"),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "mark_integration_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("platform", sa.String(32), nullable=False, server_default="mark"),
        sa.Column("external_record_id", sa.String(128), nullable=False),
        sa.Column("crm_request_id", sa.String(36), nullable=False),
        sa.Column("external_file_id", sa.String(128), nullable=False),
        sa.Column("file_version", sa.String(32), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("url_expires_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("expected_size", sa.BigInteger(), nullable=True),
        sa.Column("expected_checksum", sa.String(64), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("checksum", sa.String(64), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("remark", sa.String(500), nullable=True),
        sa.Column("download_status", sa.String(32), nullable=False, server_default="pending_download"),
        sa.Column("failure_reason", sa.String(500), nullable=True),
        sa.Column("download_attempts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint(
            "platform", "external_record_id", "file_version", name="uk_mark_file_version"
        ),
        sa.Index("idx_mark_file_external", "external_record_id"),
        sa.Index("idx_mark_file_request", "crm_request_id"),
        sa.Index("idx_mark_file_external_file", "external_file_id"),
        sa.Index("idx_mark_file_current", "is_current"),
        sa.Index("idx_mark_file_status", "download_status"),
        mysql_charset="utf8mb4",
    )


def downgrade() -> None:
    op.drop_table("mark_integration_files")
    op.drop_table("mark_integration_events")
    op.drop_table("mark_integration_nonces")
    op.drop_table("mark_integration_records")
