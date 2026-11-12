"""add checkin:view_team permission and grant to admin roles

Revision ID: 009_checkin_view_team
Revises: 008_schema_hardening
Create Date: 2026-07-13
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_checkin_view_team"
down_revision: Union[str, None] = "008_schema_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO rbac_permissions (code, name, module, sort_order)
            VALUES ('checkin:view_team', '查看团队打卡记录', '打卡', 5)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              module = VALUES(module),
              sort_order = VALUES(sort_order)
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, 'checkin:view_team' FROM rbac_roles WHERE code IN ('admin', 'super_admin')
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, 'invite:view_all' FROM rbac_roles WHERE code = 'super_admin'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT r.id, 'checkin:view_team'
            FROM rbac_roles r
            INNER JOIN rbac_role_permissions rp
              ON rp.role_id = r.id AND rp.permission_code = 'section:checkin'
            WHERE r.data_scope IN ('department', 'all')
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM rbac_role_permissions WHERE permission_code = 'checkin:view_team'"
        )
    )
    conn.execute(sa.text("DELETE FROM rbac_permissions WHERE code = 'checkin:view_team'"))
