/**
 * Smoke: GEO_ENV + feature defaults.
 * Run: node --experimental-strip-types shared/lib/geo-features.smoke.mts
 */
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {}
  const keys = Object.keys(env)
  for (const k of keys) {
    prev[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]!
  }
  try {
    fn()
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

const dir = dirname(fileURLToPath(import.meta.url))
const { getGeoEnv } = await import(pathToFileURL(join(dir, "geo-env.ts")).href)
const { isFeatureEnabled } = await import(pathToFileURL(join(dir, "geo-features.ts")).href)

withEnv(
  {
    GEO_ENV: "development",
    NEXT_PUBLIC_GEO_ENV: "development",
    NODE_ENV: "development",
    NEXT_PUBLIC_APP_URL: "http://localhost:47821",
    ALLOW_DEV_IDENTITY: undefined,
    GEO_FEATURE_DEV_IDENTITY: undefined,
  },
  () => {
    assert.equal(getGeoEnv(), "development")
    assert.equal(isFeatureEnabled("DEV_IDENTITY"), true)
    assert.equal(isFeatureEnabled("DEBUG_BANNERS"), true)
    assert.equal(isFeatureEnabled("DEV_SALES_NAMES"), false)
  },
)

withEnv(
  {
    GEO_ENV: "staging",
    NEXT_PUBLIC_GEO_ENV: "staging",
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://crm.example.invalid",
    ALLOW_DEV_IDENTITY: undefined,
    GEO_FEATURE_DEV_IDENTITY: undefined,
  },
  () => {
    assert.equal(getGeoEnv(), "staging")
    assert.equal(isFeatureEnabled("DEV_IDENTITY"), false)
    assert.equal(isFeatureEnabled("DEBUG_BANNERS"), false)
    assert.equal(isFeatureEnabled("DEV_SALES_NAMES"), false)
    assert.equal(isFeatureEnabled("RELEASE_NOTES_FORCE_PREVIEW"), false)
  },
)

withEnv(
  {
    GEO_ENV: "production",
    NEXT_PUBLIC_GEO_ENV: "production",
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://crm.example.invalid",
    ALLOW_DEV_IDENTITY: "true",
    GEO_FEATURE_DEV_IDENTITY: "true",
  },
  () => {
    assert.equal(getGeoEnv(), "production")
    assert.equal(isFeatureEnabled("DEV_IDENTITY"), false)
    assert.equal(isFeatureEnabled("DEBUG_BANNERS"), false)
    assert.equal(isFeatureEnabled("RELEASE_NOTES"), true)
    assert.equal(isFeatureEnabled("FORM_DRAFT"), true)
    assert.equal(isFeatureEnabled("VERSION_SOFT_REFRESH"), true)
    assert.equal(isFeatureEnabled("RELEASE_NOTES_FORCE_PREVIEW"), false)
    assert.equal(isFeatureEnabled("RELEASE_NOTES_DEV_HELPERS"), false)
  },
)

withEnv(
  {
    GEO_ENV: "staging",
    NEXT_PUBLIC_GEO_ENV: "staging",
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://crm.example.invalid",
    GEO_FEATURE_DEV_SALES_NAMES: "true",
  },
  () => {
    assert.equal(isFeatureEnabled("DEV_SALES_NAMES"), true)
  },
)

console.log("geo-features.smoke: ok")
