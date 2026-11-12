"use client"

import Link from "next/link"
import { useAuth } from "@/modules/auth"

export function SettingsGuard({ children }: { children: React.ReactNode }) {
  const { loading, canAccess } = useAuth()

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }

  if (!canAccess("settings")) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h2 className="text-lg font-semibold">无访问权限</h2>
        <p className="text-sm text-muted-foreground">当前账号缺少「访问系统设置」权限。</p>
        <Link href="/requests" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          返回需求管理
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
