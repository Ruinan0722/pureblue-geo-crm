#!/usr/bin/env node
/**
 * Emit public/version.json from NEXT_PUBLIC_APP_VERSION (or APP_VERSION).
 * Run before `next build` / `next dev` so the soft-refresh probe stays in sync
 * with the shell baked by NEXT_PUBLIC_APP_VERSION.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const version =
  (process.env.NEXT_PUBLIC_APP_VERSION || process.env.APP_VERSION || "").trim() ||
  "dev"

function normalizeEnv(raw) {
  const v = (raw || "").trim().toLowerCase()
  if (["development", "dev", "local"].includes(v)) return "development"
  if (["staging", "stage", "test"].includes(v)) return "staging"
  if (["production", "prod"].includes(v)) return "production"
  return null
}

/** 构建时环境（与 NEXT_PUBLIC_GEO_ENV 一致；本地/未配置默认 development）。 */
const env =
  normalizeEnv(process.env.NEXT_PUBLIC_GEO_ENV) ||
  normalizeEnv(process.env.GEO_ENV) ||
  "development"

const payload = {
  version,
  env,
  builtAt: new Date().toISOString(),
}
const out = join(root, "public", "version.json")
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`wrote ${out} (version=${version} env=${env})`)
