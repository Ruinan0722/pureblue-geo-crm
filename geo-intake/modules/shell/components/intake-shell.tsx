"use client"

import { Sparkles } from "lucide-react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { LocaleSwitcher } from "@/modules/i18n/components/locale-switcher"
import { IpLocaleBootstrap } from "@/modules/i18n/components/ip-locale-bootstrap"

/** 客户填报端专用布局：无侧边栏、无内部导航 */
export function IntakeShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("shell")
  const pathname = usePathname()
  const domestic = pathname.startsWith("/intake/cn")

  if (pathname === "/channel-profile") {
    return <div className="min-h-screen">{children}</div>
  }

  return (
    <div className="min-h-screen">
      <IpLocaleBootstrap />
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold">{domestic ? "国内 GEO 需求填报" : t("title")}</span>
          </div>
          {!domestic ? <LocaleSwitcher /> : null}
        </div>
      </header>
      {children}
    </div>
  )
}
