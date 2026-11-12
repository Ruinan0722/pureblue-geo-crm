"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Bell,
  BookOpen,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  FileEdit,
  FileSignature,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Waves,
  Menu,
  Settings,
  Target,
  UserPlus,
  Users,
  FolderKanban,
  Handshake,
  X,
} from "lucide-react"
import { FlowIcon } from "@/shared/ui/flow-icon"
import { cn } from "@/shared/lib/utils"
import { useAuth, type SectionKey } from "@/modules/auth/context/auth-provider"
import { DevIdentitySwitcher } from "@/modules/auth/components/dev-identity-switcher"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { PageLoading } from "@/modules/shell/components/page-loading"
import { readRaw, writeRaw } from "@/shared/lib/storage"
import { geoEnvLabel, getGeoEnv, type GeoEnv } from "@/shared/lib/geo-env"
import { canDo } from "@/modules/auth/lib/permissions"
import { KnowledgeQaAssistant } from "@/modules/knowledge/components/knowledge-qa-assistant"
import { knowledgeReviewDepartments, loadKnowledgeArticles, KNOWLEDGE_UPDATED_EVENT, KNOWLEDGE_REVIEW_UPDATED_EVENT } from "@/modules/knowledge/lib/knowledge-data"

type ShellSectionKey = SectionKey | "knowledge" | "ecosystems"

// 战略生态是独立导航模块，业务操作继续复用现有合作伙伴权限。
function accessSection(key: Exclude<ShellSectionKey, "knowledge">): SectionKey {
  return key === "ecosystems" ? "channels" : key
}

const NAV: { key: ShellSectionKey; href: string; label: string; desc: string; icon: typeof FileText }[] = [
  { key: "notifications", href: "/notifications", label: "消息通知", desc: "谁 @ 了你", icon: Bell },
  { key: "home", href: "/home", label: "首页工作台", desc: "待办与经营概览", icon: LayoutDashboard },
  { key: "leads", href: "/leads", label: "线索管理", desc: "承接与跟进线索", icon: UserPlus },
  { key: "public_pool", href: "/public-pool", label: "公海池", desc: "按区域认领客户", icon: Waves },
  { key: "customers", href: "/customers", label: "客户管理", desc: "客户与联系人档案", icon: Users },
  { key: "ecosystems", href: "/ecosystems", label: "战略生态管理", desc: "生态客户、联系人与合作推进", icon: Handshake },
  { key: "channels", href: "/channels", label: "渠道管理", desc: "渠道伙伴与合作推进", icon: Handshake },
  { key: "requests", href: "/requests", label: "需求管理", desc: "需求列表与详情", icon: FileText },
  { key: "opportunities", href: "/opportunities", label: "商机管理", desc: "销售机会推进", icon: Target },
  { key: "contracts", href: "/contracts", label: "合同管理", desc: "签约与合同信息", icon: FileSignature },
  { key: "projects", href: "/projects", label: "项目管理", desc: "签约后交付与客户成功", icon: FolderKanban },
  { key: "knowledge", href: "/knowledge", label: "知识库管理", desc: "部门 QA 与统一口径", icon: BookOpen },
  { key: "dashboard", href: "/dashboard", label: "数据看板", desc: "经营数据统计", icon: Briefcase },
  { key: "intake", href: "/intake", label: "海外需求填报", desc: "海外 GEO 客户填报", icon: FileEdit },
  { key: "intake_cn", href: "/intake/cn", label: "国内需求填报", desc: "国内 GEO 客户填报", icon: FileEdit },
  { key: "checkin", href: "/checkin", label: "位置打卡", desc: "定位导航与拜访打卡", icon: MapPin },
  { key: "settings", href: "/settings", label: "系统配置", desc: "表单与权限设置", icon: Settings },
]

const SIDEBAR_COLLAPSED_KEY = "geo-admin:sidebar-collapsed"

/** 环境常驻标识圆点配色：开发蓝 / 测试琥珀 / 生产绿。 */
const ENV_DOT: Record<GeoEnv, string> = {
  development: "bg-sky-400",
  staging: "bg-amber-400",
  production: "bg-emerald-400",
}

function currentAppVersion(): string {
  return (process.env.NEXT_PUBLIC_APP_VERSION || "").trim() || "dev"
}

function navItemActive(pathname: string, href: string): boolean {
  if (href === "/intake") {
    return pathname === "/intake" || pathname.startsWith("/intake/need-link")
  }
  if (href === "/intake/cn") {
    return pathname === "/intake/cn" || pathname.startsWith("/intake/cn/")
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

function sectionOf(pathname: string): ShellSectionKey {
  if (pathname.startsWith("/notifications")) return "notifications"
  if (pathname.startsWith("/home")) return "home"
  if (pathname.startsWith("/leads")) return "leads"
  if (pathname.startsWith("/public-pool")) return "public_pool"
  if (pathname.startsWith("/customers")) return "customers"
  if (pathname.startsWith("/ecosystems")) return "ecosystems"
  if (pathname.startsWith("/channels")) return "channels"
  if (pathname.startsWith("/opportunities")) return "opportunities"
  if (pathname.startsWith("/contracts")) return "contracts"
  if (pathname.startsWith("/projects")) return "projects"
  if (pathname.startsWith("/knowledge")) return "knowledge"
  if (pathname.startsWith("/dashboard")) return "dashboard"
  if (pathname.startsWith("/requests")) return "requests"
  if (pathname.startsWith("/checkin")) return "checkin"
  if (pathname.startsWith("/settings")) return "settings"
  if (pathname.startsWith("/intake/cn")) return "intake_cn"
  return "intake"
}

function firstAllowedHref(canAccess: (s: SectionKey) => boolean): string {
  const hit = NAV.find((n) => n.key !== "notifications" && (n.key === "knowledge" || canAccess(accessSection(n.key))))
  return hit?.href ?? "/requests"
}

/** 未读红点：正圆形，数字居中 */
function UnreadDot({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  const label = count > 99 ? "99+" : String(count)
  return (
    <span
      aria-label={`${count} 条未读`}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white tabular-nums shadow-sm",
        count > 99 && "size-6 text-[9px]",
        className,
      )}
    >
      {label}
    </span>
  )
}

function SidebarNavLink({
  href,
  active,
  label,
  desc,
  icon: Icon,
  unreadCount,
  onNavigate,
  compact,
  collapsed = false,
}: {
  href: string
  active: boolean
  label: string
  desc: string
  icon: typeof FileText
  unreadCount?: number
  onNavigate?: () => void
  /** 站内通知等置顶入口：字号小于功能模块 */
  compact?: boolean
  /** 桌面端侧栏收起：仅显示图标，标题改为 tooltip */
  collapsed?: boolean
}) {
  const showBadge = (unreadCount ?? 0) > 0
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg transition-colors",
        compact ? "gap-2.5 py-2 text-xs" : "py-2.5 text-sm",
        collapsed ? "relative justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("shrink-0", compact ? "size-3.5" : "size-4")} />
      {!collapsed ? (
        <span className="min-w-0 flex-1 leading-tight">
          <span className={cn("block font-medium", compact && "text-xs")}>{label}</span>
          {desc ? (
            <span
              className={cn(
                "block",
                compact ? "text-[10px]" : "text-[11px]",
                active ? "text-sidebar-primary-foreground/75" : "text-sidebar-foreground/50",
              )}
            >
              {desc}
            </span>
          ) : null}
        </span>
      ) : null}
      {showBadge ? (
        <UnreadDot count={unreadCount!} className={collapsed ? "absolute -right-1 -top-1" : undefined} />
      ) : null}
    </Link>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { loading, user, role, kind, canAccess, logout, isCustomerView } = useAuth()
  const { notifications } = useCrm()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [knowledgePendingCount, setKnowledgePendingCount] = useState(0)
  /** 侧栏切换时在右侧内容区展示 loading（侧栏保持不动） */
  const [contentNavigating, setContentNavigating] = useState(false)
  const current = sectionOf(pathname)
  const isStaffUser = kind === "user" && Boolean(user)
  const allowed = current === "knowledge" ? isStaffUser : canAccess(accessSection(current))
  const unreadCount = notifications.filter((item) => !item.read).length

  useEffect(() => {
    setContentNavigating(false)
  }, [pathname])

  useEffect(() => {
    setCollapsed(readRaw("local", SIDEBAR_COLLAPSED_KEY) === "1")
  }, [])

  useEffect(() => {
    const update = () => {
      const departments = knowledgeReviewDepartments(role || "", user?.name, user?.departmentNames)
      setKnowledgePendingCount(loadKnowledgeArticles().filter((article) => article.status === "待审核" && departments.includes(article.department)).length)
    }
    update()
    window.addEventListener(KNOWLEDGE_UPDATED_EVENT, update)
    window.addEventListener(KNOWLEDGE_REVIEW_UPDATED_EVENT, update)
    window.addEventListener("storage", update)
    return () => {
      window.removeEventListener(KNOWLEDGE_UPDATED_EVENT, update)
      window.removeEventListener(KNOWLEDGE_REVIEW_UPDATED_EVENT, update)
      window.removeEventListener("storage", update)
    }
  }, [role, user?.name, user?.departmentNames])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      writeRaw("local", SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
      return next
    })
  }

  useEffect(() => {
    if (loading) return
    if (kind !== "anonymous") return
    if (pathname === "/login" || pathname === "/intake/need-link") return
    router.replace("/login")
  }, [loading, kind, pathname, router])

  if (pathname === "/login" || pathname === "/intake/need-link") {
    return <>{children}</>
  }

  if (loading || kind === "anonymous") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>
    )
  }

  if (isCustomerView) {
    const domestic = pathname.startsWith("/intake/cn")
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <FlowIcon className="size-6" />
            <span className="text-sm font-semibold">{domestic ? "国内 GEO 需求填报" : "海外 GEO 需求填报"}</span>
          </div>
        </header>
        {children}
      </div>
    )
  }

  const notificationItem = NAV.find((n) => n.key === "notifications")
  // 所有内部员工固定显示消息通知；有效权限解析器也会强制补齐该基础权限。
  const showNotifications = Boolean(notificationItem && isStaffUser)
  const moduleNav = NAV.filter(
    (n) => n.key !== "notifications" && (n.key === "knowledge" ? isStaffUser : canAccess(accessSection(n.key))),
  )

  function handleNavClick(href: string) {
    setMobileOpen(false)
    if (href === pathname || pathname.startsWith(`${href}/`)) return
    setContentNavigating(true)
  }

  const sidebar = (collapsedOnDesktop: boolean) => (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-sidebar-border",
          collapsedOnDesktop ? "justify-center px-0" : "gap-2.5 px-5",
        )}
      >
        <FlowIcon className="size-8" />
        {!collapsedOnDesktop ? (
          <div className="leading-tight">
            <p className="text-xl font-semibold tracking-tight">Flow</p>
            <p className="text-[11px] text-sidebar-foreground/60">清蓝 · 客户经营平台</p>
          </div>
        ) : null}
      </div>

      {/* 站内通知：固定在侧栏导航顶部，不随模块列表滚动 */}
      {showNotifications && notificationItem ? (
        <div className="shrink-0 border-b border-sidebar-border px-3 py-2">
          <SidebarNavLink
            href={notificationItem.href}
            active={current === "notifications"}
            label={notificationItem.label}
            desc={notificationItem.desc}
            icon={notificationItem.icon}
            unreadCount={unreadCount}
            compact
            collapsed={collapsedOnDesktop}
            onNavigate={() => handleNavClick(notificationItem.href)}
          />
        </div>
      ) : null}

      <nav className={cn("min-h-0 flex-1 space-y-1.5 overflow-y-auto", collapsedOnDesktop ? "p-2" : "p-3")}>
        {moduleNav.map((item) => {
          const active = navItemActive(pathname, item.href)
          return (
            <div key={item.href}>
              <SidebarNavLink
                href={item.href}
                active={active}
                label={item.label}
                desc={item.desc}
                icon={item.icon}
                unreadCount={item.key === "knowledge" ? knowledgePendingCount : undefined}
                collapsed={collapsedOnDesktop}
                onNavigate={() => handleNavClick(item.href)}
              />
              {item.key === "contracts" && active && !collapsedOnDesktop ? (
                <div className="ml-7 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                  <Link href="/contracts" onClick={() => handleNavClick("/contracts")} className={cn("block rounded-md px-2 py-1.5 text-xs", !pathname.startsWith("/contracts/channels") && !pathname.startsWith("/contracts/ecosystems") && !pathname.startsWith("/contracts/payments") ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60")}>销售合同</Link>
                  {canAccess("channels") && <Link href="/contracts/channels" onClick={() => handleNavClick("/contracts/channels")} className={cn("block rounded-md px-2 py-1.5 text-xs", pathname.startsWith("/contracts/channels") ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60")}>渠道合同</Link>}
                  {canAccess("channels") && <Link href="/contracts/ecosystems" onClick={() => handleNavClick("/contracts/ecosystems")} className={cn("block rounded-md px-2 py-1.5 text-xs", pathname.startsWith("/contracts/ecosystems") ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60")}>战略生态合同</Link>}
                  {canDo(user?.permissions ?? [], "payments:view", "section:contracts") && <Link href="/contracts/payments" onClick={() => handleNavClick("/contracts/payments")} className={cn("block rounded-md px-2 py-1.5 text-xs", pathname.startsWith("/contracts/payments") ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60")}>回款管理</Link>}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>

      {user && (
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div className={cn("flex items-center rounded-lg px-2 py-2", collapsedOnDesktop ? "justify-center" : "gap-3")}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-medium">
              {user.name.slice(0, 1)}
            </div>
            {!collapsedOnDesktop ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="text-[11px] text-sidebar-foreground/50">{user.roleLabel}</p>
              </div>
            ) : null}
          </div>
          {!collapsedOnDesktop ? (
            <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] text-sidebar-foreground/55">
              <span className={cn("size-1.5 shrink-0 rounded-full", ENV_DOT[getGeoEnv()])} />
              <span className="truncate">
                {geoEnvLabel()} · {currentAppVersion()}
              </span>
            </div>
          ) : null}
          <button
            onClick={() => logout()}
            title={collapsedOnDesktop ? "退出登录" : undefined}
            aria-label={collapsedOnDesktop ? "退出登录" : undefined}
            className={cn(
              "mt-1 flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/60",
              collapsedOnDesktop ? "justify-center px-0" : "gap-2 px-3",
            )}
          >
            <LogOut className="size-4" />
            {!collapsedOnDesktop ? "退出登录" : null}
          </button>
          {!collapsedOnDesktop ? <DevIdentitySwitcher /> : null}
        </div>
      )}
    </div>
  )

  return (
    <div className="min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block print:hidden",
          "transition-[width] duration-200 ease-in-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {sidebar(collapsed)}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "展开导航栏" : "收起导航栏"}
          title={collapsed ? "展开导航栏" : "收起导航栏"}
          className={cn(
            "absolute top-[18px] -right-3.5 z-40 flex size-7 items-center justify-center rounded-full border border-border bg-background text-black shadow-sm dark:text-foreground",
          )}
        >
          {collapsed ? <ChevronRight className="size-5" /> : <ChevronLeft className="size-5" />}
        </button>
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden print:hidden">
        <div className="flex items-center gap-2">
          <FlowIcon className="size-7" />
          <span className="text-lg font-semibold tracking-tight">Flow</span>
          {unreadCount > 0 && (
            <Link href="/notifications" className="ml-0.5">
              <UnreadDot count={unreadCount} />
            </Link>
          )}
        </div>
        <button onClick={() => setMobileOpen(true)} aria-label="打开菜单">
          <Menu className="size-5" />
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-sidebar text-sidebar-foreground">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 text-sidebar-foreground/70"
              aria-label="关闭菜单"
            >
              <X className="size-5" />
            </button>
            {sidebar(false)}
          </div>
        </div>
      )}

      <div
        className={cn(
          "min-w-0 transition-[padding] duration-200 ease-in-out print:pl-0",
          collapsed ? "lg:pl-16" : "lg:pl-64",
        )}
      >
        {isStaffUser && !allowed ? (
          <AccessDenied section={current} fallbackHref={firstAllowedHref(canAccess)} />
        ) : contentNavigating ? (
          <PageLoading />
        ) : (
          children
        )}
      </div>
      {isStaffUser ? <KnowledgeQaAssistant /> : null}
    </div>
  )
}

function AccessDenied({ section, fallbackHref }: { section: ShellSectionKey; fallbackHref: string }) {
  const label = NAV.find((n) => n.key === section)?.label ?? "该页面"
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold">无访问权限</h2>
      <p className="max-w-sm text-sm text-muted-foreground">当前账号无法访问「{label}」。</p>
      <Link href={fallbackHref} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        返回可用页面
      </Link>
    </div>
  )
}
