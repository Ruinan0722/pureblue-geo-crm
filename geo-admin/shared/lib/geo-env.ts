/**
 * Unified environment: development | staging | production.
 * Prefer GEO_ENV / NEXT_PUBLIC_GEO_ENV; fall back from NODE_ENV for local.
 * Do not use NODE_ENV alone to distinguish staging vs production (both build as production).
 */

export type GeoEnv = "development" | "staging" | "production"

function normalizeGeoEnv(raw: string | undefined | null): GeoEnv | null {
  const v = (raw || "").trim().toLowerCase()
  if (v === "development" || v === "dev" || v === "local") return "development"
  if (v === "staging" || v === "stage" || v === "test") return "staging"
  if (v === "production" || v === "prod") return "production"
  return null
}

/**
 * Resolve current GEO environment.
 * Order: GEO_ENV → NEXT_PUBLIC_GEO_ENV → NODE_ENV mapping.
 */
export function getGeoEnv(): GeoEnv {
  const fromGeo =
    normalizeGeoEnv(process.env.GEO_ENV) || normalizeGeoEnv(process.env.NEXT_PUBLIC_GEO_ENV)
  if (fromGeo) return fromGeo

  if (process.env.NODE_ENV === "development") return "development"
  // Docker / next start without GEO_ENV → treat as production (safe default)
  return "production"
}

export function isGeoProduction(): boolean {
  return getGeoEnv() === "production"
}

export function isGeoStaging(): boolean {
  return getGeoEnv() === "staging"
}

export function isGeoDevelopment(): boolean {
  return getGeoEnv() === "development"
}

/** 环境中文名（开发/测试/生产），用于版本等 UI 提示的环境区分。 */
export const GEO_ENV_LABELS: Record<GeoEnv, string> = {
  development: "开发环境",
  staging: "测试环境",
  production: "生产环境",
}

export function geoEnvLabel(env: GeoEnv = getGeoEnv()): string {
  return GEO_ENV_LABELS[env]
}

/** Production admin hostname hard-block (even if misconfigured GEO_ENV). */
export function isProdAdminHostname(): boolean {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").toLowerCase()
  return appUrl.includes("crm.example.invalid") && !appUrl.includes("staging")
}
