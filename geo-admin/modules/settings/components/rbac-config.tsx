"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Search, ShieldCheck, UserPlus } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { cn } from "@/shared/lib/utils"
import { ContentLoadingBlock } from "@/shared/ui/content-loading"
import { type DataScope, type Permission } from "@/modules/auth/lib/permissions"
import { formatDepartmentDisplayName, formatDepartmentPath } from "@/modules/auth/lib/department-display-name"
import { groupPermissionsByModule } from "@/modules/rbac/lib/rbac-seed-data"
import { RolePermissionMatrix } from "@/modules/settings/components/role-permission-matrix"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { roleCodesAssignableByActor } from "@/modules/rbac/lib/admin-hierarchy"
import { toast } from "sonner"
import {
  AccessStatusBadges,
  isDeptMemberLeader,
  MemberListPanel,
  MemberListPlaceholder,
  PaginatedMemberList,
  resolvePersonAccess,
  type DeptLeaderMeta,
} from "@/modules/settings/components/rbac-config-parts"
import {
  type AdminUser,
  deptChildrenInflight,
  type DirectoryDepartment,
  type DirectoryUser,
  fetchDirectoryMeta,
  fetchRbacBootstrap,
  ORG_ROOT_NAME,
  type PermissionRow,
  type RbacMeta,
  type RbacRole,
} from "@/modules/settings/components/rbac-config-api"

export function RbacConfig() {
  const { user: authUser } = useAuth()
  const [roles, setRoles] = useState<RbacRole[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [permissionRows, setPermissionRows] = useState<PermissionRow[]>([])
  const [rbacMeta, setRbacMeta] = useState<RbacMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [directoryQuery, setDirectoryQuery] = useState("")
  const [directoryResults, setDirectoryResults] = useState<DirectoryUser[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [grantRoleCode, setGrantRoleCode] = useState("viewer")
  const [userFilter, setUserFilter] = useState("")
  const [deptQuery, setDeptQuery] = useState("")
  const [deptResults, setDeptResults] = useState<DirectoryDepartment[]>([])
  const [deptLoading, setDeptLoading] = useState(false)
  const [selectedDept, setSelectedDept] = useState<DirectoryDepartment | null>(null)
  const [includeSubtree, setIncludeSubtree] = useState(true)
  const [deptMembers, setDeptMembers] = useState<Array<{ feishuOpenId: string; name: string }>>([])
  const [deptMembersLoading, setDeptMembersLoading] = useState(false)
  /** 快速切换部门时取消/忽略过期请求，避免旧结果覆盖当前选中部门 */
  const deptMembersAbortRef = useRef<AbortController | null>(null)
  const deptMembersReqIdRef = useRef(0)

  // 部门浏览：面包屑 + 当前层级子部门列表（飞书通讯录风格）
  const [deptNavPath, setDeptNavPath] = useState<DirectoryDepartment[]>([])
  const [deptTreeChildren, setDeptTreeChildren] = useState<Record<string, DirectoryDepartment[]>>({})
  const [deptTreeLoading, setDeptTreeLoading] = useState<Record<string, boolean>>({})
  const TREE_ROOT_PARENT_ID = "0"

  // 成员标注编辑草稿：按需输入备注/负责人
  const [memberFilterText, setMemberFilterText] = useState("")
  const [onlyAssignedToDept, setOnlyAssignedToDept] = useState(false)
  const [onlyLeaders, setOnlyLeaders] = useState(false)
  const [memberListMode, setMemberListMode] = useState<"dept" | "all">("dept")
  const [deptBulkRoleCode, setDeptBulkRoleCode] = useState("viewer")
  const [deptLeaderMeta, setDeptLeaderMeta] = useState<DeptLeaderMeta | null>(null)
  const [syncingSeed, setSyncingSeed] = useState(false)

  const designatedSuperAdminOpenId = rbacMeta?.superAdminFeishuOpenId?.trim() || null

  const hierarchyActor = useMemo(
    () => ({
      role: authUser?.role ?? "viewer",
      feishuOpenId: authUser?.feishuOpenId,
    }),
    [authUser?.role, authUser?.feishuOpenId],
  )

  // UI 侧：有 meta 指定 open_id 时只认 open_id；否则兼容 role
  const actorIsSuperAdmin = Boolean(
    designatedSuperAdminOpenId
      ? authUser?.feishuOpenId === designatedSuperAdminOpenId
      : authUser?.role === "super_admin",
  )

  const visibleRoles = useMemo(() => {
    if (actorIsSuperAdmin) {
      return roles
    }
    return roles.filter((r) => r.code !== "admin" && r.code !== "super_admin")
  }, [roles, actorIsSuperAdmin])

  const editableRoleCodes = useMemo(() => {
    return new Set(roleCodesAssignableByActor(hierarchyActor, roles.map((r) => r.code)))
  }, [hierarchyActor, roles])

  /** 零散开通 / 整部门批量：仅业务身份，不含管理员与超级管理员 */
  const businessGrantRoles = useMemo(() => {
    return roles.filter(
      (r) =>
        editableRoleCodes.has(r.code) &&
        r.code !== "admin" &&
        r.code !== "super_admin",
    )
  }, [roles, editableRoleCodes])

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const data = await fetchRbacBootstrap(force)
      setRoles(data.roles)
      setUsers(data.users)
      setPermissionRows(data.permissions)
      setRbacMeta(data.meta)
    } catch {
      toast.error("加载权限数据失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" })
      if (!res.ok) throw new Error("加载失败")
      const usersData = (await res.json()) as { users: AdminUser[] }
      setUsers(usersData.users)
    } catch {
      toast.error("刷新用户列表失败")
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchRbacBootstrap()
      .then((data) => {
        if (cancelled) return
        setRoles(data.roles)
        setUsers(data.users)
        setPermissionRows(data.permissions)
        setRbacMeta(data.meta)
      })
      .catch(() => {
        if (!cancelled) toast.error("加载权限数据失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchDirectoryMeta()
      .then((meta) => {
        if (cancelled || !meta) return
        setDeptLeaderMeta(meta)
      })
      .catch(() => {
        /* 负责人标注为增强展示，失败时静默降级 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (businessGrantRoles.length > 0 && !businessGrantRoles.some((r) => r.code === grantRoleCode)) {
      setGrantRoleCode(businessGrantRoles.find((r) => r.code === "viewer")?.code ?? businessGrantRoles[0].code)
    }
  }, [businessGrantRoles, grantRoleCode])

  useEffect(() => {
    if (businessGrantRoles.length > 0 && !businessGrantRoles.some((r) => r.code === deptBulkRoleCode)) {
      setDeptBulkRoleCode(businessGrantRoles.find((r) => r.code === "viewer")?.code ?? businessGrantRoles[0].code)
    }
  }, [businessGrantRoles, deptBulkRoleCode])

  useEffect(() => {
    const q = directoryQuery.trim()
    if (q.length < 1) {
      setDirectoryResults([])
      return
    }
    const timer = setTimeout(() => {
      setDirectoryLoading(true)
      fetch(`/api/users/directory/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error("搜索失败")
          const data = (await res.json()) as { users?: DirectoryUser[] }
          setDirectoryResults(data.users ?? [])
        })
        .catch(() => toast.error("搜索通讯录失败"))
        .finally(() => setDirectoryLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [directoryQuery])

  useEffect(() => {
    const q = deptQuery.trim()
    if (q.length < 1) {
      setDeptResults([])
      return
    }
    const timer = setTimeout(() => {
      setDeptLoading(true)
      fetch(`/api/users/directory/departments?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(async (res) => {
          const data = (await res.json()) as {
            departments?: DirectoryDepartment[]
            error?: string
            feishuError?: string | null
          }
          if (!res.ok) {
            throw new Error(data.error ?? "搜索失败")
          }
          setDeptResults(data.departments ?? [])
          if (data.feishuError && (data.departments?.length ?? 0) > 0) {
            toast.message("飞书搜索不可用，已展示本地标注部门")
          }
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : "搜索部门失败")
          setDeptResults([])
        })
        .finally(() => setDeptLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [deptQuery])

  async function toggleRolePermission(roleId: string, permission: Permission, enabled: boolean) {
    const role = roles.find((r) => r.id === roleId)
    if (!role) return
    if ((role.code === "admin" || role.code === "super_admin") && !actorIsSuperAdmin) {
      toast.error("仅超级管理员可修改管理员 / 超级管理员的角色模板")
      return
    }
    const next = enabled
      ? [...new Set([...role.permissions, permission])]
      : role.permissions.filter((p) => p !== permission)

    const res = await fetch(`/api/rbac/roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: next }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? "更新失败")
      return
    }
    const updated = (await res.json()) as RbacRole
    setRoles((prev) => prev.map((r) => (r.id === roleId ? updated : r)))
    toast.success("角色权限已更新")
    void refreshUsers()
  }

  async function updateRoleDataScope(roleId: string, dataScope: DataScope) {
    const role = roles.find((r) => r.id === roleId)
    if (role && (role.code === "admin" || role.code === "super_admin") && !actorIsSuperAdmin) {
      toast.error("仅超级管理员可修改管理员 / 超级管理员的角色模板")
      return
    }
    const res = await fetch(`/api/rbac/roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataScope }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? "更新失败")
      return
    }
    const updated = (await res.json()) as RbacRole
    setRoles((prev) => prev.map((r) => (r.id === roleId ? updated : r)))
    toast.success("数据范围已更新")
    void refreshUsers()
  }

  async function syncIdentityFromSeed() {
    const ok = window.confirm(
      "将按代码种子覆盖所有系统角色的权限与数据范围，并重置种子中的部门→角色映射。自定义角色不受影响。是否继续？",
    )
    if (!ok) return
    setSyncingSeed(true)
    try {
      const res = await fetch("/api/rbac/sync-identity", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        roles?: RbacRole[]
        cacheInvalidated?: boolean
      }
      if (!res.ok) {
        toast.error(data.error ?? "从种子恢复失败")
        return
      }
      if (data.roles) setRoles(data.roles)
      toast.success(
        data.cacheInvalidated === false
          ? "已按种子恢复；缓存失效可能延迟约 2 分钟"
          : "已按代码种子恢复系统角色权限",
      )
      void refreshUsers()
    } catch {
      toast.error("从种子恢复失败")
    } finally {
      setSyncingSeed(false)
    }
  }

  async function updateUserRbac(userId: string, patch: Record<string, unknown>) {
    const fail = async (res: Response, fallback: string) => {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(body.error ?? fallback)
    }

    if ("permissionOverrides" in patch) {
      const overrides = (Array.isArray(patch.permissionOverrides) ? patch.permissionOverrides : []).map(
        (item) => {
          const row = item as { permissionCode?: string; granted?: boolean }
          return {
            userId,
            permissionCode: String(row.permissionCode ?? ""),
            granted: Boolean(row.granted),
          }
        },
      )
      const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      })
      if (!res.ok) {
        await fail(res, "更新权限覆盖失败")
        return
      }
    }

    if ("dataScopeOverride" in patch) {
      const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/data-scope`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataScope: patch.dataScopeOverride ?? null }),
      })
      if (!res.ok) {
        await fail(res, "更新数据范围失败")
        return
      }
    }

    if ("roleLocked" in patch) {
      const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: Boolean(patch.roleLocked) }),
      })
      if (!res.ok) {
        await fail(res, "更新锁定状态失败")
        return
      }
    }

    await refreshUsers()
    toast.success("用户权限已更新")
  }

  async function toggleMemberRoleBinding(
    member: { feishuOpenId: string; name: string },
    roleCode: string,
    enabled: boolean,
    departmentNames?: string[],
  ) {
    const profile = users.find((u) => u.feishuOpenId === member.feishuOpenId)
    if (!profile) {
      if (!enabled) return
      const res = await fetch("/api/users/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feishuOpenId: member.feishuOpenId,
          name: member.name,
          departmentNames: departmentNames ?? [],
          roleCodes: [roleCode],
          primaryRoleCode: roleCode,
        }),
      })
      if (!res.ok) {
        toast.error((await res.json()).error ?? "开通失败")
        return
      }
      toast.success(`已为「${member.name}」开通并设为该身份`)
      void load(true)
      return
    }
    await toggleUserRoleBinding(profile.id, roleCode, enabled)
  }

  async function toggleUserRoleBinding(userId: string, roleCode: string, enabled: boolean) {
    const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/role-toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleCode, enabled }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? "更新绑定失败")
      return
    }
    toast.success(enabled ? "已切换为该身份" : "已取消该身份")
    void refreshUsers()
  }

  async function grantDirectoryUser(person: DirectoryUser) {
    const existing = users.find((u) => u.feishuOpenId === person.feishuOpenId)
    if (existing) {
      const already = existing.roles.some((r) => r.code === grantRoleCode)
      if (already) {
        toast.message(`「${person.name}」已拥有该角色`)
        return
      }
      await toggleUserRoleBinding(existing.id, grantRoleCode, true)
      return
    }

    const res = await fetch("/api/users/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feishuOpenId: person.feishuOpenId,
        name: person.name,
        departmentNames: person.departmentNames,
        roleCodes: [grantRoleCode],
        primaryRoleCode: grantRoleCode,
      }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? "添加失败")
      return
    }
    toast.success(`已为「${person.name}」开通访问（${roles.find((r) => r.code === grantRoleCode)?.name ?? grantRoleCode}）`)
    setDirectoryQuery("")
    setDirectoryResults([])
    void load(true)
  }

  async function loadDepartmentMembers(dept: DirectoryDepartment, subtree: boolean) {
    deptMembersAbortRef.current?.abort()
    const ac = new AbortController()
    deptMembersAbortRef.current = ac
    const reqId = ++deptMembersReqIdRef.current

    setDeptMembers([])
    setDeptMembersLoading(true)
    try {
      const res = await fetch("/api/users/directory/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: dept.id, subtree }),
        signal: ac.signal,
      })
      if (reqId !== deptMembersReqIdRef.current) return
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? "加载部门成员失败")
        return
      }
      const data = (await res.json()) as { members?: Array<{ feishuOpenId: string; name: string }> }
      if (reqId !== deptMembersReqIdRef.current) return
      setDeptMembers(data.members ?? [])
    } catch (error) {
      if (ac.signal.aborted) return
      if (error instanceof DOMException && error.name === "AbortError") return
      toast.error(error instanceof Error ? error.message : "加载部门成员失败")
    } finally {
      if (reqId === deptMembersReqIdRef.current) {
        setDeptMembersLoading(false)
      }
    }
  }

  async function loadDeptChildren(parentId: string) {
    if (isDeptChildrenLoaded(parentId)) return
    const existing = deptChildrenInflight.get(parentId)
    if (existing) {
      const children = await existing
      setDeptTreeChildren((prev) => (prev[parentId] ? prev : { ...prev, [parentId]: children }))
      return
    }

    setDeptTreeLoading((prev) => ({ ...prev, [parentId]: true }))
    const request = (async () => {
      const res = await fetch("/api/users/directory/department-children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "加载部门子部门失败")
      }
      const data = (await res.json()) as { children?: DirectoryDepartment[] }
      return (data.children ?? []).map((d) => ({
        ...d,
        name: formatDepartmentDisplayName(d.name),
      }))
    })()
    deptChildrenInflight.set(parentId, request)
    try {
      const children = await request
      setDeptTreeChildren((prev) => ({ ...prev, [parentId]: children }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载子部门失败")
    } finally {
      deptChildrenInflight.delete(parentId)
      setDeptTreeLoading((prev) => ({ ...prev, [parentId]: false }))
    }
  }

  async function applyRoleToDepartment(mode: "add" | "remove") {
    if (!selectedDept) return
    if (deptMembers.length === 0) {
      toast.message("请先加载部门成员")
      return
    }

    let changed = 0
    let failed = 0
    let skippedLocked = 0
    for (const m of deptMembers) {
      const existing = users.find((u) => u.feishuOpenId === m.feishuOpenId)
      try {
        if (mode === "add") {
          if (!existing) {
            const res = await fetch("/api/users/grant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                feishuOpenId: m.feishuOpenId,
                name: m.name,
                departmentNames: [selectedDept.name],
                roleCodes: [deptBulkRoleCode],
                primaryRoleCode: deptBulkRoleCode,
              }),
            })
            if (!res.ok) throw new Error("grant failed")
            changed++
            continue
          }
          const hasRole = existing.roles.some((r) => r.code === deptBulkRoleCode)
          if (hasRole) continue
          const res = await fetch(`/api/rbac/users/${encodeURIComponent(existing.id)}/role-toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roleCode: deptBulkRoleCode, enabled: true }),
          })
          if (!res.ok) throw new Error("toggle failed")
          changed++
        } else {
          if (!existing) continue
          if (existing.roleLocked) {
            skippedLocked++
            continue
          }
          const hasRole = existing.roles.some((r) => r.code === deptBulkRoleCode)
          if (!hasRole) continue
          const res = await fetch(`/api/rbac/users/${encodeURIComponent(existing.id)}/role-toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roleCode: deptBulkRoleCode, enabled: false }),
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? "toggle failed")
          }
          changed++
        }
      } catch {
        failed++
      }
    }

    await load(true)
    const actionLabel = mode === "add" ? "追加" : "移除"
    const parts: string[] = []
    if (changed > 0) parts.push(`成功 ${changed}`)
    if (skippedLocked > 0) parts.push(`跳过锁定 ${skippedLocked}`)
    if (failed > 0) parts.push(`失败 ${failed}`)
    if (parts.length === 0) {
      toast.message(
        mode === "remove" && skippedLocked > 0
          ? "所选成员均已锁定，未移除任何角色"
          : `没有需要${actionLabel}的成员`,
      )
    } else if (failed > 0 || skippedLocked > 0) {
      toast.warning(`部门批量${actionLabel}完成：${parts.join("，")}`)
    } else {
      toast.success(`部门批量${actionLabel}完成：${changed} 人`)
    }
  }

  function isDeptChildrenLoaded(parentId: string) {
    return Object.prototype.hasOwnProperty.call(deptTreeChildren, parentId)
  }

  const currentNavParentId =
    deptNavPath.length > 0 ? deptNavPath[deptNavPath.length - 1].id : TREE_ROOT_PARENT_ID
  const currentChildDepts = deptTreeChildren[currentNavParentId] ?? []
  const currentDeptLoading = Boolean(deptTreeLoading[currentNavParentId])

  function resetDeptMembers() {
    setDeptMembers([])
  }

  function navigateDeptBreadcrumb(index: number) {
    if (index < 0) {
      setDeptNavPath([])
      setSelectedDept(null)
    } else {
      const newPath = deptNavPath.slice(0, index + 1)
      setDeptNavPath(newPath)
      setSelectedDept(newPath[newPath.length - 1] ?? null)
    }
    resetDeptMembers()
  }

  async function enterDepartment(dept: DirectoryDepartment) {
    const normalized = { ...dept, name: formatDepartmentDisplayName(dept.name) }
    setDeptNavPath((prev) => [...prev, normalized])
    setSelectedDept(normalized)
    resetDeptMembers()
    if (!isDeptChildrenLoaded(dept.id)) {
      await loadDeptChildren(dept.id)
    }
  }

  async function jumpToDepartment(dept: DirectoryDepartment) {
    const normalized = { ...dept, name: formatDepartmentDisplayName(dept.name) }
    setDeptNavPath([normalized])
    setSelectedDept(normalized)
    resetDeptMembers()
    if (!isDeptChildrenLoaded(dept.id)) {
      await loadDeptChildren(dept.id)
    }
  }

  // 按面包屑当前层级加载子部门（含初始根节点）
  useEffect(() => {
    const parentId =
      deptNavPath.length > 0 ? deptNavPath[deptNavPath.length - 1].id : TREE_ROOT_PARENT_ID
    if (isDeptChildrenLoaded(parentId) || deptTreeLoading[parentId]) return
    void loadDeptChildren(parentId)
     
  }, [deptNavPath])

  useEffect(() => {
    if (!selectedDept) {
      deptMembersAbortRef.current?.abort()
      deptMembersReqIdRef.current += 1
      setDeptMembers([])
      setDeptMembersLoading(false)
      return
    }
    setMemberFilterText("")
    void loadDepartmentMembers(selectedDept, includeSubtree)
    return () => {
      deptMembersAbortRef.current?.abort()
    }
     
  }, [selectedDept?.id, includeSubtree])

  const filteredUsers = users.filter((u) => {
    const q = userFilter.trim().toLowerCase()
    const deptLabel = (u.manualDepartmentName ?? u.departmentNames[0] ?? "").toLowerCase()
    if (!q) return true
    return (
      u.name.toLowerCase().includes(q) ||
      u.feishuOpenId.toLowerCase().includes(q) ||
      deptLabel.includes(q) ||
      u.departmentNames.some((d) => d.toLowerCase().includes(q))
    )
  })

  const visibleDeptMembers = deptMembers.filter((m) => {
    const q = memberFilterText.trim().toLowerCase()
    if (q) {
      const ok = m.name.toLowerCase().includes(q) || m.feishuOpenId.toLowerCase().includes(q)
      if (!ok) return false
    }
    const profile = users.find((u) => u.feishuOpenId === m.feishuOpenId)
    // 与「负责人」徽章同一判定（含配置 meta），避免只亮徽章却筛不出来
    if (onlyAssignedToDept && profile?.manualDepartmentOpenId !== selectedDept?.id) {
      return false
    }
    if (onlyLeaders) {
      return isDeptMemberLeader(m, profile, selectedDept, deptLeaderMeta)
    }
    return true
  })

  const autoLoginDepartments = rbacMeta?.autoLoginRules.map((rule) => rule.departmentName) ?? []
  const dataScopeLabels = rbacMeta?.dataScopeLabels ?? {
    own: "仅本人数据",
    department: "本部门数据",
    all: "全部数据",
  }

  function renderUserFineTunePanel(user: AdminUser) {
    const grouped = groupPermissionsByModule(permissionRows)
    return (
      <>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          「{user.name}」权限细调（可选，一般勾选角色即可）
        </p>
        <div className="space-y-3">
          {grouped.map((group) => (
            <div key={group.module} className="rounded-lg border border-border bg-muted/20 p-2.5">
              <p className="mb-2 text-[11px] font-semibold text-foreground">{group.module}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.permissions.map((permission) => {
                  const inRole = user.effectivePermissions.includes(permission.code)
                  const override = user.permissionOverrides.find((o) => o.permissionCode === permission.code)
                  const state = override ? (override.granted ? "grant" : "deny") : "inherit"
                  return (
                    <div
                      key={permission.code}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                    >
                      <span className="truncate text-[11px]" title={permission.code}>
                        {permission.name}
                      </span>
                      <select
                        value={state}
                        onChange={(e) => {
                          const val = e.target.value as "inherit" | "grant" | "deny"
                          const base = user.permissionOverrides.filter((o) => o.permissionCode !== permission.code)
                          const next =
                            val === "inherit"
                              ? base
                              : [...base, { permissionCode: permission.code, granted: val === "grant" }]
                          updateUserRbac(user.id, {
                            permissionOverrides: next,
                            roleLocked: true,
                          })
                        }}
                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                      >
                        <option value="inherit">{inRole ? "继承(有)" : "继承(无)"}</option>
                        <option value="grant">强制授予</option>
                        <option value="deny">强制拒绝</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">数据范围覆盖：</span>
          <select
            value={user.dataScopeOverride ?? ""}
            onChange={(e) => {
              const val = e.target.value
              updateUserRbac(user.id, {
                dataScopeOverride: val === "" ? null : (val as DataScope),
                roleLocked: true,
              })
            }}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">继承角色（{dataScopeLabels[user.effectiveDataScope]}）</option>
            <option value="own">{dataScopeLabels.own}</option>
            <option value="department">{dataScopeLabels.department}</option>
            <option value="all">{dataScopeLabels.all}</option>
          </select>
        </div>
      </>
    )
  }

  if (loading && roles.length === 0) {
    return <ContentLoadingBlock label="加载用户与权限配置…" minHeightClassName="min-h-[60vh]" />
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium">人员与角色绑定</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              飞书通讯录、系统账号、登录权限三者相互独立。每人仅绑定一个身份（多选历史数据会自动保留权限最高者）。组织信息由后台每 3 小时自动同步；按姓名搜索用于零散添加，按部门授权用于批量切换身份。
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-800 dark:text-sky-300">
              飞书通讯录
            </span>
            <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-400">
              系统账号
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
              登录权限
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <UserPlus className="size-4" />
            按姓名搜索（零散添加）
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            已知姓名时快速开通；批量操作建议使用下方「按部门授权」。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={directoryQuery}
                onChange={(e) => setDirectoryQuery(e.target.value)}
                placeholder="搜索同事姓名（如：张三）"
                className="h-9 pl-9 text-sm"
              />
            </div>
            <select
              value={grantRoleCode}
              onChange={(e) => setGrantRoleCode(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {businessGrantRoles.map((role) => (
                <option key={role.id} value={role.code}>
                  添加为：{role.name}
                </option>
              ))}
            </select>
          </div>
          {directoryLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">搜索中…</p>
          ) : directoryResults.length > 0 ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {directoryResults.map((person) => {
                const existing = users.find((u) => u.feishuOpenId === person.feishuOpenId)
                const access = resolvePersonAccess(person, existing, autoLoginDepartments)
                return (
                  <li
                    key={person.feishuOpenId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{person.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {person.departmentNames.length > 0
                          ? person.departmentNames.map((d) => formatDepartmentPath(d)).join("、")
                          : "部门未知"}
                      </p>
                      <AccessStatusBadges access={access} />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => grantDirectoryUser(person)}
                      disabled={access.inSystem && existing?.roles.some((r) => r.code === grantRoleCode)}
                    >
                      {access.inSystem
                        ? existing?.roles.some((r) => r.code === grantRoleCode)
                          ? "已有该角色"
                          : "追加角色"
                        : "开通并授权"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          ) : directoryQuery.trim() ? (
            <p className="mt-2 text-xs text-muted-foreground">未找到匹配同事</p>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-secondary/40 px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="size-4" />
              按部门授权与角色绑定
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              左侧选部门，右侧直接选择唯一身份；未开通系统账号的成员，勾选时将自动开通。切换身份会替换原身份，不会叠加。
            </p>
          </div>

          <div className="grid lg:grid-cols-[minmax(240px,280px)_1fr] lg:divide-x divide-border">
            <div className="border-b lg:border-b-0 border-border p-3">
              <Input
                value={deptQuery}
                onChange={(e) => setDeptQuery(e.target.value)}
                placeholder="搜索部门（如：技术部）"
                className="mb-2 h-8 text-xs"
              />
              {deptLoading ? (
                <p className="mb-2 text-xs text-muted-foreground">搜索部门中…</p>
              ) : deptResults.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {deptResults.slice(0, 12).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setMemberListMode("dept")
                        void jumpToDepartment(d)
                      }}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        selectedDept?.id === d.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent/50",
                      )}
                    >
                      {formatDepartmentDisplayName(d.name)}
                    </button>
                  ))}
                </div>
              ) : deptQuery.trim() ? (
                <p className="mb-2 text-xs text-muted-foreground">未找到匹配部门</p>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-secondary/40 px-2 py-2">
                  <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => navigateDeptBreadcrumb(-1)}
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-accent/60",
                        deptNavPath.length === 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {ORG_ROOT_NAME}
                    </button>
                    {deptNavPath.map((dept, index) => (
                      <Fragment key={dept.id}>
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
                        <button
                          type="button"
                          onClick={() => navigateDeptBreadcrumb(index)}
                          className={cn(
                            "max-w-[8rem] truncate rounded px-1 py-0.5 transition-colors hover:bg-accent/60",
                            index === deptNavPath.length - 1
                              ? "font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          title={formatDepartmentDisplayName(dept.name)}
                        >
                          {formatDepartmentDisplayName(dept.name)}
                        </button>
                      </Fragment>
                    ))}
                  </nav>
                </div>
                <div className="max-h-64 overflow-auto">
                  {currentDeptLoading && currentChildDepts.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">加载部门中…</p>
                  ) : currentChildDepts.length === 0 ? (
                    deptNavPath.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">暂无一级部门</p>
                    ) : (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">
                          {formatDepartmentDisplayName(
                            selectedDept?.name ?? deptNavPath[deptNavPath.length - 1]?.name ?? "",
                          )}
                        </p>
                        <p className="mt-1 leading-relaxed">已定位至该部门，成员与角色请在右侧操作。</p>
                      </div>
                    )
                  ) : (
                    <div className="divide-y divide-border/70">
                      {currentChildDepts.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setMemberListMode("dept")
                            void enterDepartment(d)
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-xs transition-colors hover:bg-accent/40",
                            selectedDept?.id === d.id && "bg-primary/5",
                          )}
                        >
                          <span className="truncate">{formatDepartmentDisplayName(d.name)}</span>
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/20 px-3 py-2">
                {selectedDept && memberListMode === "dept" ? (
                  <span className="max-w-[14rem] truncate text-sm font-medium">
                    {formatDepartmentDisplayName(selectedDept.name)}
                    {deptMembersLoading ? " · 加载中…" : ` · ${visibleDeptMembers.length} 人`}
                  </span>
                ) : memberListMode === "all" ? (
                  <span className="text-sm font-medium">全部已开通用户 · {filteredUsers.length} 人</span>
                ) : (
                  <span className="text-xs text-muted-foreground">← 请在左侧选择部门</span>
                )}

                {memberListMode === "dept" && selectedDept ? (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeSubtree}
                      onChange={(e) => setIncludeSubtree(e.target.checked)}
                    />
                    含子部门
                  </label>
                ) : null}

                <div className="flex rounded-md border border-border p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMemberListMode("dept")}
                    className={cn(
                      "rounded px-2 py-1 transition-colors",
                      memberListMode === "dept" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    部门成员
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemberListMode("all")}
                    className={cn(
                      "rounded px-2 py-1 transition-colors",
                      memberListMode === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    全部已开通
                  </button>
                </div>

                <Input
                  value={memberListMode === "dept" ? memberFilterText : userFilter}
                  onChange={(e) =>
                    memberListMode === "dept"
                      ? setMemberFilterText(e.target.value)
                      : setUserFilter(e.target.value)
                  }
                  placeholder="筛选姓名 / 飞书 ID"
                  className="ml-auto h-8 w-40 text-xs"
                />

                {memberListMode === "dept" && selectedDept && !deptMembersLoading && deptMembers.length > 0 ? (
                  <>
                    <select
                      value={deptBulkRoleCode}
                      onChange={(e) => setDeptBulkRoleCode(e.target.value)}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                      title="选择批量操作要追加或移除的角色"
                    >
                      {businessGrantRoles.map((r) => (
                        <option key={r.id} value={r.code}>
                          批量角色：{r.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => applyRoleToDepartment("add")}
                    >
                      整部门设为
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => applyRoleToDepartment("remove")}
                    >
                      整部门取消该身份
                    </Button>
                  </>
                ) : null}
              </div>

              <MemberListPanel
                filterRow={
                  memberListMode === "dept" && selectedDept ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={onlyAssignedToDept}
                          onChange={(e) => setOnlyAssignedToDept(e.target.checked)}
                        />
                        仅已标注到该部门
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={onlyLeaders}
                          onChange={(e) => setOnlyLeaders(e.target.checked)}
                        />
                        仅负责人
                      </label>
                    </div>
                  ) : undefined
                }
              >
                {memberListMode === "dept" ? (
                  !selectedDept ? (
                    <MemberListPlaceholder>请在左侧选择部门，成员将自动加载</MemberListPlaceholder>
                  ) : deptMembersLoading ? (
                    <MemberListPlaceholder>加载部门成员中…</MemberListPlaceholder>
                  ) : visibleDeptMembers.length === 0 ? (
                    <MemberListPlaceholder>
                      {deptMembers.length === 0 ? "该部门暂无成员" : "没有符合筛选条件的成员"}
                    </MemberListPlaceholder>
                  ) : (
                    <PaginatedMemberList
                      rows={visibleDeptMembers.map((m) => {
                        const profile = users.find((u) => u.feishuOpenId === m.feishuOpenId)
                        return {
                          key: m.feishuOpenId,
                          member: m,
                          profile,
                          deptNames: selectedDept ? [selectedDept.name] : [],
                          isLeader: isDeptMemberLeader(m, profile, selectedDept, deptLeaderMeta),
                        }
                      })}
                      totalCount={visibleDeptMembers.length}
                      resetKey={`${selectedDept?.id ?? ""}:${includeSubtree}:${memberFilterText}:${onlyAssignedToDept}:${onlyLeaders}`}
                      roles={visibleRoles}
                      editableRoleCodes={editableRoleCodes}
                      designatedSuperAdminOpenId={designatedSuperAdminOpenId}
                      actorIsSuperAdmin={actorIsSuperAdmin}
                      selectedUserId={selectedUserId}
                      setSelectedUserId={setSelectedUserId}
                      onToggleRole={(row, roleCode, enabled) =>
                        void toggleMemberRoleBinding(row.member, roleCode, enabled, row.deptNames)
                      }
                      onToggleLock={(user) => void updateUserRbac(user.id, { roleLocked: !user.roleLocked })}
                      renderFineTune={renderUserFineTunePanel}
                      autoLoginDepartments={autoLoginDepartments}
                    />
                  )
                ) : filteredUsers.length === 0 ? (
                  <MemberListPlaceholder>暂无已开通系统账号的用户</MemberListPlaceholder>
                ) : (
                  <PaginatedMemberList
                    rows={filteredUsers.map((user) => ({
                      key: user.id,
                      member: { feishuOpenId: user.feishuOpenId, name: user.name },
                      profile: user,
                      deptNames: user.departmentNames.map((d) => formatDepartmentPath(d) || d),
                      isLeader:
                        user.manualDepartmentLeader ||
                        (user.feishuLedDepartmentIds?.length ?? 0) > 0,
                    }))}
                    totalCount={filteredUsers.length}
                    resetKey={userFilter}
                    roles={visibleRoles}
                    editableRoleCodes={editableRoleCodes}
                    designatedSuperAdminOpenId={designatedSuperAdminOpenId}
                    actorIsSuperAdmin={actorIsSuperAdmin}
                    selectedUserId={selectedUserId}
                    setSelectedUserId={setSelectedUserId}
                    onToggleRole={(row, roleCode, enabled) => {
                      if (!row.profile) return
                      void toggleUserRoleBinding(row.profile.id, roleCode, enabled)
                    }}
                    onToggleLock={(user) => void updateUserRbac(user.id, { roleLocked: !user.roleLocked })}
                    renderFineTune={renderUserFineTunePanel}
                    autoLoginDepartments={autoLoginDepartments}
                  />
                )}
              </MemberListPanel>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            发版后若需把系统角色对齐到仓库种子（含最近客户成功/售前等调整），点此恢复。
            {!actorIsSuperAdmin ? "（仅超级管理员可操作）" : ""}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncingSeed || !actorIsSuperAdmin}
            onClick={() => void syncIdentityFromSeed()}
          >
            {syncingSeed ? "恢复中…" : "从代码种子恢复系统角色"}
          </Button>
        </div>
        <RolePermissionMatrix
          roles={roles}
          permissionRows={permissionRows}
          dataScopeLabels={dataScopeLabels}
          onTogglePermission={toggleRolePermission}
          onUpdateDataScope={updateRoleDataScope}
        />
      </section>
    </div>
  )
}
