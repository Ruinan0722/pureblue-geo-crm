import type { GeoFormData } from "./form-schema"

const DRAFT_PREFIX = "geo-form-draft"

/** 仅用于生成不暴露邀请凭证的稳定本地 key，不作为密码学签名。 */
function inviteFingerprint(token: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

function readInviteTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)geo_invite_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

export { readInviteTokenFromCookie }

/** 内部填报与不同客户邀请链接使用独立草稿 key，避免互相覆盖 */
export function intakeDraftKey(inviteToken?: string | null, variantSuffix = "") {
  const token = inviteToken?.trim() || readInviteTokenFromCookie()
  if (token) return `${DRAFT_PREFIX}:invite:${inviteFingerprint(token)}${variantSuffix}`
  return `${DRAFT_PREFIX}:staff${variantSuffix}`
}

function legacyIntakeDraftKey(inviteToken?: string | null, variantSuffix = "") {
  const token = inviteToken?.trim() || readInviteTokenFromCookie()
  return token ? `${DRAFT_PREFIX}:invite:${token.slice(0, 24)}${variantSuffix}` : null
}

export function saveIntakeDraft(
  data: GeoFormData,
  inviteToken?: string | null,
  variantSuffix = "",
): boolean {
  if (typeof window === "undefined") return false
  try {
    window.localStorage.setItem(intakeDraftKey(inviteToken, variantSuffix), JSON.stringify(data))
    const legacyKey = legacyIntakeDraftKey(inviteToken, variantSuffix)
    if (legacyKey) window.localStorage.removeItem(legacyKey)
    return true
  } catch {
    return false
  }
}

export function loadIntakeDraftRaw(inviteToken?: string | null, variantSuffix = ""): string | null {
  if (typeof window === "undefined") return null
  const key = intakeDraftKey(inviteToken, variantSuffix)
  const current = window.localStorage.getItem(key)
  if (current) return current

  const legacyKey = legacyIntakeDraftKey(inviteToken, variantSuffix)
  const legacy = legacyKey ? window.localStorage.getItem(legacyKey) : null
  if (legacy) {
    try {
      window.localStorage.setItem(key, legacy)
      window.localStorage.removeItem(legacyKey!)
    } catch {
      // 迁移失败时仍返回旧草稿，避免丢失客户已填写内容。
    }
  }
  return legacy
}

export function clearIntakeDraft(inviteToken?: string | null, variantSuffix = "") {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(intakeDraftKey(inviteToken, variantSuffix))
  const legacyKey = legacyIntakeDraftKey(inviteToken, variantSuffix)
  if (legacyKey) window.localStorage.removeItem(legacyKey)
}
