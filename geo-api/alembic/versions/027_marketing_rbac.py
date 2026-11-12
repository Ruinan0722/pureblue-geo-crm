"""Add marketing roles and Xueying lead-source option permission.

Revision ID: 027_marketing_rbac
Revises: 026_mark_download_retry
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027_marketing_rbac"
down_revision: Union[str, None] = "026_mark_download_retry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LI_MING_OPEN_ID = "demo_1663907922"
LV_XUEYING_OPEN_ID = "demo_914816393"

MARKETING_PERMISSIONS = (
    "section:notifications",
    "section:home",
    "section:leads",
    "section:customers",
    "section:dashboard",
)

MARKETING_LEADER_PERMISSIONS = (
    "section:notifications",
    "section:home",
    "section:leads",
    "section:customers",
    "section:requests",
    "section:opportunities",
    "section:contracts",
    "section:projects",
    "section:dashboard",
    "leads:write",
    "request:view",
)

# Production databases created by the early RBAC migrations may have only the
# permissions that were explicitly seeded at runtime.  Migration 027 must not
# assume the complete fallback catalog is already present before it creates the
# marketing role relations, otherwise the FK on permission_code aborts the
# cumulative 011 -> head upgrade.
REFERENCED_PERMISSION_CATALOG = {
    "section:notifications": ("通知", "导航", 1),
    "section:home": ("首页", "导航", 2),
    "section:leads": ("线索", "导航", 3),
    "section:customers": ("客户", "导航", 4),
    "section:requests": ("需求", "导航", 5),
    "section:opportunities": ("商机", "导航", 6),
    "section:contracts": ("合同", "导航", 7),
    "section:projects": ("项目", "导航", 8),
    "section:dashboard": ("数据看板", "导航", 9),
    "leads:write": ("编辑线索", "CRM", 20),
    "request:view": ("查看需求", "需求", 30),
    "lead_source_options:manage": ("维护线索二级来源", "CRM", 26),
}


def _ensure_referenced_permissions(conn: sa.Connection) -> None:
    for code, (name, module, sort_order) in REFERENCED_PERMISSION_CATALOG.items():
        conn.execute(
            sa.text(
                """
                INSERT INTO rbac_permissions (code, name, module, sort_order)
                VALUES (:code, :name, :module, :sort_order)
                ON DUPLICATE KEY UPDATE code = VALUES(code)
                """
            ),
            {"code": code, "name": name, "module": module, "sort_order": sort_order},
        )


def _replace_role_permissions(conn: sa.Connection, role_code: str, permissions: tuple[str, ...]) -> None:
    conn.execute(
        sa.text(
            "DELETE rp FROM rbac_role_permissions rp "
            "JOIN rbac_roles r ON r.id = rp.role_id WHERE r.code = :role_code"
        ),
        {"role_code": role_code},
    )
    for permission in permissions:
        conn.execute(
            sa.text(
                """
                INSERT INTO rbac_role_permissions (role_id, permission_code)
                SELECT id, :permission FROM rbac_roles WHERE code = :role_code
                """
            ),
            {"role_code": role_code, "permission": permission},
        )


def _assign_locked_role(conn: sa.Connection, open_id: str, role_code: str) -> None:
    conn.execute(
        sa.text(
            """
            DELETE ura FROM user_role_assignments ura
            JOIN users u ON u.id = ura.user_id
            WHERE u.feishu_open_id = :open_id
            """
        ),
        {"open_id": open_id},
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO user_role_assignments (user_id, role_id, is_primary, assigned_at)
            SELECT u.id, r.id, 1, UTC_TIMESTAMP()
            FROM users u JOIN rbac_roles r ON r.code = :role_code
            WHERE u.feishu_open_id = :open_id
            """
        ),
        {"open_id": open_id, "role_code": role_code},
    )
    conn.execute(
        sa.text(
            """
            UPDATE users
            SET role = :role_code, role_source = 'manual', role_locked = 1,
                data_scope_override = NULL, updated_at = UTC_TIMESTAMP()
            WHERE feishu_open_id = :open_id
            """
        ),
        {"open_id": open_id, "role_code": role_code},
    )


def upgrade() -> None:
    conn = op.get_bind()
    _ensure_referenced_permissions(conn)
    conn.execute(
        sa.text(
            """
            INSERT INTO rbac_roles
              (id, code, name, description, data_scope, is_system, sort_order, created_at, updated_at)
            VALUES
              ('role_marketing', 'marketing', '市场', '线索、客户与数据看板全量只读', 'all', 1, 9, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
              ('role_marketing_leader', 'marketing_leader', '市场负责人', '经营链路全量只读，仅线索可编辑', 'all', 1, 10, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
              name = VALUES(name), description = VALUES(description), data_scope = VALUES(data_scope),
              is_system = 1, sort_order = VALUES(sort_order), updated_at = UTC_TIMESTAMP()
            """
        )
    )

    _replace_role_permissions(conn, "marketing", MARKETING_PERMISSIONS)
    _replace_role_permissions(conn, "marketing_leader", MARKETING_LEADER_PERMISSIONS)

    conn.execute(
        sa.text(
            """
            INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
            SELECT id, 'lead_source_options:manage'
            FROM rbac_roles WHERE code IN ('admin', 'super_admin')
            """
        )
    )
    conn.execute(
        sa.text(
            """
            DELETE FROM rbac_department_rules WHERE department_name = '市场'
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO rbac_department_rules (department_name, role_code, sort_order)
            VALUES ('市场', 'marketing', 12)
            """
        )
    )

    _assign_locked_role(conn, LI_MING_OPEN_ID, "marketing_leader")
    _assign_locked_role(conn, LV_XUEYING_OPEN_ID, "marketing")
    conn.execute(
        sa.text(
            """
            INSERT INTO user_permission_overrides (user_id, permission_code, granted)
            SELECT id, 'lead_source_options:manage', 1
            FROM users WHERE feishu_open_id = :open_id
            ON DUPLICATE KEY UPDATE granted = 1
            """
        ),
        {"open_id": LV_XUEYING_OPEN_ID},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE upo FROM user_permission_overrides upo
            JOIN users u ON u.id = upo.user_id
            WHERE u.feishu_open_id = :open_id
              AND upo.permission_code = 'lead_source_options:manage'
            """
        ),
        {"open_id": LV_XUEYING_OPEN_ID},
    )
    _assign_locked_role(conn, LI_MING_OPEN_ID, "leader")
    _assign_locked_role(conn, LV_XUEYING_OPEN_ID, "viewer")
    conn.execute(
        sa.text(
            """
            UPDATE users SET role_source = 'feishu', role_locked = 0, updated_at = UTC_TIMESTAMP()
            WHERE feishu_open_id IN (:li_ming, :xueying)
            """
        ),
        {"li_ming": LI_MING_OPEN_ID, "xueying": LV_XUEYING_OPEN_ID},
    )
    conn.execute(sa.text("DELETE FROM rbac_department_rules WHERE department_name = '市场' AND role_code = 'marketing'"))
    conn.execute(sa.text("DELETE FROM rbac_roles WHERE code IN ('marketing', 'marketing_leader')"))
    conn.execute(sa.text("DELETE FROM rbac_role_permissions WHERE permission_code = 'lead_source_options:manage'"))
    conn.execute(sa.text("DELETE FROM rbac_permissions WHERE code = 'lead_source_options:manage'"))
