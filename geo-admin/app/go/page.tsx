"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth, type SectionKey } from "@/modules/auth/context/auth-provider"

const LANDING_ORDER: { section: SectionKey; href: string }[] = [
  { section: "home", href: "/home" },
  { section: "leads", href: "/leads" },
  { section: "customers", href: "/customers" },
  { section: "requests", href: "/requests" },
  { section: "opportunities", href: "/opportunities" },
  { section: "contracts", href: "/contracts" },
  { section: "projects", href: "/projects" },
  { section: "dashboard", href: "/dashboard" },
  { section: "intake", href: "/intake" },
  { section: "checkin", href: "/checkin" },
  { section: "settings", href: "/settings" },
]

/** 登录后按权限落到首个可访问模块（SDR 无首页、售前仅商机等） */
export default function GoPage() {
  const router = useRouter()
  const { loading, kind, canAccess } = useAuth()

  useEffect(() => {
    if (loading) return
    if (kind !== "user") {
      router.replace("/login")
      return
    }
    const hit = LANDING_ORDER.find((item) => canAccess(item.section))
    router.replace(hit?.href ?? "/requests")
  }, [loading, kind, canAccess, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在进入平台…</div>
  )
}
