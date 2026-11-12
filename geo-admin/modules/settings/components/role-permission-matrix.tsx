"use client"

import { Fragment, useMemo, useState } from "react"
import { Check, ChevronDown, Search, ShieldCheck, X } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { cn } from "@/shared/lib/utils"
import type { DataScope, Permission } from "@/modules/auth/lib/permissions"
import {
  groupPermissionsByModule,
  type CatalogPermissionRow,
} from "@/modules/rbac/lib/rbac-seed-data"

export interface MatrixRole {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScope
  isSystem: boolean
  permissions: Permission[]
}

interface RolePermissionMatrixProps {
  roles: MatrixRole[]
  permissionRows: CatalogPermissionRow[]
  dataScopeLabels: Record<DataScope, string>
  onTogglePermission: (roleId: string, permission: Permission, enabled: boolean) => void
  onUpdateDataScope: (roleId: string, dataScope: DataScope) => void
}

const DATA_SCOPE_KEY = "__data_scope__"
const DATA_SCOPE_HINT =
  "控制需求单、打卡等模块可见的数据范围：仅本人 / 本部门同事 / 全部。团队打卡记录另需「查看团队打卡记录」权限（打卡分类）。"

function CategoryHeader({
  title,
  subtitle,
  count,
  hint,
  expanded,
  onToggle,
}: {
  title: string
  subtitle?: string
  count?: number
  hint?: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
        expanded
          ? "border-primary/35 bg-primary/5 shadow-sm ring-1 ring-primary/10"
          : "border-border bg-muted/50 hover:border-border hover:bg-muted/70",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          expanded
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground",
        )}
        aria-hidden
      >
        <ChevronDown className={cn("size-4 transition-transform duration-200", !expanded && "-rotate-90")} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn("text-sm font-semibold", expanded ? "text-foreground" : "text-foreground/90")}>
            {title}
          </span>
          {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
          {count !== undefined ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                expanded ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground",
              )}
            >
              {count} 项
            </span>
          ) : null}
        </div>
        {expanded && hint ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        ) : !expanded ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">点击展开查看配置项</p>
        ) : null}
      </div>

      <span
        className={cn(
          "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide",
          expanded
            ? "border-primary/30 bg-primary/15 text-primary"
            : "border-border bg-background text-muted-foreground",
        )}
      >
        {expanded ? "已展开" : "已收起"}
      </span>
    </button>
  )
}

export function RolePermissionMatrix({
  roles,
  permissionRows,
  dataScopeLabels,
  onTogglePermission,
  onUpdateDataScope,
}: RolePermissionMatrixProps) {
  const [search, setSearch] = useState("")
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({})

  const grouped = useMemo(() => groupPermissionsByModule(permissionRows), [permissionRows])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return grouped
    return grouped
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            g.module.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.permissions.length > 0)
  }, [grouped, search])

  const isSearching = search.trim().length > 0

  function isModuleExpanded(module: string) {
    if (isSearching) return true
    return expandedModules[module] === true
  }

  function toggleModule(module: string) {
    setExpandedModules((prev) => ({ ...prev, [module]: !isModuleExpanded(module) }))
  }

  const showDataScopeSection =
    !isSearching ||
    "数据范围".includes(search.trim().toLowerCase()) ||
    "data_scope".includes(search.trim().toLowerCase()) ||
    Object.values(dataScopeLabels).some((l) => l.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheck className="size-4" />
            角色权限矩阵
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            系统角色权限以数据库为准，设置页修改会持久保存，不再被进程重启覆盖。发版若需对齐代码种子，请使用下方「从代码种子恢复」。
          </p>
        </div>
        <div className="relative min-w-[12rem] sm:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索权限名称或 code…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 min-w-max whitespace-nowrap bg-card px-4 py-3 font-medium">权限 / 配置项</th>
              {roles.map((role) => (
                <th key={role.id} className="min-w-max whitespace-nowrap px-3 py-3 text-center font-medium">
                  <span className="font-medium text-foreground">{role.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showDataScopeSection && (
              <>
                <tr>
                  <td colSpan={roles.length + 1} className="px-3 py-2">
                    <CategoryHeader
                      title="数据范围"
                      subtitle="按角色"
                      count={1}
                      hint={DATA_SCOPE_HINT}
                      expanded={isModuleExpanded(DATA_SCOPE_KEY)}
                      onToggle={() => toggleModule(DATA_SCOPE_KEY)}
                    />
                  </td>
                </tr>
                {isModuleExpanded(DATA_SCOPE_KEY) && (
                  <tr className="border-b border-border bg-primary/[0.02]">
                    <td className="sticky left-0 z-10 border-l-2 border-l-primary/30 bg-card px-4 py-2.5 pl-5">
                      <p className="text-xs">可见数据范围</p>
                      <p className="font-mono text-[10px] text-muted-foreground">data_scope</p>
                    </td>
                    {roles.map((role) => (
                      <td key={role.id} className="border-l border-border/40 px-2 py-2.5 text-center">
                        <select
                          value={role.dataScope}
                          onChange={(e) => onUpdateDataScope(role.id, e.target.value as DataScope)}
                          className="mx-auto max-w-full rounded-md border border-border bg-background px-1.5 py-1 text-[10px]"
                          title={dataScopeLabels[role.dataScope]}
                        >
                          {(["own", "department", "all"] as DataScope[]).map((scope) => (
                            <option key={scope} value={scope}>
                              {dataScopeLabels[scope]}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                  </tr>
                )}
              </>
            )}

            {filteredGroups.length === 0 && !showDataScopeSection ? (
              <tr>
                <td colSpan={roles.length + 1} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  没有匹配的权限项
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const expanded = isModuleExpanded(group.module)
                return (
                  <Fragment key={group.module}>
                    <tr>
                      <td colSpan={roles.length + 1} className="px-3 py-2">
                        <CategoryHeader
                          title={group.module}
                          count={group.permissions.length}
                          hint={group.hint}
                          expanded={expanded}
                          onToggle={() => toggleModule(group.module)}
                        />
                      </td>
                    </tr>
                    {expanded &&
                      group.permissions.map((permission) => (
                        <tr key={permission.code} className="border-b border-border bg-primary/[0.02] last:border-0">
                          <td className="sticky left-0 z-10 border-l-2 border-l-primary/20 bg-card px-4 py-2.5 pl-5">
                            <p className="text-xs">{permission.name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">{permission.code}</p>
                          </td>
                          {roles.map((role) => {
                            const allowed = role.permissions.includes(permission.code)
                            return (
                              <td key={role.id} className="border-l border-border/40 px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => onTogglePermission(role.id, permission.code, !allowed)}
                                  className="mx-auto flex size-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent/50"
                                  title={allowed ? "点击移除" : "点击授予"}
                                >
                                  {allowed ? (
                                    <Check className="size-4 text-primary" />
                                  ) : (
                                    <X className="size-4 text-muted-foreground/40" />
                                  )}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
