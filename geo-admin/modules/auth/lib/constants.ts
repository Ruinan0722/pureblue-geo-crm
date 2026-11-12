/** 遗留 session cookie 名，仅用于检测并清除旧版登录态 */
export const SESSION_COOKIE = "geo_session"
export const JWT_COOKIE = process.env.JWT_COOKIE ?? "geo_access_token"
export const INVITE_COOKIE = process.env.INVITE_COOKIE ?? "geo_invite_token"

export const SESSION_MAX_AGE_SEC = Number(process.env.SESSION_MAX_AGE ?? 60 * 60 * 24 * 7)

export type { StaffRole } from "./role-config"
export type { Permission } from "./permissions"

import type { StaffRole } from "./role-config"
import type { DataScope, Permission } from "./permissions"

export interface AuthUser {
  id: string
  feishuOpenId: string
  name: string
  avatarUrl: string | null
  /** 主角色（展示与兼容） */
  role: StaffRole
  /** 主角色显示名（来自 RBAC 表或内置定义） */
  roleLabel: string
  /** 已分配的全部角色 code */
  roles: string[]
  permissions: Permission[]
  dataScope: DataScope
  roleSource: "feishu" | "manual"
  roleLocked: boolean
  departmentNames: string[]
  manualDepartmentOpenId?: string | null
  manualDepartmentName?: string | null
  manualDepartmentNote?: string | null
  manualDepartmentLeader?: boolean
  feishuLedDepartmentIds?: string[]
}

export type AuthState =
  | { kind: "user"; user: AuthUser }
  | { kind: "customer"; inviteToken: string }
  | { kind: "anonymous" }
