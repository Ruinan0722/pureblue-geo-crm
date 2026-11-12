/**
 * 超管 / 管理员赋权层级（服务端强制）。
 * - 唯一 super_admin：由 SUPER_ADMIN_FEISHU_OPEN_ID 指定，不可经 UI/API 转交或卸任
 * - 仅 super_admin 可设/取消 admin；可收口「异常超管」（role=super_admin 但非指定 open_id）
 * - admin 只能改业务身份，不可改超管 / 不可改 admin·super_admin 角色模板
 */

export class AdminHierarchyError extends Error {
  readonly status = 403

  constructor(message: string) {
    super(message)
    this.name = "AdminHierarchyError"
  }
}

export type HierarchyActor = {
  role: string
  feishuOpenId?: string | null
}

export type HierarchyTarget = {
  id?: string
  role: string
  feishuOpenId: string
}

const ADMIN_ROLE = "admin"
const SUPER_ADMIN_ROLE = "super_admin"

export function getSuperAdminFeishuOpenId(): string {
  return (process.env.SUPER_ADMIN_FEISHU_OPEN_ID ?? "").trim()
}

export function isDesignatedSuperAdminOpenId(feishuOpenId: string | null | undefined): boolean {
  const designated = getSuperAdminFeishuOpenId()
  if (!designated || !feishuOpenId) return false
  return feishuOpenId.trim() === designated
}

export function isSuperAdminActor(actor: HierarchyActor): boolean {
  // 已配置唯一超管时：仅指定 open_id 拥有超管操作权（防止异常超管提权）
  const designated = getSuperAdminFeishuOpenId()
  if (designated) {
    return isDesignatedSuperAdminOpenId(actor.feishuOpenId)
  }
  // 未配置时：退回 role（本地未配 env 的兼容）
  return actor.role === SUPER_ADMIN_ROLE
}

/** 指定超管本人：任何人都不可通过设置页改 */
export function isImmutableSuperAdminTarget(target: HierarchyTarget): boolean {
  return isDesignatedSuperAdminOpenId(target.feishuOpenId)
}

/** 脏数据：库里是 super_admin 但不是指定 open_id */
export function isOrphanSuperAdminTarget(target: HierarchyTarget): boolean {
  return target.role === SUPER_ADMIN_ROLE && !isDesignatedSuperAdminOpenId(target.feishuOpenId)
}

/** 管理员视角：任意超管（含指定与异常）都不可碰 */
export function isProtectedSuperAdminTarget(target: HierarchyTarget): boolean {
  return isImmutableSuperAdminTarget(target) || target.role === SUPER_ADMIN_ROLE
}

export function isAdminRoleCode(roleCode: string): boolean {
  return roleCode === ADMIN_ROLE
}

export function isSuperAdminRoleCode(roleCode: string): boolean {
  return roleCode === SUPER_ADMIN_ROLE
}

export function isPrivilegedRoleCode(roleCode: string): boolean {
  return roleCode === ADMIN_ROLE || roleCode === SUPER_ADMIN_ROLE
}

/** 设置页：操作方可勾选/开通的身份 */
export function roleCodesAssignableByActor(actor: HierarchyActor, allRoleCodes: string[]): string[] {
  const isSa = isSuperAdminActor(actor)
  return allRoleCodes.filter((code) => {
    if (code === SUPER_ADMIN_ROLE) return false
    if (code === ADMIN_ROLE) return isSa
    return true
  })
}

function chosenPrimaryRole(roleCodes: string[], primaryRoleCode?: string): string {
  if (primaryRoleCode && roleCodes.includes(primaryRoleCode)) return primaryRoleCode
  if (roleCodes.includes(SUPER_ADMIN_ROLE)) return SUPER_ADMIN_ROLE
  if (roleCodes.includes(ADMIN_ROLE)) return ADMIN_ROLE
  return roleCodes[0]
}

/**
 * setUserRoles 会按权限等级取最高身份；校验必须覆盖入参中每一个特权角色，
 * 不能只看 primaryRoleCode（否则可用 primary=viewer + codes 含 admin 提权）。
 */
function assertPrivilegedRoleAllowed(
  actor: HierarchyActor,
  target: HierarchyTarget | null,
  roleCode: string,
): void {
  if (roleCode === SUPER_ADMIN_ROLE) {
    const openId = target?.feishuOpenId
    if (!isDesignatedSuperAdminOpenId(openId)) {
      throw new AdminHierarchyError("超级管理员唯一且固定，无法将他人设为超级管理员")
    }
    if (!isSuperAdminActor(actor)) {
      throw new AdminHierarchyError("仅超级管理员可操作管理员相关权限")
    }
    return
  }
  if (roleCode === ADMIN_ROLE) {
    if (!isSuperAdminActor(actor)) {
      throw new AdminHierarchyError("仅超级管理员可设置管理员")
    }
  }
}

/** 对目标用户做任何 RBAC 写之前（锁、细调、改身份） */
export function assertCanMutateTargetRbac(actor: HierarchyActor, target: HierarchyTarget): void {
  if (isImmutableSuperAdminTarget(target)) {
    throw new AdminHierarchyError("不可修改超级管理员的权限")
  }

  if (isOrphanSuperAdminTarget(target)) {
    if (!isSuperAdminActor(actor)) {
      throw new AdminHierarchyError("不可修改超级管理员的权限")
    }
    // 真实超管可收口异常超管
    return
  }
}

/**
 * 校验将目标设为 roleCodes（单身份模型取 primary）。
 * enabled=false 场景用 assertCanRevokeRole。
 */
export function assertCanAssignRoles(
  actor: HierarchyActor,
  target: HierarchyTarget | null,
  roleCodes: string[],
  primaryRoleCode?: string,
): void {
  if (roleCodes.length === 0) {
    throw new AdminHierarchyError("至少分配一个角色")
  }

  if (target) {
    assertCanMutateTargetRbac(actor, target)
  }

  const uniqueCodes = [...new Set(roleCodes)]
  for (const code of uniqueCodes) {
    assertPrivilegedRoleAllowed(actor, target, code)
  }

  const next = chosenPrimaryRole(uniqueCodes, primaryRoleCode)
  assertPrivilegedRoleAllowed(actor, target, next)
}

/** 取消某身份（toggle enabled=false） */
export function assertCanRevokeRole(
  actor: HierarchyActor,
  target: HierarchyTarget,
  roleCode: string,
): void {
  if (isImmutableSuperAdminTarget(target)) {
    throw new AdminHierarchyError("不可取消超级管理员身份")
  }

  if (isOrphanSuperAdminTarget(target) || roleCode === SUPER_ADMIN_ROLE) {
    if (!isSuperAdminActor(actor)) {
      throw new AdminHierarchyError("仅超级管理员可收口异常超管")
    }
    return
  }

  assertCanMutateTargetRbac(actor, target)

  if (roleCode === ADMIN_ROLE || target.role === ADMIN_ROLE) {
    if (!isSuperAdminActor(actor)) {
      throw new AdminHierarchyError("仅超级管理员可取消管理员")
    }
  }
}

/** 开通新用户时仅有 feishuOpenId */
export function assertCanGrantNewUser(
  actor: HierarchyActor,
  feishuOpenId: string,
  roleCodes: string[],
  primaryRoleCode?: string,
): void {
  if (isDesignatedSuperAdminOpenId(feishuOpenId)) {
    throw new AdminHierarchyError("不可通过授权接口修改超级管理员")
  }
  assertCanAssignRoles(actor, { role: "viewer", feishuOpenId }, roleCodes, primaryRoleCode)
}

/** 改角色模板（权限矩阵 / 删除角色 / 从种子恢复） */
export function assertCanEditRoleTemplate(actor: HierarchyActor, roleCode: string): void {
  if (!isPrivilegedRoleCode(roleCode)) return
  if (!isSuperAdminActor(actor)) {
    throw new AdminHierarchyError("仅超级管理员可修改管理员 / 超级管理员的角色模板")
  }
}

export function assertCanSyncIdentitySeed(actor: HierarchyActor): void {
  if (!isSuperAdminActor(actor)) {
    throw new AdminHierarchyError("仅超级管理员可从代码种子恢复系统角色")
  }
}
