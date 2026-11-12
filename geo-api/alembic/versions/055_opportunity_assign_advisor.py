"""Add opportunities:assign_advisor and grant to Li Chenjia.

演示成员13（解决方案部）负责把商机分配给具体的解决方案成员；新权限码只授予
管理员/超级管理员（目录派生）与该用户的 user_permission_overrides。

Revision ID: 055_opportunity_assign_advisor
Revises: 054_institution_source
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "055_opportunity_assign_advisor"
down_revision: Union[str, None] = "054_institution_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LI_CHENJIA_OPEN_ID = "demo_3853685979"
PERMISSION_CODE = "opportunities:assign_advisor"


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO rbac_permissions (code, name, module, sort_order, created_at, updated_at)
            VALUES (:code, '分配商机售前顾问', 'CRM', 42, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
              name = VALUES(name), module = VALUES(module), sort_order = VALUES(sort_order)
            """
        ),
        {"code": PERMISSION_CODE},
    )
    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, :code
            FROM rbac_roles WHERE code IN ('admin', 'super_admin')
            """
        ),
        {"code": PERMISSION_CODE},
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO user_permission_overrides (user_id, permission_code, granted, created_at, updated_at)
            SELECT id, :code, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()
            FROM users WHERE feishu_open_id = :open_id
            ON DUPLICATE KEY UPDATE granted = 1
            """
        ),
        {"code": PERMISSION_CODE, "open_id": LI_CHENJIA_OPEN_ID},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE upo FROM user_permission_overrides upo
            JOIN users u ON u.id = upo.user_id
            WHERE u.feishu_open_id = :open_id AND upo.permission_code = :code
            """
        ),
        {"open_id": LI_CHENJIA_OPEN_ID, "code": PERMISSION_CODE},
    )
    conn.execute(
        sa.text("DELETE FROM rbac_role_permissions WHERE permission_code = :code"),
        {"code": PERMISSION_CODE},
    )
    conn.execute(
        sa.text("DELETE FROM rbac_permissions WHERE code = :code"),
        {"code": PERMISSION_CODE},
    )
