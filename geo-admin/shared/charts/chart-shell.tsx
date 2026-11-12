"use client"

import type { ReactNode } from "react"
import { ResponsiveContainer } from "recharts"
import { cn } from "@/shared/lib/utils"
import type { ChartShellProps } from "./types"

export function ChartShell({
  title,
  description,
  className,
  height = 280,
  emptyText = "暂无数据",
  loading = false,
  empty,
  /** Recharts 图表用 ResponsiveContainer；自定义 DOM（如 CSS 漏斗）须关闭 */
  responsive = true,
  children,
}: ChartShellProps & {
  empty?: boolean
  responsive?: boolean
  children: ReactNode
}) {
  const h = typeof height === "number" ? `${height}px` : height

  return (
    <div className={cn("w-full rounded-xl border border-border bg-card p-4", className)}>
      {(title || description) && (
        <div className="mb-3 space-y-0.5">
          {title ? <h3 className="text-sm font-medium tracking-tight text-foreground">{title}</h3> : null}
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      )}
      <div className="w-full" style={{ height: h }}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{emptyText}</div>
        ) : responsive ? (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
