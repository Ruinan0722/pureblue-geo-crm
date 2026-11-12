/** localStorage gate: show release notes once per app version. */

import { isFeatureEnabled } from "@/shared/lib/geo-features"
import {
  clearKeysByPrefix,
  collectKeys,
  readJson,
  readRaw,
  removeRaw,
  writeJson,
} from "@/shared/lib/storage"

export const RELEASE_NOTES_SEEN_PREFIX = "geo-admin:release-notes:seen:"

/** 只保留最近 N 个版本的已读标记，避免 key 随发版无限累积。 */
const RELEASE_NOTES_KEEP = 30

type SeenEnvelope = { v: 1; seenAt: number }

function isSeenEnvelope(raw: unknown): raw is SeenEnvelope {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as SeenEnvelope).v === 1 &&
    typeof (raw as SeenEnvelope).seenAt === "number"
  )
}

export function releaseNotesSeenKey(version: string): string {
  return `${RELEASE_NOTES_SEEN_PREFIX}${version}`
}

export function hasSeenReleaseNotes(version: string): boolean {
  if (typeof window === "undefined") return true
  const key = (version || "").trim()
  if (!key) return true
  const stored = readRaw("local", releaseNotesSeenKey(key))
  if (stored == null) return false
  if (stored === "1") return true // 旧格式：纯 "1"
  return readJson<SeenEnvelope>("local", releaseNotesSeenKey(key), {
    sanitize: (raw) => (isSeenEnvelope(raw) ? raw : null),
  }) != null
}

export function markReleaseNotesSeen(version: string): void {
  if (typeof window === "undefined") return
  const key = (version || "").trim()
  if (!key) return
  writeJson("local", releaseNotesSeenKey(key), {
    v: 1,
    seenAt: Date.now(),
  } satisfies SeenEnvelope)
  pruneReleaseNotesSeen()
}

/** 只清理本版本认识的格式（旧 "1" 或 v1 envelope）；未知/未来格式不动，避免误删。 */
function pruneReleaseNotesSeen(): void {
  const entries: Array<{ key: string; seenAt: number }> = []
  for (const key of collectKeys("local", RELEASE_NOTES_SEEN_PREFIX)) {
    const stored = readRaw("local", key)
    if (stored == null) continue
    if (stored === "1") {
      // 旧格式没有时间戳，按 0 处理，超量时优先淘汰
      entries.push({ key, seenAt: 0 })
      continue
    }
    const seen = readJson<SeenEnvelope>("local", key, {
      sanitize: (raw) => (isSeenEnvelope(raw) ? raw : null),
    })
    if (seen) entries.push({ key, seenAt: seen.seenAt })
  }
  if (entries.length <= RELEASE_NOTES_KEEP) return
  entries.sort((a, b) => b.seenAt - a.seenAt)
  for (const entry of entries.slice(RELEASE_NOTES_KEEP)) removeRaw("local", entry.key)
}

/** Clear seen flags (one version, or all release-notes keys). */
export function clearReleaseNotesSeen(version?: string): void {
  if (typeof window === "undefined") return
  if (version && version.trim()) {
    removeRaw("local", releaseNotesSeenKey(version.trim()))
    return
  }
  clearKeysByPrefix("local", RELEASE_NOTES_SEEN_PREFIX)
}

export type ReleaseNotePayload = {
  version: string
  title: string
  body: string
  publishedAt?: string
}

export async function fetchReleaseNote(version: string): Promise<ReleaseNotePayload | null> {
  const key = (version || "").trim()
  if (!key) return null
  const res = await fetch(`/api/release-notes/${encodeURIComponent(key)}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (res.status === 404) return null
  if (!res.ok) return null
  const data = (await res.json()) as ReleaseNotePayload
  if (!data?.title || !data?.body) return null
  return data
}

/** Local/staging: ?showReleaseNotes=1 forces the dialog (feature-gated). */
export function shouldForceShowReleaseNotes(): boolean {
  if (typeof window === "undefined") return false
  if (!isFeatureEnabled("RELEASE_NOTES_FORCE_PREVIEW")) return false
  try {
    const v = new URLSearchParams(window.location.search).get("showReleaseNotes")
    if (!v) return false
    const n = v.trim().toLowerCase()
    return n === "1" || n === "true" || n === "yes"
  } catch {
    return false
  }
}
