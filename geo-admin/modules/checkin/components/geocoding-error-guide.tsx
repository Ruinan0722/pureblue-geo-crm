"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

interface GeocodingErrorGuideProps {
  isRetrying: boolean
  onRetry: () => void
  className?: string
}

export function GeocodingErrorGuide({ isRetrying, onRetry, className }: GeocodingErrorGuideProps) {
  return (
    <div className={cn("mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground", className)}>
      <span>中文地址解析失败，已显示坐标</span>
      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={onRetry} disabled={isRetrying}>
        <RefreshCw className={cn("size-3.5", isRetrying && "animate-spin")} />
        {isRetrying ? "解析中" : "重试"}
      </Button>
    </div>
  )
}
