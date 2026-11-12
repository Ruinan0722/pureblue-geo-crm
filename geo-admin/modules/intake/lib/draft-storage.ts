import type { GeoFormData } from "./form-schema"
import { readRaw, removeRaw, writeRaw } from "@/shared/lib/storage"

const DRAFT_PREFIX = "geo-form-draft"

function readInviteTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)geo_invite_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

/** 内部填报与不同客户邀请链接使用独立草稿 key，避免互相覆盖 */
export function intakeDraftKey(variantSuffix = ""): string {
  const inviteToken = readInviteTokenFromCookie()
  if (inviteToken) return `${DRAFT_PREFIX}:invite:${inviteToken.slice(0, 24)}${variantSuffix}`
  return `${DRAFT_PREFIX}:staff${variantSuffix}`
}

export function saveIntakeDraft(data: GeoFormData, variantSuffix = "") {
  if (typeof window === "undefined") return
  writeRaw("local", intakeDraftKey(variantSuffix), JSON.stringify(data))
}

export function loadIntakeDraftRaw(variantSuffix = ""): string | null {
  if (typeof window === "undefined") return null
  return readRaw("local", intakeDraftKey(variantSuffix))
}

export function clearIntakeDraft(variantSuffix = "") {
  if (typeof window === "undefined") return
  removeRaw("local", intakeDraftKey(variantSuffix))
}
