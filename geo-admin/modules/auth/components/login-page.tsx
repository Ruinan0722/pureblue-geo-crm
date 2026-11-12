"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Building2, FlaskConical, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import type { StaffRole } from "@/modules/auth"
import { DEV_IDENTITY_GROUPS, DEV_IDENTITY_LOGINS } from "@/modules/auth/lib/dev-identities"
import { isDevIdentityEnabled } from "@/modules/auth/lib/dev-identity-enabled"
import { isGeoDevelopment } from "@/shared/lib/geo-env"
import { FlowIcon } from "@/shared/ui/flow-icon"
import { cn } from "@/shared/lib/utils"

function formatLoginError(error: string | null): string | null {
  if (!error) return null
  try {
    return decodeURIComponent(error)
  } catch {
    return error
  }
}

function firstSectionHref(permissions: string[]): string {
  const order = [
    "home", "leads", "public_pool", "customers", "requests", "opportunities", "contracts",
    "projects", "dashboard", "intake", "checkin", "settings",
  ] as const
  const first = order.find((section) => permissions.includes(`section:${section}`))
  return first ? `/${first}` : "/go"
}

export function LoginPage({
  initialFeishuConfigured = false,
  error = null,
}: {
  initialFeishuConfigured?: boolean
  error?: string | null
}) {
  const loginError = formatLoginError(error)
  const [devLoadingKey, setDevLoadingKey] = useState<string | null>(null)
  const [feishuConfigured, setFeishuConfigured] = useState(initialFeishuConfigured)
  const identityEnabled = isDevIdentityEnabled()

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then((res) => res.json())
      .then((data: { feishuConfigured?: boolean }) => setFeishuConfigured(Boolean(data.feishuConfigured)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (identityEnabled) return
    if (feishuConfigured && !loginError && !isGeoDevelopment()) window.location.href = "/api/auth/feishu"
  }, [feishuConfigured, loginError, identityEnabled])

  async function devLogin(role: StaffRole, name: string) {
    const key = `${role}:${name}`
    setDevLoadingKey(key)
    try {
      const res = await fetch("/api/auth/me", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role }),
      })
      if (!res.ok) {
        toast.error("测试身份登录失败")
        return
      }
      const data = (await res.json()) as { user?: { permissions?: string[] } }
      window.location.href = firstSectionHref(data.user?.permissions ?? [])
    } catch {
      toast.error("测试身份登录失败")
    } finally {
      setDevLoadingKey(null)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-muted/25 px-4 py-8 sm:px-6 lg:flex lg:items-center lg:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_30%),radial-gradient(circle_at_85%_75%,color-mix(in_oklab,#f59e0b_10%,transparent),transparent_28%)]" />

      <div className={cn(
        "relative mx-auto grid w-full overflow-hidden rounded-3xl border border-border/70 bg-card shadow-xl shadow-foreground/5",
        identityEnabled ? "max-w-6xl lg:grid-cols-[0.8fr_1.2fr]" : "max-w-md",
      )}>
        <section className="flex flex-col justify-between p-7 sm:p-9">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <FlowIcon className="size-12 shadow-sm" />
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-[#0530AD] dark:text-foreground">Flow</h1>
                <p className="text-xs text-muted-foreground">清蓝 · 客户经营平台</p>
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-tight">欢迎回来</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              使用企业飞书账号登录，系统会根据组织身份加载对应的数据范围和操作权限。
            </p>

            {loginError ? (
              <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {loginError}
              </div>
            ) : null}

            {!feishuConfigured && !loginError ? (
              <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                飞书应用尚未配置，请使用测试身份进入系统。
              </div>
            ) : null}

            {feishuConfigured ? (
              <a
                href="/api/auth/feishu"
                className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Building2 className="size-4" />
                飞书授权登录
                <ArrowRight className="size-4" />
              </a>
            ) : null}
          </div>

          <p className="mt-10 text-xs leading-5 text-muted-foreground">
            {identityEnabled
              ? "当前为开发 / 测试环境。进入系统后仍可从侧栏快速切换身份。"
              : "登录即代表你同意按照公司内部数据安全规范使用本系统。"}
          </p>
        </section>

        {identityEnabled ? (
          <section className="border-t border-border/70 bg-muted/35 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FlaskConical className="size-4 text-amber-600" />
                  快速测试身份
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  选择岗位后直接进入首个可访问模块；紫色盾牌表示包含个人权限覆盖。
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                非生产环境
              </span>
            </div>

            <div className="max-h-[calc(100vh-10rem)] space-y-5 overflow-y-auto pr-1 lg:max-h-[36rem]">
              {DEV_IDENTITY_GROUPS.map((group) => (
                <div key={group}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {group}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DEV_IDENTITY_LOGINS.filter((item) => item.group === group).map((item) => {
                      const key = `${item.role}:${item.name}`
                      const loading = devLoadingKey === key
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={devLoadingKey !== null}
                          onClick={() => devLogin(item.role, item.name)}
                          className="group flex min-h-20 items-start gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md disabled:translate-y-0 disabled:opacity-60"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                            {item.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              {loading ? "正在进入…" : item.label}
                              {item.permissionOverrides?.length ? (
                                <ShieldCheck className="size-3.5 shrink-0 text-violet-600" />
                              ) : null}
                            </span>
                            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{item.tip}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

export default LoginPage
