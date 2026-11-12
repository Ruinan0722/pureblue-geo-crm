/** 内部角色标识 — 系统身份角色 + 数据库自定义角色 */
export type StaffRole =
  | "sdr"
  | "sales"
  | "leader"
  | "ops"
  | "presales"
  | "viewer"
  | "overseas"
  | "marketing"
  | "marketing_leader"
  | "admin"
  | "super_admin"
  | (string & {})

export const STAFF_ROLES: StaffRole[] = [
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

/** 兼容旧库中的 staff 角色；自定义角色 code 原样返回 */
export function normalizeRole(raw: string): StaffRole {
  if (raw === "staff") return "sales"
  return raw as StaffRole
}
