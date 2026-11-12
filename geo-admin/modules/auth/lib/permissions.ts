/**
 * 权限鉴权工具 — 运行期权限列表来自服务端 / 数据库，此处仅保留类型与纯函数。
 */

export type Permission = string

export type DataScope = "own" | "department" | "all"

/** 侧边栏 / 页面分区 */
export type SectionKey =
  | "notifications"
  | "home"
  | "leads"
  | "public_pool"
  | "customers"
  | "channels"
  | "opportunities"
  | "contracts"
  | "projects"
  | "dashboard"
  | "intake"
  | "intake_cn"
  | "requests"
  | "checkin"
  | "settings"

/** 分区与权限 code 的映射（路由标识，非敏感元数据） */
export const SECTION_PERMISSION_MAP: Record<SectionKey, string> = {
  notifications: "section:notifications",
  home: "section:home",
  leads: "section:leads",
  public_pool: "section:public_pool",
  customers: "section:customers",
  channels: "section:channels",
  opportunities: "section:opportunities",
  contracts: "section:contracts",
  projects: "section:projects",
  dashboard: "section:dashboard",
  intake: "section:intake",
  intake_cn: "section:intake_cn",
  requests: "section:requests",
  checkin: "section:checkin",
  settings: "section:settings",
}

export function hasPermission(rolePermissions: readonly Permission[], permission: Permission): boolean {
  return rolePermissions.includes(permission)
}

/**
 * 细粒度操作权限：命中细码或该模块遗留总写码即放行。
 * 兼容“尚未按细码重配角色”的过渡期；矩阵重配后移除总写码即可按细码控制按钮可见。
 */
export function canDo(
  rolePermissions: readonly Permission[],
  fine: Permission,
  coarse?: Permission,
): boolean {
  if (hasPermission(rolePermissions, fine)) return true
  return coarse ? hasPermission(rolePermissions, coarse) : false
}

export function canAccessSectionFromPermissions(
  permissions: readonly Permission[],
  section: SectionKey,
): boolean {
  return hasPermission(permissions, SECTION_PERMISSION_MAP[section])
}

/** 从已解析权限推导可访问的页面分区（用于展示，勿用于鉴权捷径）。 */
export function sectionsFromPermissions(permissions: readonly Permission[]): SectionKey[] {
  return (Object.keys(SECTION_PERMISSION_MAP) as SectionKey[]).filter((section) =>
    canAccessSectionFromPermissions(permissions, section),
  )
}

/** 用户页面访问：仅看 effective permissions，与角色 code 无关。 */
export function userCanAccessSection(
  user: { permissions: readonly Permission[] },
  section: SectionKey,
): boolean {
  return canAccessSectionFromPermissions(user.permissions, section)
}

/** 是否可查看团队打卡记录 */
export function canViewTeamCheckins(user: {
  permissions: readonly Permission[]
  dataScope: DataScope
}): boolean {
  if (!canAccessSectionFromPermissions(user.permissions, "checkin")) return false
  if (hasPermission(user.permissions, "checkin:view_team")) return true
  // 兼容旧配置：未写入 checkin:view_team 时，仍按数据范围推断
  return user.dataScope !== "own"
}

/** 是否可查看团队/他人对接池（归属标注、「只看自己」开关）：
 * 由服务端 data_scope 推导，与后端 _owner_filter 一致，避免按角色名硬编码漏掉管理员/运营。 */
export function canSeeTeamPools(user: { dataScope: DataScope }): boolean {
  return user.dataScope !== "own"
}

/** CRM / 设置等：分区可见后，还需要对应写权限才可编辑 */
export const SECTION_WRITE_PERMISSION_MAP: Partial<Record<SectionKey, string>> = {
  leads: "leads:write",
  customers: "customers:write",
  opportunities: "opportunities:write",
  contracts: "contracts:write",
  projects: "projects:write",
  requests: "request:edit",
  settings: "section:settings",
  intake: "request:create",
  intake_cn: "request:create",
}

export function canEditSectionFromPermissions(
  permissions: readonly Permission[],
  section: SectionKey,
): boolean {
  if (!canAccessSectionFromPermissions(permissions, section)) return false
  const writeCode = SECTION_WRITE_PERMISSION_MAP[section]
  if (!writeCode) return true
  return hasPermission(permissions, writeCode)
}
