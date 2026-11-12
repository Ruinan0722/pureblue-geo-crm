"""Replace SDR customer navigation with dashboard access.

Revision ID: 030_sdr_dashboard
Revises: 029_lead_source_meeting
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "030_sdr_dashboard"
down_revision: Union[str, None] = "029_lead_source_meeting"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE rp FROM rbac_role_permissions rp
            JOIN rbac_roles r ON r.id = rp.role_id
            WHERE r.code = 'sdr' AND rp.permission_code = 'section:customers'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, 'section:dashboard' FROM rbac_roles WHERE code = 'sdr'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE rbac_roles
            SET description = '线索管理与数据看板；不开放客户管理',
                updated_at = UTC_TIMESTAMP()
            WHERE code = 'sdr'
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE rp FROM rbac_role_permissions rp
            JOIN rbac_roles r ON r.id = rp.role_id
            WHERE r.code = 'sdr' AND rp.permission_code = 'section:dashboard'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, 'section:customers' FROM rbac_roles WHERE code = 'sdr'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE rbac_roles SET description = '', updated_at = UTC_TIMESTAMP()
            WHERE code = 'sdr'
            """
        )
    )
