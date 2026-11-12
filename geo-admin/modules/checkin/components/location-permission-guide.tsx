"use client"

import { AlertCircle, MapPin, RefreshCw } from "lucide-react"
import { Button } from "@/shared/ui/button"
import type { GeolocationFailureReason } from "../utils/geolocation"
import { getGeolocationGuidance } from "../utils/geolocation"
import { cn } from "@/shared/lib/utils"

interface LocationPermissionGuideProps {
  reason: GeolocationFailureReason
  permission: PermissionState | "unknown"
  message: string
  isRefreshing: boolean
  onRetry: () => void
  className?: string
}

export function LocationPermissionGuide({
  reason,
  permission,
  message,
  isRefreshing,
  onRetry,
  className,
}: LocationPermissionGuideProps) {
  const steps = getGeolocationGuidance(reason, permission)
  const canRetry = reason !== "insecure_context"

  return (
    <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3", className)}>
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-foreground">{message}</p>
          {steps.length > 0 && (
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          )}
          {canRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-8 gap-1.5"
              onClick={onRetry}
              disabled={isRefreshing}
            >
              {isRefreshing ? <RefreshCw className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
              {isRefreshing ? "正在获取…" : "重新获取定位"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
