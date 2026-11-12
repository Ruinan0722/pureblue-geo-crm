/**
 * RBAC 管理仓储 → geo-api HTTP 客户端。
 * 所有 rbac_* / user_role_assignments / user_permission_overrides 读写统一走 geo-api，
 * 前端进程不再直连 MySQL / Redis；geo-api 写后自行失效缓存。
 */
import { cookies } from "next/headers"
import { jwtCookieName } from "@/modules/auth/lib/dev-jwt"
import type { DataScope, Permission } from "@/modules/auth/lib/permissions"
import type {
  AdminUserRow,
  DepartmentRuleRow,
  RbacPermissionRow,
  RbacRole,
  UserPermissionOverride,
  UserRoleAssignment,
} from "./types"

interface ApiRole {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScope
  isSystem: boolean
  sortOrder: number
  permissions: Permission[]
}

interface ApiPermission {
  code: string
  name: string
  module: string
  sortOrder: number
}

interface ApiMeta {
  dataScopeLabels: Record<string, string>
  autoLoginRules: { departmentName: string; roleCode: string }[]
  superAdminFeishuOpenId: string | null
}

function parseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback
  const record = body as { error?: unknown; detail?: unknown; message?: unknown }
  if (typeof record.error === "string" && record.error.trim()) return record.error
  if (typeof record.detail === "string" && record.detail.trim()) return record.detail
  if (typeof record.message === "string" && record.message.trim()) return record.message
  return fallback
}

export async function rbacFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = (process.env.GEO_API_URL || "").replace(/\/$/, "")
  if (!base) {
    throw new Error("GEO_API_URL 未配置，RBAC 管理接口不可用")
  }
  const store = await cookies()
  const token = store.get(jwtCookieName())?.value
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (token) headers.Cookie = `${jwtCookieName()}=${token}`
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
    cache: "no-store",
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(parseError(body, `RBAC 请求失败（${res.status}）`))
  }
  return body as T
}

function toRole(row: ApiRole): RbacRole {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    dataScope: row.dataScope,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    permissions: row.permissions,
  }
}

export async function listPermissions(): Promise<RbacPermissionRow[]> {
  const data = await rbacFetch<{ permissions: ApiPermission[] }>("/api/rbac/permissions")
  return (data.permissions ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    module: p.module,
    sort_order: p.sortOrder,
  }))
}

export async function getValidPermissionCodes(): Promise<Set<string>> {
  const rows = await listPermissions()
  return new Set(rows.map((r) => r.code))
}

export async function listDepartmentRules(): Promise<DepartmentRuleRow[]> {
  const data = await rbacFetch<ApiMeta>("/api/rbac/meta")
  return (data.autoLoginRules ?? []).map((r, index) => ({
    department_name: r.departmentName,
    role_code: r.roleCode,
    sort_order: index,
  }))
}

export async function getDepartmentNamesForRole(roleCode: string): Promise<string[]> {
  const rules = await listDepartmentRules()
  return rules.filter((r) => r.role_code === roleCode).map((r) => r.department_name)
}

export async function listRoles(): Promise<RbacRole[]> {
  const data = await rbacFetch<{ roles: ApiRole[] }>("/api/rbac/roles")
  return (data.roles ?? []).map(toRole)
}

export async function getRoleById(id: string): Promise<RbacRole | null> {
  try {
    const data = await rbacFetch<ApiRole>(`/api/rbac/roles/${encodeURIComponent(id)}`)
    return toRole(data)
  } catch (err) {
    if (err instanceof Error && err.message.includes("角色不存在")) return null
    throw err
  }
}

export async function getRoleByCode(code: string): Promise<RbacRole | null> {
  try {
    const data = await rbacFetch<ApiRole>(`/api/rbac/roles/by-code/${encodeURIComponent(code)}`)
    return toRole(data)
  } catch (err) {
    if (err instanceof Error && err.message.includes("角色不存在")) return null
    throw err
  }
}

async function getUserDetail(userId: string): Promise<AdminUserRow> {
  return rbacFetch<AdminUserRow>(`/api/rbac/users/${encodeURIComponent(userId)}`)
}

export async function getUserRoleAssignments(userId: string): Promise<UserRoleAssignment[]> {
  const detail = await getUserDetail(userId)
  return (detail.roles ?? []).map((r) => ({
    userId,
    roleId: r.id,
    roleCode: r.code,
    isPrimary: true,
  }))
}

export async function getUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]> {
  const detail = await getUserDetail(userId)
  return detail.permissionOverrides ?? []
}

export async function setUserPrimaryRole(userId: string, roleCode: string): Promise<void> {
  await setUserRoles(userId, [roleCode], roleCode)
}

export async function setUserRoles(
  userId: string,
  roleCodes: string[],
  primaryRoleCode?: string,
): Promise<void> {
  if (roleCodes.length === 0) throw new Error("至少分配一个角色")
  await rbacFetch(`/api/rbac/users/${encodeURIComponent(userId)}/roles`, {
    method: "PUT",
    body: JSON.stringify({ roleCodes, primaryRoleCode }),
  })
}

export async function setUserPermissionOverrides(
  userId: string,
  overrides: UserPermissionOverride[],
): Promise<void> {
  await rbacFetch(`/api/rbac/users/${encodeURIComponent(userId)}/overrides`, {
    method: "PUT",
    body: JSON.stringify({ overrides }),
  })
}

export async function setUserRoleLocked(userId: string, locked: boolean): Promise<void> {
  await rbacFetch(`/api/rbac/users/${encodeURIComponent(userId)}/lock`, {
    method: "PATCH",
    body: JSON.stringify({ locked }),
  })
}

export async function setUserDataScopeOverride(
  userId: string,
  dataScope: DataScope | null,
): Promise<void> {
  await rbacFetch(`/api/rbac/users/${encodeURIComponent(userId)}/data-scope`, {
    method: "PATCH",
    body: JSON.stringify({ dataScope }),
  })
}

/** 勾选：切换为该唯一身份并锁定；取消：移除该身份（可能清空绑定）。 */
export async function toggleUserRole(
  userId: string,
  roleCode: string,
  enabled: boolean,
): Promise<void> {
  await rbacFetch(`/api/rbac/users/${encodeURIComponent(userId)}/role-toggle`, {
    method: "POST",
    body: JSON.stringify({ roleCode, enabled }),
  })
}

export async function revokeUserRoleBinding(userId: string, roleCode: string): Promise<void> {
  await toggleUserRole(userId, roleCode, false)
}

export async function createRole(input: {
  code: string
  name: string
  description?: string
  dataScope?: DataScope
  permissions?: Permission[]
}): Promise<RbacRole> {
  const data = await rbacFetch<ApiRole>("/api/rbac/roles", {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      name: input.name,
      description: input.description ?? "",
      dataScope: input.dataScope ?? "own",
      permissions: input.permissions ?? [],
    }),
  })
  return toRole(data)
}

export async function updateRole(
  roleId: string,
  input: {
    name?: string
    description?: string
    dataScope?: DataScope
    permissions?: Permission[]
  },
): Promise<RbacRole> {
  const data = await rbacFetch<ApiRole>(`/api/rbac/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
  return toRole(data)
}

export async function deleteRole(roleId: string): Promise<void> {
  await rbacFetch(`/api/rbac/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" })
}

/** 多角色收敛由 geo-api 鉴权解析负责（resolve_user_auth 取最高身份）；前端无需再批量改库。 */
export async function collapseAllUsersToSingleHighestRole(): Promise<number> {
  return 0
}

/** 同部门用户检索：交由 geo-api 用户列表，前端不再全表扫描。 */
export async function getDepartmentPeerUserIds(
  userId: string,
  _departmentNames: string[],
): Promise<string[]> {
  return [userId]
}
