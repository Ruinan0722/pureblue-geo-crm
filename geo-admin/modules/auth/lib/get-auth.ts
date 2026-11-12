import { cache } from "react"
import { get as httpGet } from "node:http"
import { get as httpsGet } from "node:https"
import { getInviteTokenFromCookies } from "./cookies"
import type { AuthState, AuthUser } from "./constants"
import { jwtCookieName } from "./dev-jwt"

/**
 * 鉴权统一收敛：geo-api /api/auth/me 是唯一权限来源。
 * 前端不再本地验 JWT / 直连 MySQL 计算权限（详见 docs/engineering/geo-api-single-backend.md）。
 */
async function fetchMeUser(cookieHeader?: string): Promise<AuthUser | null> {
  const base = (process.env.GEO_API_URL || "").replace(/\/$/, "")
  if (!base) return null
  const headers: Record<string, string> = {}
  if (cookieHeader) headers.Cookie = cookieHeader
  try {
    // Identity must always reach the API. Use a short-lived Node connection so
    // Next's render/fetch lifecycle cannot keep a browser identity request pending.
    const url = new URL(`${base}/api/auth/me`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return await new Promise<AuthUser | null>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsGet : httpGet)(url, {
        headers, agent: false, signal: AbortSignal.timeout(10_000),
      }, (response) => {
        if (response.statusCode !== 200) { response.resume(); resolve(null); return }
        let body = ""
        response.setEncoding("utf8")
        response.on("data", (chunk: string) => {
          body += chunk
          if (body.length > 1_048_576) request.destroy(new Error("Identity response too large"))
        })
        response.on("error", reject)
        response.on("end", () => {
          try { resolve((JSON.parse(body) as { user?: AuthUser | null }).user ?? null) }
          catch (error) { reject(error) }
        })
      })
      request.on("error", reject)
    })
  } catch {
    return null
  }
}

async function getUserFromJwtCookies(): Promise<AuthUser | null> {
  const { cookies } = await import("next/headers")
  const store = await cookies()
  const hasToken = Boolean(store.get(jwtCookieName())?.value)
  if (!hasToken) return null
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ")
  return fetchMeUser(cookieHeader)
}

async function getUserFromJwtHeader(cookieHeader: string): Promise<AuthUser | null> {
  if (!parseCookie(cookieHeader, jwtCookieName())) return null
  return fetchMeUser(cookieHeader)
}

async function isInviteTokenValid(token: string): Promise<boolean> {
  const apiBase = process.env.GEO_API_URL?.replace(/\/$/, "")
  if (!apiBase) return false

  try {
    const res = await fetch(`${apiBase}/api/invites/resolve/${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
    if (!res.ok) return false
    const data = (await res.json()) as { valid?: boolean }
    return Boolean(data.valid)
  } catch {
    return false
  }
}

async function getAuthUncached(): Promise<AuthState> {
  const jwtUser = await getUserFromJwtCookies()
  if (jwtUser) return { kind: "user", user: jwtUser }

  const inviteToken = await getInviteTokenFromCookies()
  if (inviteToken && (await isInviteTokenValid(inviteToken))) {
    return { kind: "customer", inviteToken }
  }

  return { kind: "anonymous" }
}

/** 同一 RSC 请求内去重；跨请求仍会查库（权限变更需新请求生效） */
export const getAuth = cache(getAuthUncached)

export async function getAuthFromRequest(req: Request): Promise<AuthState> {
  const cookieHeader = req.headers.get("cookie") ?? ""
  const jwtUser = await getUserFromJwtHeader(cookieHeader)
  if (jwtUser) return { kind: "user", user: jwtUser }

  const inviteToken = parseCookie(cookieHeader, "geo_invite_token")
  if (inviteToken && (await isInviteTokenValid(inviteToken))) {
    return { kind: "customer", inviteToken }
  }

  return { kind: "anonymous" }
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

/** 提交时：invite 优先于 staff session */
export function resolveSubmitInviteToken(auth: AuthState, bodyToken?: string): string | null {
  if (bodyToken?.trim()) return bodyToken.trim()
  if (auth.kind === "customer") return auth.inviteToken
  return null
}
