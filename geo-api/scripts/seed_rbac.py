#!/usr/bin/env python3
"""MySQL RBAC 种子数据（含销售、交付、市场与管理员身份角色）。

本脚本为**显式强制同步**：会覆盖系统角色权限与种子部门映射。
日常运行时权限以 MySQL 为准；geo-admin 冷启动默认不再覆盖已有系统角色。
改矩阵后请同步维护：
  - geo-admin/modules/rbac/lib/rbac-seed-data.ts
  - geo-api/app/modules/auth/permissions.py（API 回退矩阵）
  - 本文件
"""

from __future__ import annotations

import argparse
from datetime import datetime

import pymysql

PERMISSIONS: dict[str, str] = {
    "section:notifications": "访问消息通知",
    "section:home": "访问首页工作台",
    "section:leads": "访问线索管理",
    "section:public_pool": "访问公海池",
    "section:customers": "访问客户管理",
    "section:channels": "访问渠道管理",
    "section:requests": "访问需求列表",
    "section:opportunities": "访问商机管理",
    "section:contracts": "访问合同管理",
    "section:projects": "访问项目管理",
    "section:dashboard": "访问数据看板",
    "section:intake": "访问海外代客填报",
    "section:intake_cn": "访问国内代客填报",
    "section:checkin": "访问位置打卡",
    "section:settings": "访问系统设置",
    "leads:write": "编辑线索（新建/跟进/转客户）",
    "leads:create": "新建线索",
    "leads:edit": "编辑线索/跟进",
    "leads:convert": "转客户/挂靠",
    "leads:invalid": "标记无效线索",
    "lead_source_options:manage": "维护线索二级来源",
    "channels:create": "创建渠道商、商机与合同",
    "channels:write": "维护渠道档案、跟进与阶段",
    "public_pool:claim": "申请认领公海客户",
    "public_pool:review": "审批公海认领申请",
    "public_pool:release": "释放客户至公海",
    "customers:write": "编辑客户（档案/联系人/跟进）",
    "customers:create": "新建客户（自拓建档）",
    "customers:master_edit": "编辑公司主档（基本信息/子公司）",
    "customers:contact_add": "新增联系人",
    "customers:contact_edit": "编辑联系人（状态/主联系人/离职）",
    "customers:contact_assign": "改派联系人归属",
    "customers:follow_add": "添加跟进记录",
    "customers:attachment_upload": "上传附件",
    "customers:status_change": "变更客户状态/重点客户",
    "opportunities:write": "编辑商机（推进阶段/销售笔记）",
    "opportunities:create": "创建商机",
    "opportunities:stage": "推进阶段/输单/编辑商机",
    "opportunities:assign_advisor": "分配商机售前顾问",
    "contracts:write": "编辑合同（签约信息维护）",
    "contracts:create": "新建合同",
    "contracts:sign": "签约/作废/终止/编辑合同",
    "payments:view": "查看回款计划与回款管理",
    "payments:plan_manage": "维护回款计划期次与计划金额",
    "payments:finance_edit": "维护开票与实际到账信息",
    "projects:write": "编辑交付项目（阶段/健康度/记录）",
    "opportunities:advisor": "编辑商机顾问反馈",
    "checkin:view_team": "查看团队打卡记录",
    "request:view": "查看需求单",
    "request:create": "创建需求（代客填报）",
    "request:export": "导出需求单",
    "request:edit": "编辑需求信息",
    "request:change_status": "变更需求状态",
    "request:assign_owner": "分配跟进人",
    "request:add_note": "添加内部备注",
    "invite:manage": "管理自己的邀请链接",
}

REQUEST_WRITE = [
    "request:view",
    "request:create",
    "request:export",
    "request:edit",
    "request:change_status",
    "request:assign_owner",
    "request:add_note",
    "invite:manage",
]

CUSTOMER_WRITE_CODES = [
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
]

LEAD_WRITE_CODES = [
    "leads:create",
    "leads:edit",
    "leads:convert",
    "leads:invalid",
]

OPPORTUNITY_WRITE_CODES = [
    "opportunities:create",
    "opportunities:stage",
]

CONTRACT_WRITE_CODES = [
    "contracts:create",
    "contracts:sign",
]

SDR_PERMS = [
    "section:notifications",
    "section:home",
    "section:leads",
    "section:dashboard",
    *LEAD_WRITE_CODES,
]

SALES_PERMS = [
    "section:notifications",
    "section:home",
    "section:public_pool",
    "section:customers",
    "section:channels",
    "section:requests",
    "section:opportunities",
    "section:contracts",
    "section:dashboard",
    "section:intake",
    "section:intake_cn",
    "section:checkin",
    "payments:view",
    "public_pool:claim",
    "public_pool:release",
    *CUSTOMER_WRITE_CODES,
    "channels:create",
    "channels:write",
    *OPPORTUNITY_WRITE_CODES,
    *REQUEST_WRITE,
]

LEADER_PERMS = [*SALES_PERMS, "checkin:view_team", "customers:contact_assign"]

OPS_PERMS = [
    "section:notifications",
    "section:home",
    "section:leads",
    "section:public_pool",
    "section:customers",
    "section:channels",
    "section:opportunities",
    "section:contracts",
    "section:projects",
    "section:dashboard",
    "section:checkin",
    *CUSTOMER_WRITE_CODES,
    "channels:create",
    "channels:write",
    *OPPORTUNITY_WRITE_CODES,
    *CONTRACT_WRITE_CODES,
    "payments:view",
    "payments:plan_manage",
    "projects:write",
    "checkin:view_team",
    "customers:contact_assign",
    "public_pool:review",
    "public_pool:release",
]

PRESALES_PERMS = [
    "section:notifications",
    "section:home",
    "section:opportunities",
    "opportunities:advisor",
    "section:dashboard",
]

VIEWER_PERMS = [
    "section:notifications",
    "section:home",
    "section:projects",
    "projects:write",
]

# 海外运营：需求 / 商机 / 合同 / 项目 / 海外填报 / 看板（无国内填报）
OVERSEAS_PERMS = [
    "section:notifications",
    "section:home",
    "section:requests",
    "section:opportunities",
    "section:contracts",
    "section:projects",
    "section:dashboard",
    "section:intake",
    *OPPORTUNITY_WRITE_CODES,
    *CONTRACT_WRITE_CODES,
    "payments:view",
    "payments:plan_manage",
    "projects:write",
    *REQUEST_WRITE,
]

MARKETING_PERMS = [
    "section:notifications",
    "section:home",
    "section:leads",
    "section:customers",
    "section:dashboard",
]

MARKETING_LEADER_PERMS = [
    "section:notifications",
    "section:home",
    "section:leads",
    "section:customers",
    "section:requests",
    "section:opportunities",
    "section:contracts",
    "section:projects",
    "section:dashboard",
    *LEAD_WRITE_CODES,
    "request:view",
]

ADMIN_PERMS = list(PERMISSIONS.keys())  # 管理员=全目录权限，目录新增时自动同步，避免漏改清单


ROLES = [
    # 按业务链路排序：线索 → 销售推进 → Leader → 售前 → 客户成功 → 海外运营 → 运营 → 管理
    ("role_sdr", "sdr", "SDR", "", "own", SDR_PERMS),
    ("role_sales", "sales", "销售", "", "own", SALES_PERMS),
    ("role_leader", "leader", "销售 Leader", "", "department", LEADER_PERMS),
    ("role_presales", "presales", "售前顾问", "全量商机只读与顾问反馈；数据看板", "all", PRESALES_PERMS),
    ("role_viewer", "viewer", "客户成功", "", "own", VIEWER_PERMS),
    ("role_overseas", "overseas", "海外运营", "全量可见海外归属：需求/商机/合同/项目/海外填报/看板", "all", OVERSEAS_PERMS),
    ("role_ops", "ops", "销售运营", "", "all", OPS_PERMS),
    ("role_marketing", "marketing", "市场", "线索、客户与数据看板全量只读", "all", MARKETING_PERMS),
    ("role_marketing_leader", "marketing_leader", "市场负责人", "经营链路全量只读，仅线索可编辑", "all", MARKETING_LEADER_PERMS),
    ("role_admin", "admin", "管理员", "", "all", ADMIN_PERMS),
    ("role_super_admin", "super_admin", "超级管理员", "", "all", ADMIN_PERMS),
]

DEPARTMENT_RULES = [
    ("SDR", "sdr", 0),
    ("SDR组", "sdr", 1),
    ("销售拓展", "sdr", 2),
    ("销售部", "sales", 3),
    ("海外销售", "sales", 4),
    ("海外事业部", "leader", 5),
    ("销售Leader", "leader", 6),
    ("销售运营", "ops", 7),
    ("售前顾问", "presales", 8),
    ("售前", "presales", 9),
    ("客户成功", "viewer", 10),
    ("海外运营", "overseas", 11),
    ("市场", "marketing", 12),
    ("解决方案部", "presales", 13),
    ("业务运营部", "ops", 14),
]


def permission_module(code: str) -> str:
    if code.startswith("section:"):
        return "导航"
    if code.startswith(("leads:", "lead_source_options:", "customers:", "public_pool:", "opportunities:", "contracts:", "projects:")):
        return "CRM"
    prefix = code.split(":")[0]
    return {"request": "需求单", "invite": "邀请链接", "checkin": "打卡"}.get(prefix, "其他")


def sync_permission_catalog(cur) -> None:
    for sort_order, (code, name) in enumerate(PERMISSIONS.items(), start=1):
        cur.execute(
            """
            INSERT INTO rbac_permissions (code, name, module, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE name = VALUES(name), module = VALUES(module),
                                   sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)
            """,
            (code, name, permission_module(code), sort_order),
        )


def sync_identity_roles(cur) -> None:
    now = datetime.utcnow()
    for index, (role_id, code, name, description, data_scope, perms) in enumerate(ROLES, start=1):
        cur.execute("SELECT id, is_system FROM rbac_roles WHERE code = %s LIMIT 1", (code,))
        row = cur.fetchone()
        if not row:
            cur.execute(
                """
                INSERT INTO rbac_roles
                  (id, code, name, description, data_scope, is_system, sort_order, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, 1, %s, %s, %s)
                """,
                (role_id, code, name, description, data_scope, index, now, now),
            )
            rid = role_id
        else:
            rid = row[0]
            cur.execute(
                """
                UPDATE rbac_roles
                SET name = %s, description = %s, data_scope = %s, sort_order = %s,
                    is_system = 1, updated_at = %s
                WHERE id = %s
                """,
                (name, description, data_scope, index, now, rid),
            )
        cur.execute("DELETE FROM rbac_role_permissions WHERE role_id = %s", (rid,))
        for perm in perms:
            cur.execute(
                "INSERT INTO rbac_role_permissions (role_id, permission_code) VALUES (%s, %s)",
                (rid, perm),
            )

    cur.execute(
        """
        INSERT IGNORE INTO rbac_role_permissions (role_id, permission_code)
        SELECT r.id, 'checkin:view_team'
        FROM rbac_roles r
        INNER JOIN rbac_role_permissions rp ON rp.role_id = r.id AND rp.permission_code = 'section:checkin'
        WHERE r.data_scope IN ('department', 'all') AND r.is_system = 1
        """
    )
    cur.execute(
        """
        UPDATE rbac_roles
        SET data_scope = 'all', updated_at = UTC_TIMESTAMP()
        WHERE code IN ('admin', 'super_admin', 'ops') AND data_scope <> 'all'
        """
    )


def sync_department_rules(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rbac_department_rules (
          department_name VARCHAR(191) NOT NULL,
          role_code VARCHAR(64) NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          PRIMARY KEY (department_name, role_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    for department_name, role_code, sort_order in DEPARTMENT_RULES:
        cur.execute("DELETE FROM rbac_department_rules WHERE department_name = %s", (department_name,))
        cur.execute(
            """
            INSERT INTO rbac_department_rules (department_name, role_code, sort_order)
            VALUES (%s, %s, %s)
            """,
            (department_name, role_code, sort_order),
        )


def connect():
    import os

    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "geo_app"),
        password=os.environ.get("MYSQL_PASSWORD", "geo_dev_local"),
        database=os.environ.get("MYSQL_DATABASE", "geo_crm"),
        charset="utf8mb4",
        autocommit=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sync-permissions", action="store_true", help="同步权限目录 + 身份角色 + 部门规则")
    args = parser.parse_args()

    conn = connect()
    try:
        with conn.cursor() as cur:
            if args.sync_permissions:
                sync_permission_catalog(cur)
                sync_identity_roles(cur)
                sync_department_rules(cur)
                conn.commit()
                print(f"RBAC identity roles synced: {len(ROLES)} roles, {len(PERMISSIONS)} permissions")
                return

            # 空库全量种子
            cur.execute("SELECT COUNT(*) FROM rbac_permissions")
            if cur.fetchone()[0] == 0:
                sync_permission_catalog(cur)
            else:
                sync_permission_catalog(cur)

            cur.execute("SELECT COUNT(*) FROM rbac_roles")
            if cur.fetchone()[0] == 0:
                sync_identity_roles(cur)
            else:
                sync_identity_roles(cur)

            sync_department_rules(cur)
            conn.commit()
            print(f"RBAC seeded: {len(PERMISSIONS)} permissions, {len(ROLES)} roles")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
