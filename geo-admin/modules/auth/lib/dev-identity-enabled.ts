/**
 * 开发与 Staging 环境允许「一键切换身份」。
 * 生产环境仅允许正常登录，始终关闭测试身份。
 * 统一走 GEO_ENV + GEO_FEATURE_DEV_IDENTITY（兼容 ALLOW_DEV_IDENTITY）。
 */
import { getGeoEnv } from "@/shared/lib/geo-env"
import { isFeatureEnabled } from "@/shared/lib/geo-features"

export function isDevIdentityEnabled(): boolean {
  // 生产一律禁止测试身份（即使 env 误开）；Staging 由统一 Feature Flag 固定开启。
  const env = getGeoEnv()
  if (env === "production") return false
  return isFeatureEnabled("DEV_IDENTITY")
}
