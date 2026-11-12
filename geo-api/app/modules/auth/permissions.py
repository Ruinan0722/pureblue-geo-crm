from typing import Literal

BuiltinStaffRole = Literal[
    "sdr",
    "sales",
    "leader",
    "ops",
    "presales",
    "viewer",
    "overseas",
    "marketing",
    "marketing_leader",
    "admin",
    "super_admin",
]
# 内置角色 + 数据库自定义角色 code
StaffRole = str
DataScope = Literal["own", "department", "all"]
Permission = Literal[
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
    "section:intake",
    "section:intake_cn",
    "section:requests",
    "section:checkin",
    "section:settings",
    "leads:write",
    "leads:create",
    "leads:edit",
    "leads:convert",
    "leads:invalid",
    "lead_source_options:manage",
    "channels:create",
    "channels:write",
    "customers:write",
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:contact_assign",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
    "opportunities:write",
    "opportunities:create",
    "opportunities:stage",
    "opportunities:assign_advisor",
    "contracts:write",
    "contracts:create",
    "contracts:sign",
    "payments:view",
    "payments:plan_manage",
    "payments:finance_edit",
    "projects:write",
    "opportunities:advisor",
    "checkin:view_team",
    "request:view",
    "request:create",
    "request:export",
    "request:edit",
    "request:change_status",
    "request:assign_owner",
    "request:add_note",
    "invite:manage",
]

PERMISSION_CATALOG: tuple[Permission, ...] = (
    "section:notifications",
    "section:home",
    "section:leads",
    "section:public_pool",
    "section:customers",
    "section:channels",
    "section:requests",
    "section:opportunities",
    "section:contracts",
    "section:projects",
    "section:dashboard",
    "section:intake",
    "section:intake_cn",
    "section:checkin",
    "section:settings",
    "leads:write",
    "leads:create",
    "leads:edit",
    "leads:convert",
    "leads:invalid",
    "customers:write",
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:contact_assign",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
    "opportunities:write",
    "opportunities:create",
    "opportunities:stage",
    "opportunities:assign_advisor",
    "contracts:write",
    "contracts:create",
    "contracts:sign",
    "payments:view",
    "payments:plan_manage",
    "payments:finance_edit",
    "projects:write",
    "opportunities:advisor",
    "lead_source_options:manage",
    "channels:create",
    "channels:write",
    "public_pool:claim",
    "public_pool:review",
    "public_pool:release",
    "checkin:view_team",
    "request:view",
    "request:create",
    "request:export",
    "request:edit",
    "request:change_status",
    "request:assign_owner",
    "request:add_note",
    "invite:manage",
)

REQUEST_WRITE: tuple[Permission, ...] = (
    "request:view",
    "request:create",
    "request:export",
    "request:edit",
    "request:change_status",
    "request:assign_owner",
    "request:add_note",
    "invite:manage",
)

CUSTOMER_WRITE_CODES: tuple[Permission, ...] = (
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
)

LEAD_WRITE_CODES: tuple[Permission, ...] = (
    "leads:create",
    "leads:edit",
    "leads:convert",
    "leads:invalid",
)

OPPORTUNITY_WRITE_CODES: tuple[Permission, ...] = (
    "opportunities:create",
    "opportunities:stage",
)

CONTRACT_WRITE_CODES: tuple[Permission, ...] = (
    "contracts:create",
    "contracts:sign",
)

SDR_PERMISSIONS: tuple[Permission, ...] = (
    "section:notifications",
    "section:home",
    "section:leads",
    "section:dashboard",
    *LEAD_WRITE_CODES,
)

SALES_PERMISSIONS: tuple[Permission, ...] = (
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
)

LEADER_PERMISSIONS: tuple[Permission, ...] = (
    *SALES_PERMISSIONS,
    "checkin:view_team",
    "customers:contact_assign",
)

OPS_PERMISSIONS: tuple[Permission, ...] = (
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
)

PRESALES_PERMISSIONS: tuple[Permission, ...] = (
    "section:notifications",
    "section:home",
    "section:opportunities",
    "opportunities:advisor",
    "section:dashboard",
)

VIEWER_PERMISSIONS: tuple[Permission, ...] = (
    "section:notifications",
    "section:home",
    "section:projects",
    "projects:write",
)

# 海外运营：需求 / 商机 / 合同 / 项目 / 海外填报 / 看板（可读可写）；无国内填报、无线索与客户
OVERSEAS_PERMISSIONS: tuple[Permission, ...] = (
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
)

MARKETING_PERMISSIONS: tuple[Permission, ...] = (
    "section:notifications",
    "section:home",
    "section:leads",
    "section:customers",
    "section:dashboard",
)

MARKETING_LEADER_PERMISSIONS: tuple[Permission, ...] = (
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
)

# 管理员/超级管理员 = 全目录权限（由 PERMISSION_CATALOG 派生，禁止按角色硬编码清单，
# 保证新增细粒度权限码时管理员自动拥有；test_rbac_seed_alignment 会钉死与 seed 目录一致）
ALL_PERMISSIONS: tuple[Permission, ...] = PERMISSION_CATALOG


ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "sdr": SDR_PERMISSIONS,
    "sales": SALES_PERMISSIONS,
    "leader": LEADER_PERMISSIONS,
    "ops": OPS_PERMISSIONS,
    "presales": PRESALES_PERMISSIONS,
    "viewer": VIEWER_PERMISSIONS,
    "overseas": OVERSEAS_PERMISSIONS,
    "marketing": MARKETING_PERMISSIONS,
    "marketing_leader": MARKETING_LEADER_PERMISSIONS,
    "admin": ALL_PERMISSIONS,
    "super_admin": ALL_PERMISSIONS,
}

ROLE_DATA_SCOPE: dict[str, DataScope] = {
    "sdr": "own",
    "sales": "own",
    "leader": "department",
    "ops": "all",
    "presales": "all",
    "viewer": "own",
    # 海外运营：全量数据范围 + 模块内强制仅海外归属（见 geo_scope.forced_geo_source）
    "overseas": "all",
    "marketing": "all",
    "marketing_leader": "all",
    "admin": "all",
    "super_admin": "all",
}


def normalize_role(raw: str) -> str:
    if raw == "staff":
        return "sales"
    return raw


def role_has_permission(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, ())


def get_data_scope(role: str) -> DataScope:
    return ROLE_DATA_SCOPE.get(role, "own")
