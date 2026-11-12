"use client"

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { Check, Lock, Unlock, X } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import type { AdminUser, DirectoryDepartment, RbacRole } from "./rbac-config-api"

type PersonAccessStatus = {
  inSystem: boolean
  loginHint: "active" | "auto" | "grant_required"
}

export interface DeptLeaderMeta {
  leadersByDeptId: Record<string, string>
  leaderProfiles: Array<{ feishuOpenId: string; departmentOpenId: string; name: string }>
}

export interface MemberRoleRow {
  key: string
  member: { feishuOpenId: string; name: string }
  profile: AdminUser | undefined
  deptNames: string[]
  isLeader?: boolean
}

export function departmentMatchesConfigured(names: string[], configured: string[]): boolean {
  const normalized = names.map((d) => d.trim()).filter(Boolean)
  return normalized.some((dept) =>
    configured.some((c) => dept === c || dept.includes(c) || c.includes(dept)),
  )
}

export function resolvePersonAccess(
  person: { departmentNames: string[] },
  existing: AdminUser | undefined,
  autoLoginDepartments: string[],
): PersonAccessStatus {
  const inSystem = Boolean(existing)
  if (inSystem && (existing?.roles.length ?? 0) > 0) {
    return { inSystem: true, loginHint: "active" }
  }
  if (!inSystem && departmentMatchesConfigured(person.departmentNames, autoLoginDepartments)) {
    return { inSystem: false, loginHint: "auto" }
  }
  return { inSystem, loginHint: "grant_required" }
}

export function AccessStatusBadges({ access }: { access: PersonAccessStatus }) {
  const loginMeta = {
    active: {
      text: "可飞书登录",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    auto: {
      text: "符合部门规则，首次登录自动开通",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400",
    },
    grant_required: {
      text: "需手动授权后可登录",
      className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-400",
    },
  }[access.loginHint]

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-800 dark:text-sky-300">
        飞书通讯录
      </span>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px]",
          access.inSystem
            ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400"
            : "border-muted-foreground/30 bg-muted/50 text-muted-foreground",
        )}
      >
        {access.inSystem ? "系统账号已开通" : "系统账号未开通"}
      </span>
      <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", loginMeta.className)}>
        {loginMeta.text}
      </span>
    </div>
  )
}

export function SystemUserStatusBadges({ user }: { user: AdminUser }) {
  const canLogin = user.roles.length > 0
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-400">
        系统账号已开通
      </span>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px]",
          canLogin
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-400",
        )}
      >
        {canLogin ? "可飞书登录" : "需绑定角色"}
      </span>
      <span className="rounded-full border border-muted-foreground/30 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
        {user.roleSource === "manual" ? "手动授权" : "部门/同步开通"}
      </span>
    </div>
  )
}

export function isDeptMemberLeader(
  member: { name: string; feishuOpenId: string },
  profile: AdminUser | undefined,
  dept: DirectoryDepartment | null,
  meta: DeptLeaderMeta | null,
): boolean {
  if (!dept) return false
  if (profile?.feishuLedDepartmentIds?.includes(dept.id)) return true
  if (profile?.manualDepartmentOpenId === dept.id && profile.manualDepartmentLeader) return true
  if (meta?.leadersByDeptId[dept.id]?.trim() === member.name.trim()) return true
  return Boolean(
    meta?.leaderProfiles.some(
      (p) => p.feishuOpenId === member.feishuOpenId && p.departmentOpenId === dept.id,
    ),
  )
}

export function MemberRoleTable({
  rows,
  roles,
  editableRoleCodes,
  designatedSuperAdminOpenId,
  actorIsSuperAdmin,
  selectedUserId,
  setSelectedUserId,
  onToggleRole,
  onToggleLock,
  renderFineTune,
  autoLoginDepartments,
}: {
  rows: MemberRoleRow[]
  roles: RbacRole[]
  /** 当前操作方可勾选的身份；不含的列只读展示 */
  editableRoleCodes: Set<string>
  designatedSuperAdminOpenId: string | null
  actorIsSuperAdmin: boolean
  selectedUserId: string | null
  setSelectedUserId: (id: string | null) => void
  onToggleRole: (row: MemberRoleRow, roleCode: string, enabled: boolean) => void
  onToggleLock: (user: AdminUser) => void
  renderFineTune: (user: AdminUser) => ReactNode
  autoLoginDepartments: string[]
}) {
  return (
    <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="sticky top-0 left-0 z-30 min-w-max whitespace-nowrap border-b border-border bg-card px-3 py-2.5 font-medium">
            成员 / 状态
          </th>
          {roles.map((role) => (
            <th
              key={role.id}
              className="sticky top-0 z-20 min-w-max whitespace-nowrap border-b border-border bg-card px-1.5 py-2.5 text-center font-medium"
            >
              <span>{role.name}</span>
            </th>
          ))}
          <th className="sticky top-0 z-20 min-w-max whitespace-nowrap border-b border-border bg-card px-1.5 py-2.5 text-center font-medium">
            锁定
          </th>
          <th className="sticky top-0 z-20 min-w-max whitespace-nowrap border-b border-border bg-card px-1.5 py-2.5 text-center font-medium">
            细调
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const access = resolvePersonAccess({ departmentNames: row.deptNames }, row.profile, autoLoginDepartments)
          const expandId = row.profile?.id ?? null
          const openId = row.profile?.feishuOpenId ?? row.member.feishuOpenId
          const isDesignated = Boolean(designatedSuperAdminOpenId && openId === designatedSuperAdminOpenId)
          const isOrphanSa =
            row.profile?.role === "super_admin" &&
            Boolean(designatedSuperAdminOpenId) &&
            openId !== designatedSuperAdminOpenId
          // 指定超管只读；异常超管仅真实超管可收口；管理员不可改任意超管
          const rowProtected = isDesignated || ((row.profile?.role === "super_admin" || isDesignated) && !actorIsSuperAdmin)
          const canRemediateOrphan = actorIsSuperAdmin && isOrphanSa
          return (
            <Fragment key={row.key}>
              <tr className={isDesignated || isOrphanSa ? "bg-muted/30" : undefined}>
                <td className="sticky left-0 z-10 border-b border-border bg-card px-3 py-2">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span>{row.member.name}</span>
                    {row.profile?.employmentStatus === "resigned" ? (
                      <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-0 text-[10px] font-medium text-orange-800 dark:text-orange-300">
                        已离职
                      </span>
                    ) : null}
                    {isDesignated ? (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary">
                        超级管理员
                      </span>
                    ) : null}
                    {isOrphanSa ? (
                      <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">
                        异常超管{canRemediateOrphan ? "（可收口）" : ""}
                      </span>
                    ) : null}
                    {row.isLeader ? (
                      <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-1.5 py-0 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                        负责人
                      </span>
                    ) : null}
                  </p>
                  {row.profile ? (
                    <SystemUserStatusBadges user={row.profile} />
                  ) : (
                    <AccessStatusBadges access={access} />
                  )}
                </td>
                {roles.map((role) => {
                  const assigned = row.profile?.roles.some((r) => r.id === role.id) ?? false
                  const canEdit =
                    !isDesignated &&
                    (canRemediateOrphan
                      ? role.code !== "super_admin"
                      : !rowProtected && editableRoleCodes.has(role.code))
                  return (
                    <td key={role.id} className="border-b border-border px-1.5 py-2 text-center">
                      <button
                        type="button"
                        disabled={!canEdit && !(canRemediateOrphan && role.code === "super_admin" && assigned)}
                        onClick={() => {
                          // 异常超管：允许取消超管身份或切换为其他可赋身份
                          if (canRemediateOrphan && role.code === "super_admin" && assigned) {
                            onToggleRole(row, role.code, false)
                            return
                          }
                          if (!canEdit) return
                          onToggleRole(row, role.code, !assigned)
                        }}
                        className={cn(
                          "mx-auto flex size-7 items-center justify-center rounded-md border border-border transition-colors",
                          canEdit || (canRemediateOrphan && role.code === "super_admin" && assigned)
                            ? "hover:bg-accent/50"
                            : "cursor-not-allowed opacity-60",
                        )}
                        title={
                          isDesignated
                            ? "超级管理员身份不可在此修改"
                            : canRemediateOrphan && role.code === "super_admin" && assigned
                              ? "取消异常超管身份"
                              : !canEdit
                                ? role.code === "admin"
                                  ? "仅超级管理员可设置管理员"
                                  : role.code === "super_admin"
                                    ? "超级管理员唯一且固定"
                                    : "无权限修改该身份"
                                : row.profile
                                  ? assigned
                                    ? "取消该身份"
                                    : "切换为该身份（替换原身份）"
                                  : assigned
                                    ? ""
                                    : "勾选以开通账号并设为该身份"
                        }
                      >
                        {assigned ? (
                          <Check className="size-4 text-primary" />
                        ) : (
                          <X className="size-4 text-muted-foreground/30" />
                        )}
                      </button>
                    </td>
                  )
                })}
                <td className="border-b border-border px-1.5 py-2 text-center">
                  {row.profile ? (
                    <button
                      type="button"
                      disabled={rowProtected && !canRemediateOrphan}
                      onClick={() => {
                        if (rowProtected && !canRemediateOrphan) return
                        onToggleLock(row.profile!)
                      }}
                      className={cn(
                        "mx-auto flex size-7 items-center justify-center rounded-md border border-border",
                        rowProtected && !canRemediateOrphan
                          ? "cursor-not-allowed opacity-60"
                          : "hover:bg-accent/50",
                      )}
                      title={
                        isDesignated
                          ? "不可修改超级管理员"
                          : row.profile.roleLocked
                            ? "已锁定：飞书登录不覆盖角色，整部门移除也会跳过"
                            : "未锁定：飞书登录可同步角色，可被整部门移除"
                      }
                    >
                      {row.profile.roleLocked ? (
                        <Lock className="size-3.5 text-primary" />
                      ) : (
                        <Unlock className="size-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
                <td className="border-b border-border px-1.5 py-2 text-center">
                  {row.profile && (!rowProtected || canRemediateOrphan) && !isDesignated ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setSelectedUserId(selectedUserId === expandId ? null : expandId)}
                    >
                      {selectedUserId === expandId ? "收起" : "细调"}
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
              {row.profile && !isDesignated && (!rowProtected || canRemediateOrphan) && selectedUserId === expandId ? (
                <tr className="bg-secondary/20">
                  <td colSpan={roles.length + 3} className="border-b border-border px-3 py-3">
                    {renderFineTune(row.profile)}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

export const ALL_USERS_PAGE_SIZE = 10
export const MEMBER_LIST_PANEL_HEIGHT = "h-[min(70vh,640px)]"

export function MemberListPanel({ filterRow, children }: { filterRow?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        MEMBER_LIST_PANEL_HEIGHT,
        "flex min-h-0 flex-col overflow-hidden border-t border-border/60",
      )}
    >
      {filterRow ? (
        <div className="shrink-0 border-b border-border px-3 py-1.5">{filterRow}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

export function MemberListPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export function PaginatedMemberList({
  rows,
  totalCount,
  resetKey,
  roles,
  editableRoleCodes,
  designatedSuperAdminOpenId,
  actorIsSuperAdmin,
  selectedUserId,
  setSelectedUserId,
  onToggleRole,
  onToggleLock,
  renderFineTune,
  autoLoginDepartments,
}: {
  rows: MemberRoleRow[]
  totalCount: number
  resetKey: string
  roles: RbacRole[]
  editableRoleCodes: Set<string>
  designatedSuperAdminOpenId: string | null
  actorIsSuperAdmin: boolean
  selectedUserId: string | null
  setSelectedUserId: (id: string | null) => void
  onToggleRole: (row: MemberRoleRow, roleCode: string, enabled: boolean) => void
  onToggleLock: (user: AdminUser) => void
  renderFineTune: (user: AdminUser) => ReactNode
  autoLoginDepartments: string[]
}) {
  const [visibleCount, setVisibleCount] = useState(ALL_USERS_PAGE_SIZE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(ALL_USERS_PAGE_SIZE)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [totalCount, resetKey])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || visibleCount >= totalCount) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + ALL_USERS_PAGE_SIZE, totalCount))
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleCount, totalCount])

  const visibleRows = rows.slice(0, visibleCount)
  const hasMore = visibleCount < totalCount

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <MemberRoleTable
        rows={visibleRows}
        roles={roles}
        editableRoleCodes={editableRoleCodes}
        designatedSuperAdminOpenId={designatedSuperAdminOpenId}
        actorIsSuperAdmin={actorIsSuperAdmin}
        selectedUserId={selectedUserId}
        setSelectedUserId={setSelectedUserId}
        onToggleRole={onToggleRole}
        onToggleLock={onToggleLock}
        renderFineTune={renderFineTune}
        autoLoginDepartments={autoLoginDepartments}
      />
      <div ref={sentinelRef} className="border-t border-border/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
        {hasMore ? `已显示 ${visibleCount} / ${totalCount} 人，继续向下滚动加载更多` : `共 ${totalCount} 人`}
      </div>
    </div>
  )
}
