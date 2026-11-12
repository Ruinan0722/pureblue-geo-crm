/**
 * Environment feature flags.
 * Explicit GEO_FEATURE_<NAME> / NEXT_PUBLIC_GEO_FEATURE_<NAME> override defaults by GEO_ENV.
 * Legacy: ALLOW_DEV_IDENTITY=true → enables DEV_IDENTITY.
 */

import {
  getGeoEnv,
  isProdAdminHostname,
  type GeoEnv,
} from "./geo-env"

export type GeoFeature =
  | "DEV_IDENTITY"
  | "DEBUG_BANNERS"
  | "DEV_SALES_NAMES"
  | "RELEASE_NOTES"
  | "VERSION_SOFT_REFRESH"
  | "FORM_DRAFT"
  | "RELEASE_NOTES_FORCE_PREVIEW"
  | "RELEASE_NOTES_DEV_HELPERS"

type FeatureDefaults = Record<GeoFeature, boolean>

const DEFAULTS: Record<GeoEnv, FeatureDefaults> = {
  development: {
    DEV_IDENTITY: true,
    DEBUG_BANNERS: true,
    // 销售/负责人下拉走飞书组织快照；测身份登录仍由 DEV_IDENTITY 控制
    DEV_SALES_NAMES: false,
    RELEASE_NOTES: true,
    VERSION_SOFT_REFRESH: true,
    FORM_DRAFT: true,
    RELEASE_NOTES_FORCE_PREVIEW: true,
    RELEASE_NOTES_DEV_HELPERS: true,
  },
  staging: {
    DEV_IDENTITY: false,
    DEBUG_BANNERS: false,
    DEV_SALES_NAMES: false,
    RELEASE_NOTES: true,
    VERSION_SOFT_REFRESH: true,
    FORM_DRAFT: true,
    RELEASE_NOTES_FORCE_PREVIEW: false,
    RELEASE_NOTES_DEV_HELPERS: false,
  },
  production: {
    DEV_IDENTITY: false,
    DEBUG_BANNERS: false,
    DEV_SALES_NAMES: false,
    RELEASE_NOTES: true,
    VERSION_SOFT_REFRESH: true,
    FORM_DRAFT: true,
    RELEASE_NOTES_FORCE_PREVIEW: false,
    RELEASE_NOTES_DEV_HELPERS: false,
  },
}

function parseBool(raw: string | undefined | null): boolean | null {
  if (raw == null) return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (["1", "true", "yes", "on"].includes(v)) return true
  if (["0", "false", "no", "off"].includes(v)) return false
  return null
}

function readExplicitOverride(feature: GeoFeature): boolean | null {
  const key = `GEO_FEATURE_${feature}`
  const pubKey = `NEXT_PUBLIC_GEO_FEATURE_${feature}`
  const fromEnv = parseBool(process.env[key])
  if (fromEnv != null) return fromEnv
  const fromPublic = parseBool(process.env[pubKey])
  if (fromPublic != null) return fromPublic

  // Legacy override for identity switching
  if (feature === "DEV_IDENTITY") {
    const legacy = parseBool(process.env.ALLOW_DEV_IDENTITY)
    if (legacy != null) return legacy
  }
  return null
}

/**
 * Whether a product/debug feature is enabled for the current environment.
 * DEV_IDENTITY is always available in staging for role testing, while
 * production (including the production hostname) always forces it off.
 */
export function isFeatureEnabled(feature: GeoFeature): boolean {
  if (feature === "DEV_IDENTITY" && isProdAdminHostname()) {
    return false
  }

  const geoEnv = getGeoEnv()
  if (feature === "DEV_IDENTITY") {
    // 测试环境固定开放身份切换，避免环境变量遗漏导致无法进行角色验收。
    if (geoEnv === "staging") return true
    // 生产环境固定关闭，且不允许环境变量覆盖。
    if (geoEnv === "production") return false
  }

  const override = readExplicitOverride(feature)
  if (override != null) {
    return override
  }

  return DEFAULTS[geoEnv][feature]
}

export function featureDefaultsFor(env: GeoEnv): FeatureDefaults {
  return { ...DEFAULTS[env] }
}
