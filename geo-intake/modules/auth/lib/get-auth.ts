import { getInviteTokenFromCookies } from "./cookies"
import type { AuthState } from "./constants"

/** 有 invite cookie 即视为客户会话；token 真伪在 submit 时由 geo-api 校验。 */
export async function getAuth(): Promise<AuthState> {
  const inviteToken = await getInviteTokenFromCookies()
  if (!inviteToken) return { kind: "anonymous" }
  return { kind: "customer", inviteToken }
}

export async function getAuthFromRequest(req: Request): Promise<AuthState> {
  const cookieHeader = req.headers.get("cookie") ?? ""
  const inviteToken = parseCookie(cookieHeader, "geo_invite_token")
  if (!inviteToken) return { kind: "anonymous" }
  return { kind: "customer", inviteToken }
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** 提交时：invite 优先于 body 中的 token */
export function resolveSubmitInviteToken(auth: AuthState, bodyToken?: string): string | null {
  if (bodyToken?.trim()) return bodyToken.trim()
  if (auth.kind === "customer") return auth.inviteToken
  return null
}
