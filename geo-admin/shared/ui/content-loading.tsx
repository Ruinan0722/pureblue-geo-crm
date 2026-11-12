"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/shared/lib/utils"

/** 内容区加载遮罩：叠在已有内容上，避免切换筛选时白屏/空态误解 */
export function ContentLoadingOverlay({
  label = "加载中…",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[1px]",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  )
}

/** 整块占位加载（无旧内容可叠时用） */
export function ContentLoadingBlock({
  label = "加载中…",
  className,
  minHeightClassName = "min-h-48",
}: {
  label?: string
  className?: string
  minHeightClassName?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        minHeightClassName,
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  )
}
