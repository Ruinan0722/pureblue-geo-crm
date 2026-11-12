"use client"

import { cn } from "@/shared/lib/utils"

/** 路由切换时的内容区占位（layout / 侧栏保持可见） */
export function PageLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-background lg:min-h-dvh",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label="页面加载中"
    >
      <p className="text-sm text-muted-foreground">加载中…</p>
    </div>
  )
}
