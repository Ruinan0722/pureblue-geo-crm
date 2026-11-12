import type { DataScope } from "@/modules/auth/lib/permissions"

/**
 * 内置角色权限等级（数值越高权限越高）。
 * 每人仅保留一个身份时，冲突的多角色绑定取等级最高者。
 */
export const BUILTIN_ROLE_PRIVILEGE: Record<string, number> = {
  super_admin: 100,
  admin: 80,
  marketing_leader: 55,
  marketing: 45,
  sales: 40,
  staff: 40, // 历史别名，等同 sales
  viewer: 20,
}

const DATA_SCOPE_PRIVILEGE: Record<DataScope, number> = {
  own: 1,
  department: 2,
  all: 3,
}

export function rolePrivilegeRank(input: {
  code: string
  dataScope?: DataScope | null
  permissionCount?: number
}): number {
  const builtin = BUILTIN_ROLE_PRIVILEGE[input.code]
  if (builtin != null) return builtin
  const scope = DATA_SCOPE_PRIVILEGE[input.dataScope ?? "own"] ?? 1
  const perms = Math.min(Math.max(input.permissionCount ?? 0, 0), 50)
  // 自定义角色：落在 viewer~admin 之间，按数据范围与权限量估算
  return 20 + scope * 10 + Math.floor(perms / 5)
}

/** 从一组角色 code 中选出权限最高者；并列时保留数组中靠前的 */
export function pickHighestPrivilegeRoleCode(codes: string[], rankOf: (code: string) => number): string {
  if (codes.length === 0) throw new Error("角色列表为空")
  let best = codes[0]
  let bestRank = rankOf(best)
  for (let i = 1; i < codes.length; i++) {
    const code = codes[i]
    const rank = rankOf(code)
    if (rank > bestRank) {
      best = code
      bestRank = rank
    }
  }
  return best
}
