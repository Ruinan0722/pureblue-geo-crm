import type { DataScope, Permission } from "@/modules/auth/lib/permissions"

export interface RbacPermissionRow {
  code: string
  name: string
  module: string
  sort_order: number
}

export interface RbacRoleRow {
  id: string
  code: string
  name: string
  description: string
  data_scope: DataScope
  is_system: number | boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface RbacRole {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScope
  isSystem: boolean
  sortOrder: number
  permissions: Permission[]
}

export interface UserRoleAssignment {
  userId: string
  roleId: string
  roleCode: string
  isPrimary: boolean
}

export interface UserPermissionOverride {
  userId: string
  permissionCode: Permission
  granted: boolean
}

export interface DepartmentRuleRow {
  department_name: string
  role_code: string
  sort_order: number
}

export interface ResolvedUserAuth {
  primaryRole: string
  roleCodes: string[]
  permissions: Permission[]
  dataScope: DataScope
}

export interface AdminUserRow {
  id: string
  feishuOpenId: string
  name: string
  avatarUrl: string | null
  role: string
  roleSource: "feishu" | "manual"
  roleLocked: boolean
  employmentStatus: "active" | "resigned"
  leftAt: string | null
  dataScopeOverride: DataScope | null
  departmentNames: string[]
  manualDepartmentOpenId: string | null
  manualDepartmentName: string | null
  manualDepartmentNote: string | null
  manualDepartmentLeader: boolean
  feishuLedDepartmentIds: string[]
  roles: RbacRole[]
  permissionOverrides: UserPermissionOverride[]
  effectivePermissions: Permission[]
  effectiveDataScope: DataScope
}
