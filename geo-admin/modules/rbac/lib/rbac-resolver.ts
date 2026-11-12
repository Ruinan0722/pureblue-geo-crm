import { hasPermission, type DataScope, type Permission } from "@/modules/auth/lib/permissions"
import { normalizeRole } from "@/modules/auth/lib/role-config"
import {
  getRoleByCode,
  getUserPermissionOverrides,
  getUserRoleAssignments,
} from "./rbac-repo"
import { pickHighestPrivilegeRoleCode, rolePrivilegeRank } from "./role-privilege"
import type { ResolvedUserAuth } from "./types"

const DATA_SCOPE_RANK: Record<DataScope, number> = {
  own: 1,
  department: 2,
  all: 3,
}

export function maxDataScope(scopes: DataScope[]): DataScope {
  if (scopes.length === 0) return "own"
  return scopes.reduce((best, current) =>
    DATA_SCOPE_RANK[current] > DATA_SCOPE_RANK[best] ? current : best,
  )
}

export async function resolveUserAuth(input: {
  userId: string
  fallbackRole: string
  dataScopeOverride?: DataScope | null
}): Promise<ResolvedUserAuth> {
  const assignments = await getUserRoleAssignments(input.userId)

  // 单身份：若历史残留多角色，只取权限最高者参与鉴权
  let effectiveCode: string
  if (assignments.length === 0) {
    effectiveCode = normalizeRole(input.fallbackRole)
  } else if (assignments.length === 1) {
    effectiveCode = assignments[0].roleCode
  } else {
    const ranks = new Map<string, number>()
    for (const a of assignments) {
      const role = await getRoleByCode(a.roleCode)
      ranks.set(
        a.roleCode,
        rolePrivilegeRank({
          code: a.roleCode,
          dataScope: role?.dataScope,
          permissionCount: role?.permissions.length,
        }),
      )
    }
    effectiveCode = pickHighestPrivilegeRoleCode(
      assignments.map((a) => a.roleCode),
      (c) => ranks.get(c) ?? 0,
    )
  }

  const roleCodes = [normalizeRole(effectiveCode)]
  const permissionSet = new Set<Permission>()
  const dataScopes: DataScope[] = []

  for (const code of roleCodes) {
    const role = await getRoleByCode(code)
    if (!role) continue
    for (const p of role.permissions) permissionSet.add(p)
    dataScopes.push(role.dataScope)
  }

  const overrides = await getUserPermissionOverrides(input.userId)
  for (const o of overrides) {
    if (o.granted) permissionSet.add(o.permissionCode)
    else permissionSet.delete(o.permissionCode)
  }

  // 消息通知是所有内部员工的基础入口，不受角色模板或个人 deny 覆盖影响。
  permissionSet.add("section:notifications")

  const primaryRole = roleCodes[0] ?? normalizeRole(input.fallbackRole)
  const dataScope = input.dataScopeOverride ?? maxDataScope(dataScopes)

  return {
    primaryRole,
    roleCodes,
    permissions: [...permissionSet].sort(),
    dataScope,
  }
}

export function userHasPermission(permissions: readonly Permission[], permission: Permission): boolean {
  return hasPermission(permissions, permission)
}
