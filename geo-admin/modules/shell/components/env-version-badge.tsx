"use client"

import { cn } from "@/shared/lib/utils"
import { geoEnvLabel, getGeoEnv, type GeoEnv } from "@/shared/lib/geo-env"

/** 环境徽标配色：开发蓝 / 测试琥珀 / 生产绿，避免误把测试当生产。 */
const ENV_TONE: Record<GeoEnv, string> = {
  development: "bg-sky-100 text-sky-700",
  staging: "bg-amber-100 text-amber-700",
  production: "bg-emerald-100 text-emerald-700",
}

/**
 * 环境 + 版本提示：按当前部署环境展示不同徽标内容与配色，
 * 版本号始终展示（如 v1.1.0-staging.40 / v1.1.0）。
 */
export function EnvVersionBadge({
  version,
  env = getGeoEnv(),
  showEnv = true,
  className,
}: {
  version: string
  env?: GeoEnv
  showEnv?: boolean
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {showEnv ? (
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
            ENV_TONE[env],
          )}
        >
          {geoEnvLabel(env)}
        </span>
      ) : null}
      <span className="inline-flex items-center rounded-md bg-background px-2 py-0.5 font-medium text-foreground ring-1 ring-foreground/10">
        {version}
      </span>
    </span>
  )
}
