"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, FlaskConical, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { isDevIdentityEnabled } from "@/modules/auth/lib/dev-identity-enabled"
import { DEV_IDENTITY_GROUPS, DEV_IDENTITY_LOGINS } from "@/modules/auth/lib/dev-identities"
import type { StaffRole } from "@/modules/auth/lib/role-config"
import { cn } from "@/shared/lib/utils"

function firstSectionHref(permissions: string[]): string {
  const order = [
    "home", "leads", "public_pool", "customers", "requests", "opportunities", "contracts",
    "projects", "dashboard", "intake", "checkin", "settings",
  ] as const
  const first = order.find((section) => permissions.includes(`section:${section}`))
  return first ? `/${first}` : "/go"
}

/** 开发 / Staging：侧栏底部的紧凑型身份切换面板。 */
export function DevIdentitySwitcher() {
  const enabled = isDevIdentityEnabled()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOnOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open])

  async function switchTo(role: StaffRole, name: string) {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/auth/me", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role }),
      })
      if (!res.ok) {
        toast.error("切换身份失败")
        return
      }
      const data = (await res.json()) as { user?: { permissions?: string[]; roleLabel?: string } }
      toast.success(`已切换为 ${data.user?.roleLabel ?? name}`)
      window.location.assign(firstSectionHref(data.user?.permissions ?? []))
    } catch {
      toast.error("切换身份失败")
    } finally {
      setLoading(false)
    }
  }

  if (!enabled) return null

  return (
    <div ref={rootRef} className="relative mt-2">
      {open ? (
        <div className="absolute inset-x-0 bottom-full z-50 mb-2 max-h-[min(68vh,34rem)] overflow-y-auto rounded-xl border border-sidebar-border bg-popover p-2 text-popover-foreground shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div>
              <p className="text-xs font-semibold">切换测试身份</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">仅开发与测试环境可用</p>
            </div>
            <FlaskConical className="size-4 text-amber-600" />
          </div>

          {DEV_IDENTITY_GROUPS.map((group) => (
            <div key={group} className="mb-2 last:mb-0">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <div className="space-y-0.5">
                {DEV_IDENTITY_LOGINS.filter((item) => item.group === group).map((item) => {
                  const active = user?.role === item.role && user?.name === item.name
                  return (
                    <button
                      key={`${item.role}:${item.name}`}
                      type="button"
                      disabled={loading || active}
                      onClick={() => switchTo(item.role, item.name)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        active ? "bg-amber-500/15 text-amber-900 dark:text-amber-100" : "hover:bg-accent",
                        "disabled:cursor-default disabled:opacity-70",
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
                        active ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
                      )}>
                        {active ? <Check className="size-3.5" /> : item.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                          {item.label}
                          {item.permissionOverrides?.length ? <ShieldCheck className="size-3 text-violet-600" /> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.tip}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-left text-amber-900 transition-colors hover:bg-amber-500/15 dark:text-amber-100"
      >
        <FlaskConical className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold">测试身份</span>
          <span className="block truncate text-[10px] opacity-70">{user?.roleLabel ?? "选择角色"}</span>
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
    </div>
  )
}
