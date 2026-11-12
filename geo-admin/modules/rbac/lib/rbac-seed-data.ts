/**
 * 数据库首次初始化用的种子数据（仅服务端引用，勿导出到客户端）。
 * 运行期以数据库 rbac_permissions 为唯一数据源；身份角色（is_system）会按本文件对齐权限。
 *
 * 身份角色对齐原型：SDR / 销售 / Leader / 运营 / 售前 / 客户成功(viewer) / 海外运营 / 管理员
 */
import type { DataScope } from "@/modules/auth/lib/permissions"

export interface SeedPermission {
  code: string
  name: string
  module: string
  sortOrder: number
  /** 矩阵分组说明（可选，展示在分类标题下） */
  moduleHint?: string
}

/** 角色权限矩阵中的分类顺序（数据范围在 UI 中单独展示，不在此列） */
export const PERMISSION_MODULE_ORDER = ["导航", "CRM", "打卡", "需求单", "邀请链接", "系统"] as const

export interface SeedRole {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScope
  permissions: string[]
}

export interface SeedDepartmentRule {
  departmentName: string
  roleCode: string
  sortOrder: number
}

/** 系统身份角色 code：启动时会按种子对齐权限（不覆盖自定义非系统角色） */
export const IDENTITY_ROLE_CODES = [
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
] as const

export const INITIAL_PERMISSIONS: SeedPermission[] = [
  { code: "section:notifications", name: "访问消息通知", module: "导航", sortOrder: 0 },
  { code: "section:home", name: "访问首页工作台", module: "导航", sortOrder: 1 },
  { code: "section:leads", name: "访问线索管理", module: "导航", sortOrder: 2 },
  { code: "section:public_pool", name: "访问公海池", module: "导航", sortOrder: 3 },
  { code: "section:customers", name: "访问客户管理", module: "导航", sortOrder: 3 },
  { code: "section:channels", name: "访问渠道管理", module: "导航", sortOrder: 4 },
  { code: "section:requests", name: "访问需求列表", module: "导航", sortOrder: 4 },
  { code: "section:opportunities", name: "访问商机管理", module: "导航", sortOrder: 5 },
  { code: "section:contracts", name: "访问合同管理", module: "导航", sortOrder: 6 },
  { code: "section:projects", name: "访问项目管理", module: "导航", sortOrder: 7 },
  { code: "section:dashboard", name: "访问数据看板", module: "导航", sortOrder: 8 },
  { code: "section:intake", name: "访问海外代客填报", module: "导航", sortOrder: 9 },
  { code: "section:intake_cn", name: "访问国内代客填报", module: "导航", sortOrder: 10 },
  { code: "section:checkin", name: "访问位置打卡", module: "导航", sortOrder: 11 },
  { code: "section:settings", name: "访问系统设置", module: "导航", sortOrder: 12 },
  {
    code: "leads:write",
    name: "编辑线索（新建/跟进/转客户）",
    module: "CRM",
    sortOrder: 20,
  },
  {
    code: "leads:create",
    name: "新建线索",
    module: "CRM",
    sortOrder: 34,
  },
  {
    code: "leads:edit",
    name: "编辑线索/跟进",
    module: "CRM",
    sortOrder: 35,
  },
  {
    code: "leads:convert",
    name: "转客户/挂靠",
    module: "CRM",
    sortOrder: 36,
  },
  {
    code: "leads:invalid",
    name: "标记无效线索",
    module: "CRM",
    sortOrder: 37,
  },
  {
    code: "lead_source_options:manage",
    name: "维护线索二级来源",
    module: "CRM",
    sortOrder: 26,
    moduleHint: "仅允许维护二级来源选项，不授予具体线索的编辑权限",
  },
  { code: "channels:create", name: "创建渠道伙伴、商机与合同", module: "CRM", sortOrder: 46 },
  { code: "channels:write", name: "维护渠道档案、联系人、跟进与阶段", module: "CRM", sortOrder: 47 },
  {
    code: "public_pool:claim",
    name: "申请认领公海客户",
    module: "CRM",
    sortOrder: 42,
  },
  {
    code: "public_pool:review",
    name: "审批公海认领申请",
    module: "CRM",
    sortOrder: 43,
  },
  {
    code: "public_pool:release",
    name: "释放客户至公海",
    module: "CRM",
    sortOrder: 44,
  },
  {
    code: "customers:write",
    name: "编辑客户（档案/联系人/跟进）",
    module: "CRM",
    sortOrder: 21,
    moduleHint: "遗留总写码：细粒度权限未覆盖的操作兜底，通常不与下列 customers:* 细码同时授予",
  },
  {
    code: "customers:create",
    name: "新建客户（自拓建档）",
    module: "CRM",
    sortOrder: 27,
  },
  {
    code: "customers:master_edit",
    name: "编辑公司主档（基本信息/子公司）",
    module: "CRM",
    sortOrder: 28,
  },
  {
    code: "customers:contact_add",
    name: "新增联系人",
    module: "CRM",
    sortOrder: 29,
  },
  {
    code: "customers:contact_edit",
    name: "编辑联系人（状态/主联系人/离职）",
    module: "CRM",
    sortOrder: 30,
  },
  {
    code: "customers:contact_assign",
    name: "改派联系人归属",
    module: "CRM",
    sortOrder: 31,
  },
  {
    code: "customers:follow_add",
    name: "添加跟进记录",
    module: "CRM",
    sortOrder: 32,
  },
  {
    code: "customers:attachment_upload",
    name: "上传附件",
    module: "CRM",
    sortOrder: 33,
  },
  {
    code: "customers:status_change",
    name: "变更客户状态/重点客户",
    module: "CRM",
    sortOrder: 34,
  },
  {
    code: "opportunities:write",
    name: "编辑商机（推进阶段/销售笔记）",
    module: "CRM",
    sortOrder: 22,
  },
  {
    code: "opportunities:create",
    name: "创建商机",
    module: "CRM",
    sortOrder: 38,
  },
  {
    code: "opportunities:stage",
    name: "推进阶段/输单/编辑商机",
    module: "CRM",
    sortOrder: 39,
  },
  {
    code: "contracts:write",
    name: "编辑合同（签约信息维护）",
    module: "CRM",
    sortOrder: 23,
  },
  {
    code: "contracts:create",
    name: "新建合同",
    module: "CRM",
    sortOrder: 40,
  },
  {
    code: "contracts:sign",
    name: "签约/作废/终止/编辑合同",
    module: "CRM",
    sortOrder: 41,
  },
  {
    code: "payments:view",
    name: "查看回款计划与回款管理",
    module: "CRM",
    sortOrder: 43,
  },
  {
    code: "payments:plan_manage",
    name: "维护回款计划期次与计划金额",
    module: "CRM",
    sortOrder: 44,
  },
  {
    code: "payments:finance_edit",
    name: "维护开票与实际到账信息",
    module: "CRM",
    sortOrder: 45,
    moduleHint: "销售只读；财务维护开票/到账，销售运营维护计划，管理员默认拥有全部权限",
  },
  {
    code: "projects:write",
    name: "编辑交付项目（阶段/人员/记录）",
    module: "CRM",
    sortOrder: 24,
  },
  {
    code: "opportunities:advisor",
    name: "编辑商机顾问反馈",
    module: "CRM",
    sortOrder: 25,
    moduleHint: "售前顾问可在只读商机上补充顾问反馈；管理员亦默认具备",
  },
  {
    code: "opportunities:assign_advisor",
    name: "分配商机售前顾问",
    module: "CRM",
    sortOrder: 42,
    moduleHint: "可将商机分配给具体的解决方案部成员；通常仅授予负责分配的人员",
  },
  {
    code: "checkin:view_team",
    name: "查看团队打卡记录",
    module: "打卡",
    sortOrder: 30,
    moduleHint: "在位置打卡页显示「团队记录」标签；通常与「可见数据范围」一并配置（部门 / 全部）",
  },
  { code: "request:view", name: "查看需求单", module: "需求单", sortOrder: 40 },
  { code: "request:create", name: "创建需求（代客填报）", module: "需求单", sortOrder: 41 },
  { code: "request:export", name: "导出需求单", module: "需求单", sortOrder: 42 },
  { code: "request:edit", name: "编辑需求信息", module: "需求单", sortOrder: 43 },
  { code: "request:change_status", name: "变更需求状态", module: "需求单", sortOrder: 44 },
  { code: "request:assign_owner", name: "分配跟进人", module: "需求单", sortOrder: 45 },
  { code: "request:add_note", name: "添加内部备注", module: "需求单", sortOrder: 46 },
  { code: "invite:manage", name: "管理自己的邀请链接", module: "邀请链接", sortOrder: 51 },
]

/** 按分类分组，供矩阵 UI 使用 */
export interface CatalogPermissionRow {
  code: string
  name: string
  module: string
  sort_order: number
}

export function groupPermissionsByModule(
  permissions: CatalogPermissionRow[],
): { module: string; hint?: string; permissions: CatalogPermissionRow[] }[] {
  const byModule = new Map<string, CatalogPermissionRow[]>()
  for (const p of permissions) {
    const mod = p.module || "其他"
    if (!byModule.has(mod)) byModule.set(mod, [])
    byModule.get(mod)!.push(p)
  }
  const ordered = [
    ...PERMISSION_MODULE_ORDER,
    ...[...byModule.keys()].filter((m) => !PERMISSION_MODULE_ORDER.includes(m as (typeof PERMISSION_MODULE_ORDER)[number])),
  ]
  const hintByModule = new Map(INITIAL_PERMISSIONS.filter((p) => p.moduleHint).map((p) => [p.module, p.moduleHint!]))
  return ordered
    .filter((mod) => byModule.has(mod))
    .map((module) => ({
      module,
      hint: hintByModule.get(module),
      permissions: byModule.get(module)!.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)),
    }))
}

const requestWritePerms = [
  "request:view",
  "request:create",
  "request:export",
  "request:edit",
  "request:change_status",
  "request:assign_owner",
  "request:add_note",
  "invite:manage",
]

/** SDR：线索主路径 + 首页工作台 + 数据看板；不开放客户管理 */
const sdrPermissions = [
  "section:notifications",
  "section:home",
  "section:leads",
  "section:dashboard",
  "leads:create",
  "leads:edit",
  "leads:convert",
  "leads:invalid",
]

/** 销售：经营主路径；可看合同但默认不可改合同；无线索入口 */
const salesPermissions = [
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
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
  "opportunities:create",
  "opportunities:stage",
  "channels:create",
  "channels:write",
  ...requestWritePerms,
]

/** 销售 Leader：部门树数据范围（飞书负责人子树） */
const leaderPermissions = [
  ...salesPermissions,
  "checkin:view_team",
  "customers:contact_assign",
]

/** 销售运营：维护合同与交付；可查看线索；无填报/系统配置 */
const opsPermissions = [
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
    "customers:create",
    "customers:master_edit",
    "customers:contact_add",
    "customers:contact_edit",
    "customers:follow_add",
    "customers:attachment_upload",
    "customers:status_change",
  "opportunities:create",
  "opportunities:stage",
  "contracts:create",
  "contracts:sign",
  "payments:view",
  "payments:plan_manage",
  "projects:write",
  "checkin:view_team",
  "customers:contact_assign",
  "channels:create",
  "channels:write",
  "public_pool:review",
  "public_pool:release",
]

/** 售前：首页 + 全量商机只读 + 顾问反馈 + 数据看板（无需求） */
const presalesPermissions = [
  "section:notifications",
  "section:home",
  "section:opportunities",
  "opportunities:advisor",
  "section:dashboard",
]

/** 客户成功：消息 + 首页工作台 + 交付项目管理 */
const viewerPermissions = [
  "section:notifications",
  "section:home",
  "section:projects",
  "projects:write",
]

/** 海外运营：需求 / 商机 / 合同 / 项目 / 海外填报 / 看板（可读可写）；无国内填报、无线索与客户 */
const overseasPermissions = [
  "section:notifications",
  "section:home",
  "section:requests",
  "section:opportunities",
  "section:contracts",
  "section:projects",
  "section:dashboard",
  "section:intake",
  "opportunities:create",
  "opportunities:stage",
  "contracts:create",
  "contracts:sign",
  "payments:view",
  "payments:plan_manage",
  "projects:write",
  ...requestWritePerms,
]

/** 市场成员：线索、客户与看板只读 */
const marketingPermissions = [
  "section:notifications",
  "section:home",
  "section:leads",
  "section:customers",
  "section:dashboard",
]

/** 市场负责人：经营链路全量只读，仅线索可编辑 */
const marketingLeaderPermissions = [
  "section:notifications",
  "section:home",
  "section:leads",
  "section:customers",
  "section:requests",
  "section:opportunities",
  "section:contracts",
  "section:projects",
  "section:dashboard",
  "leads:create",
  "leads:edit",
  "leads:convert",
  "leads:invalid",
  "request:view",
]

/** 管理员级角色应持有的完整权限（含 super_admin）：由权限目录派生，保证目录新增权限时管理员自动拥有，不因漏改清单而丢失。 */
export const ADMIN_LEVEL_PERMISSIONS: string[] = INITIAL_PERMISSIONS.map((p) => p.code)

export const INITIAL_ROLES: SeedRole[] = [
  {
    id: "role_sdr",
    code: "sdr",
    name: "SDR",
    description: "线索管理与数据看板；不开放客户管理",
    dataScope: "own",
    permissions: sdrPermissions,
  },
  {
    id: "role_sales",
    code: "sales",
    name: "销售",
    description: "",
    dataScope: "own",
    permissions: salesPermissions,
  },
  {
    id: "role_leader",
    code: "leader",
    name: "销售 Leader",
    description: "",
    dataScope: "department",
    permissions: leaderPermissions,
  },
  {
    id: "role_presales",
    code: "presales",
    name: "售前顾问",
    description: "全量商机只读与顾问反馈；数据看板",
    dataScope: "all",
    permissions: presalesPermissions,
  },
  {
    id: "role_viewer",
    code: "viewer",
    name: "客户成功",
    description: "",
    dataScope: "own",
    permissions: viewerPermissions,
  },
  {
    id: "role_overseas",
    code: "overseas",
    name: "海外运营",
    description: "全量可见海外归属：需求/商机/合同/项目/海外填报/看板",
    dataScope: "all",
    permissions: overseasPermissions,
  },
  {
    id: "role_ops",
    code: "ops",
    name: "销售运营",
    description: "",
    dataScope: "all",
    permissions: opsPermissions,
  },
  {
    id: "role_marketing",
    code: "marketing",
    name: "市场",
    description: "线索、客户与数据看板全量只读",
    dataScope: "all",
    permissions: marketingPermissions,
  },
  {
    id: "role_marketing_leader",
    code: "marketing_leader",
    name: "市场负责人",
    description: "经营链路全量只读，仅线索可编辑",
    dataScope: "all",
    permissions: marketingLeaderPermissions,
  },
  {
    id: "role_admin",
    code: "admin",
    name: "管理员",
    description: "",
    dataScope: "all",
    permissions: ADMIN_LEVEL_PERMISSIONS,
  },
  {
    id: "role_super_admin",
    code: "super_admin",
    name: "超级管理员",
    description: "",
    dataScope: "all",
    permissions: ADMIN_LEVEL_PERMISSIONS,
  },
]

/** 部门名称 → 默认身份角色（飞书部门匹配用） */
export const INITIAL_DEPARTMENT_RULES: SeedDepartmentRule[] = [
  { departmentName: "SDR", roleCode: "sdr", sortOrder: 0 },
  { departmentName: "SDR组", roleCode: "sdr", sortOrder: 1 },
  { departmentName: "销售拓展", roleCode: "sdr", sortOrder: 2 },
  { departmentName: "销售部", roleCode: "sales", sortOrder: 3 },
  { departmentName: "海外销售", roleCode: "sales", sortOrder: 4 },
  { departmentName: "海外事业部", roleCode: "leader", sortOrder: 5 },
  { departmentName: "销售Leader", roleCode: "leader", sortOrder: 6 },
  { departmentName: "销售运营", roleCode: "ops", sortOrder: 7 },
  { departmentName: "售前顾问", roleCode: "presales", sortOrder: 8 },
  { departmentName: "售前", roleCode: "presales", sortOrder: 9 },
  { departmentName: "客户成功", roleCode: "viewer", sortOrder: 10 },
  { departmentName: "海外运营", roleCode: "overseas", sortOrder: 11 },
  { departmentName: "市场", roleCode: "marketing", sortOrder: 12 },
  { departmentName: "解决方案部", roleCode: "presales", sortOrder: 13 },
  { departmentName: "业务运营部", roleCode: "ops", sortOrder: 14 },
]

export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  own: "仅本人数据",
  department: "本部门数据",
  all: "全部数据",
}
