"use client"

import { AlertTriangle } from "lucide-react"
import { cn } from "@/shared/lib/utils"

interface LocationAccuracyWarningProps {
  message: string
  className?: string
}

export function LocationAccuracyWarning({ message, className }: LocationAccuracyWarningProps) {
  return (
    <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5", className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-1 text-xs leading-relaxed text-foreground">
          <p>{message}</p>
          <p className="text-muted-foreground">
            电脑 + VPN 通常只能定位到节点城市；手机关闭 VPN 后重新获取，精度一般可达 ±50m。
          </p>
        </div>
      </div>
    </div>
  )
}
