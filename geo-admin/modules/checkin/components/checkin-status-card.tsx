"use client"

import { Clock3, MapPin, RefreshCw } from "lucide-react"
import type { AddressInfo, GeoPosition } from "../lib/types"
import type { GeolocationFailureReason } from "../utils/geolocation"
import { useBeijingTime } from "../hooks/useBeijingTime"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { LocationPermissionGuide } from "./location-permission-guide"
import { GeocodingErrorGuide } from "./geocoding-error-guide"
import { LocationAccuracyWarning } from "./location-accuracy-warning"

interface CheckinStatusCardProps {
  position: GeoPosition | null
  address: AddressInfo | null
  addressStatus: "idle" | "loading" | "ready" | "error"
  addressError: string
  addressDegraded: boolean
  locationErrorReason: GeolocationFailureReason | null
  locationQualityWarning: string
  locationPermission: PermissionState | "unknown"
  isRefreshingLocation: boolean
  isResolvingAddress: boolean
  onRefreshLocation: () => void
  onRetryGeocode: () => void
  activeVisitId: string | null
}

export function CheckinStatusCard({
  position,
  address,
  addressStatus,
  addressError,
  addressDegraded,
  locationErrorReason,
  locationQualityWarning,
  locationPermission,
  isRefreshingLocation,
  isResolvingAddress,
  onRefreshLocation,
  onRetryGeocode,
  activeVisitId,
}: CheckinStatusCardProps) {
  const beijingTime = useBeijingTime()
  const showLocationGuide = !position && addressStatus === "error" && locationErrorReason
  const showGeocodeGuide = Boolean(position && addressStatus === "error" && addressDegraded)

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-muted/30 shadow-sm">
      <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="size-4 shrink-0" />
            <span>北京时间</span>
          </div>
          <p className="font-mono text-lg font-semibold tabular-nums">{beijingTime}</p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">当前位置</p>
            {position ? (
              <>
                {addressStatus === "loading" && (
                  <p className="mt-1 text-sm text-muted-foreground">正在解析中文地址…</p>
                )}
                {addressStatus === "ready" && address && (
                  <>
                    <p className="mt-1 text-sm font-medium leading-relaxed">{address.address}</p>
                    {(address.province || address.city || address.district) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[address.province, address.city, address.district].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </>
                )}
                {addressStatus === "error" && addressDegraded && address && (
                  <p className="mt-1 text-sm font-medium leading-relaxed text-muted-foreground">{address.address}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}
                    {position.accuracy != null && ` · ±${Math.round(position.accuracy)}m`}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={onRefreshLocation}
                    disabled={isRefreshingLocation || isResolvingAddress}
                  >
                    <RefreshCw className={cn("size-3.5", isRefreshingLocation && "animate-spin")} />
                    {isRefreshingLocation ? "定位中" : "重新获取定位"}
                  </Button>
                </div>
                {showGeocodeGuide && (
                  <GeocodingErrorGuide
                    className="mt-2"
                    isRetrying={isResolvingAddress}
                    onRetry={onRetryGeocode}
                  />
                )}
                {locationQualityWarning && (
                  <LocationAccuracyWarning className="mt-2" message={locationQualityWarning} />
                )}
              </>
            ) : addressStatus === "loading" || isRefreshingLocation ? (
              <p className="mt-1 text-sm text-muted-foreground">正在获取定位…</p>
            ) : showLocationGuide ? (
              <LocationPermissionGuide
                className="mt-2"
                reason={locationErrorReason}
                permission={locationPermission}
                message={addressError}
                isRefreshing={isRefreshingLocation}
                onRetry={onRefreshLocation}
              />
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{addressError || "正在获取位置…"}</p>
            )}
          </div>
        </div>

        {activeVisitId && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
            拜访进行中，结束后请点「结束打卡」
          </div>
        )}
      </div>
    </section>
  )
}
