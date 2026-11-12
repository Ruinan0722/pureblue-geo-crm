import { isUserInSalesDepartmentTree } from "./feishu-contact"
import { normalizeRole, type StaffRole } from "./role-config"
import { listDepartmentRules, getDepartmentNamesForRole } from "@/modules/rbac/lib/rbac-repo"

function parseEnvList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function getSalesDepartmentNames(): Promise<string[]> {
  return getDepartmentNamesForRole("sales")
}

/** 销售部 open_department_id（逗号分隔，搜索部门不可用时的兜底配置） */
export function getSalesDepartmentIds(): string[] {
  return parseEnvList(process.env.FEISHU_SALES_DEPARTMENT_IDS)
}

function getSuperAdminOpenId(): string {
  return (process.env.SUPER_ADMIN_FEISHU_OPEN_ID ?? "").trim()
}

export function isSuperAdminOpenId(feishuOpenId: string): boolean {
  const designated = getSuperAdminOpenId()
  return Boolean(designated) && feishuOpenId === designated
}

function isAdminOpenId(feishuOpenId: string): boolean {
  if (isSuperAdminOpenId(feishuOpenId)) return false
  const admins = parseEnvList(process.env.ADMIN_FEISHU_OPEN_IDS)
  return admins.includes(feishuOpenId)
}

function departmentMatches(userDepartments: string[], configured: string[]): boolean {
  const normalized = userDepartments.map((d) => d.trim()).filter(Boolean)
  return normalized.some((dept) =>
    configured.some((c) => dept === c || dept.includes(c) || c.includes(dept)),
  )
}

function departmentLeafMatches(userDepartments: string[], configured: string): boolean {
  return userDepartments.some((raw) => {
    const leaf = raw.split(">").at(-1)?.trim() ?? ""
    return leaf === configured.trim()
  })
}

async function getDepartmentRoleMap(): Promise<Map<string, StaffRole>> {
  const rules = await listDepartmentRules()
  const map = new Map<string, StaffRole>()
  for (const rule of rules) {
    map.set(rule.department_name, normalizeRole(rule.role_code))
  }
  return map
}

function resolveRoleFromDepartments(
  departmentNames: string[],
  roleByDepartment: Map<string, StaffRole>,
): StaffRole | null {
  for (const [departmentName, roleCode] of roleByDepartment) {
    const matched = roleCode === "marketing"
      ? departmentLeafMatches(departmentNames, departmentName)
      : departmentMatches(departmentNames, [departmentName])
    if (matched) {
      return roleCode
    }
  }
  return null
}

export async function isSalesDepartmentMember(input: { departmentNames: string[] }): Promise<boolean> {
  const roleByDepartment = await getDepartmentRoleMap()
  for (const [departmentName, roleCode] of roleByDepartment) {
    if (roleCode === "sales" && departmentMatches(input.departmentNames, [departmentName])) {
      return true
    }
  }
  return false
}

/**
 * 根据飞书 open_id 与部门名称解析内部角色。
 * 优先级：唯一超管 > admin 白名单 > 数据库部门规则 > 销售部组织树兜底。
 */
export async function resolveStaffRole(input: {
  feishuOpenId: string
  departmentNames: string[]
}): Promise<StaffRole> {
  if (isSuperAdminOpenId(input.feishuOpenId)) return "super_admin"
  if (isAdminOpenId(input.feishuOpenId)) return "admin"

  const roleByDepartment = await getDepartmentRoleMap()
  const fromDepartments = resolveRoleFromDepartments(input.departmentNames, roleByDepartment)
  if (fromDepartments) return fromDepartments

  throw new Error("您的部门暂无系统访问权限，请联系管理员")
}

/**
 * 飞书登录时的角色解析：名称匹配失败后，回退校验销售部组织树成员。
 */
export async function resolveStaffRoleForLogin(input: {
  feishuOpenId: string
  departmentNames?: string[]
}): Promise<{ role: StaffRole; departmentNames: string[] }> {
  const departmentNames = input.departmentNames ?? []

  if (isSuperAdminOpenId(input.feishuOpenId)) {
    return { role: "super_admin", departmentNames }
  }

  if (isAdminOpenId(input.feishuOpenId)) {
    return { role: "admin", departmentNames }
  }

  const roleByDepartment = await getDepartmentRoleMap()
  const fromDepartments = resolveRoleFromDepartments(departmentNames, roleByDepartment)
  if (fromDepartments) {
    return { role: fromDepartments, departmentNames }
  }

  if (await isUserInSalesDepartmentTree(input.feishuOpenId)) {
    const salesDepartments = [...roleByDepartment.entries()]
      .filter(([, roleCode]) => roleCode === "sales")
      .map(([departmentName]) => departmentName)
    return {
      role: "sales",
      departmentNames: departmentNames.length > 0 ? departmentNames : salesDepartments,
    }
  }

  throw new Error("您的部门暂无系统访问权限，请联系管理员")
}

/** 开发环境：跳过部门校验时按名称模拟部门 */
export function resolveDevRole(input: { name: string; role?: StaffRole }): StaffRole {
  if (input.role) return input.role
  if (input.name.includes("管理")) return "admin"
  if (input.name.includes("SDR") || input.name.includes("拓展")) return "sdr"
  if (input.name.includes("Leader") || input.name.includes("leader")) return "leader"
  if (input.name.includes("海外")) return "overseas"
  if (input.name.includes("运营")) return "ops"
  if (input.name.includes("顾问") || input.name.includes("售前")) return "presales"
  if (input.name.includes("客户成功")) return "viewer"
  return "sales"
}
