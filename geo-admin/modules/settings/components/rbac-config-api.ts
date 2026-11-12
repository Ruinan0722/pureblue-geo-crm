/** rbac-config 的数据类型与启动抓取（从 rbac-config.tsx 拆出）。 */
import type { DataScope, Permission } from "@/modules/auth/lib/permissions"

export interface RbacRole {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScope
  isSystem: boolean
  permissions: Permission[]
}

export interface AdminUser {
  id: string
  name: string
  feishuOpenId: string
  role: string
  roleSource: "feishu" | "manual"
  roleLocked: boolean
  employmentStatus?: "active" | "resigned"
  dataScopeOverride: DataScope | null
  departmentNames: string[]
  manualDepartmentOpenId: string | null
  manualDepartmentName: string | null
  manualDepartmentNote: string | null
  manualDepartmentLeader: boolean
  feishuLedDepartmentIds?: string[]
  roles: RbacRole[]
  effectivePermissions: Permission[]
  effectiveDataScope: DataScope
  permissionOverrides: { permissionCode: Permission; granted: boolean }[]
}

export interface DirectoryUser {
  feishuOpenId: string
  name: string
  departmentNames: string[]
  jobTitle?: string | null
  source: "feishu" | "database"
}

export interface DirectoryDepartment {
  id: string
  name: string
}

export const ORG_ROOT_NAME = "pureblueAI"

export interface PermissionRow {
  code: string
  name: string
  module: string
  sort_order: number
}

export interface RbacMeta {
  dataScopeLabels: Record<string, string>
  autoLoginRules: { departmentName: string; roleCode: string }[]
  superAdminFeishuOpenId: string | null
}

export type RbacBootstrap = {
  roles: RbacRole[]
  users: AdminUser[]
  permissions: PermissionRow[]
  meta: RbacMeta
}

type DeptLeaderMetaPayload = {
  leadersByDeptId: Record<string, string>
  leaderProfiles: Array<{ feishuOpenId: string; departmentOpenId: string; name: string }>
}

/** 模块级去重：Strict Mode 双挂载 / 短时重复进入共享同一请求 */
let bootstrapInflight: Promise<RbacBootstrap> | null = null
let directoryMetaInflight: Promise<DeptLeaderMetaPayload | null> | null = null
export const deptChildrenInflight = new Map<string, Promise<DirectoryDepartment[]>>()

export async function fetchRbacBootstrap(force = false): Promise<RbacBootstrap> {
  if (!force && bootstrapInflight) return bootstrapInflight
  const request = (async () => {
    const [rolesRes, usersRes, permissionsRes, metaRes] = await Promise.all([
      fetch("/api/rbac/roles", { cache: "no-store" }),
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/rbac/permissions", { cache: "no-store" }),
      fetch("/api/rbac/meta", { cache: "no-store" }),
    ])
    if (!rolesRes.ok || !usersRes.ok || !permissionsRes.ok || !metaRes.ok) throw new Error("加载失败")
    const rolesData = (await rolesRes.json()) as { roles: RbacRole[] }
    const usersData = (await usersRes.json()) as { users: AdminUser[] }
    const permissionsData = (await permissionsRes.json()) as { permissions: PermissionRow[] }
    const metaData = (await metaRes.json()) as RbacMeta
    return {
      roles: rolesData.roles,
      users: usersData.users,
      permissions: permissionsData.permissions,
      meta: metaData,
    }
  })()
  bootstrapInflight = request
  try {
    return await request
  } finally {
    if (bootstrapInflight === request) bootstrapInflight = null
  }
}

export async function fetchDirectoryMeta(): Promise<DeptLeaderMetaPayload | null> {
  if (directoryMetaInflight) return directoryMetaInflight
  const request = (async () => {
    const res = await fetch("/api/users/directory/meta", { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as {
      leadersByDeptId?: Record<string, string>
      leaderProfiles?: Array<{ feishuOpenId: string; departmentOpenId: string; name: string }>
    }
    return {
      leadersByDeptId: data.leadersByDeptId ?? {},
      leaderProfiles: data.leaderProfiles ?? [],
    }
  })()
  directoryMetaInflight = request
  try {
    return await request
  } finally {
    if (directoryMetaInflight === request) directoryMetaInflight = null
  }
}
