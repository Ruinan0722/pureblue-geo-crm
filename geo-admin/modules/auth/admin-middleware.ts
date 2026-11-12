import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE } from "@/modules/auth/lib/constants"
import { getAccessTokenFromRequest, verifyAccessToken } from "@/modules/auth/lib/jwt-auth"
import { clearAuthCookies, clearStaleSessionCookie } from "@/modules/auth/lib/auth-cookies"

type AuthGate = {
  loggedIn: boolean
  /** 无效/缺失 JWT 时清掉全部鉴权 Cookie */
  clearAllAuth: boolean
  /** JWT 有效但浏览器仍残留旧版 geo_session 时，只删 session，绝不删 JWT */
  clearStaleSessionOnly: boolean
}

async function resolveAuthState(req: NextRequest): Promise<AuthGate> {
  const hasStaleSession = req.cookies.has(SESSION_COOKIE)
  const token = getAccessTokenFromRequest(req)

  if (!token) {
    return { loggedIn: false, clearAllAuth: hasStaleSession, clearStaleSessionOnly: false }
  }

  const verified = await verifyAccessToken(token)
  if (!verified) {
    return { loggedIn: false, clearAllAuth: true, clearStaleSessionOnly: false }
  }
  return {
    loggedIn: true,
    clearAllAuth: false,
    clearStaleSessionOnly: hasStaleSession,
  }
}

function finish(res: NextResponse, gate: Pick<AuthGate, "clearAllAuth" | "clearStaleSessionOnly">) {
  if (gate.clearAllAuth) return clearAuthCookies(res)
  if (gate.clearStaleSessionOnly) return clearStaleSessionCookie(res)
  return res
}

/**
 * 开发态：HTML 不缓存。
 *
 * 不再下发 Clear-Site-Data: "cache"：
 * - dev chunk 由 Next 以 no-cache/must-revalidate 提供，且 main-app.js 带 ?v= 版本参数，
 *   不存在 immutable 残留导致的“切分支/改码后用旧包”问题；
 * - 登录页清理 cookie 后若再触发整站缓存清空，会导致每次登录都把全部 JS 重新下载
 *   （dev 未压缩产物可达几十 MB），登录体验极慢。
 */
function finishDocument(
  req: NextRequest,
  res: NextResponse,
  gate: Pick<AuthGate, "clearAllAuth" | "clearStaleSessionOnly">,
) {
  const out = finish(res, gate)
  if (process.env.NODE_ENV === "development") {
    out.headers.set("Cache-Control", "no-store")
  }
  return out
}

/** 内部管理端：JWT Cookie 鉴权 */
export async function adminMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const gate = await resolveAuthState(req)

  if (pathname.startsWith("/api/")) {
    return finish(NextResponse.next(), gate)
  }

  if (pathname === "/") {
    if (gate.loggedIn) {
      return finishDocument(req, NextResponse.redirect(new URL("/go", req.url)), gate)
    }
    return finishDocument(req, NextResponse.redirect(new URL("/login", req.url)), gate)
  }

  if (pathname === "/login") {
    if (gate.loggedIn) {
      return finishDocument(req, NextResponse.redirect(new URL("/go", req.url)), gate)
    }
    // 未登录访问 /login：显式删除鉴权 Cookie（Set-Cookie 过期即可生效）。
    // 仅当确实残留旧认证态（无效 JWT / 遗留 session）时才硬清整站 cookie，
    // 覆盖 Chrome 被旧自签会话卡住的极端场景；正常访问不触发，避免误伤其他 cookie。
    const res = NextResponse.next()
    clearAuthCookies(res)
    res.headers.set("Cache-Control", "no-store")
    if (gate.clearAllAuth) {
      res.headers.set("Clear-Site-Data", '"cookies"')
    }
    return res
  }

  const protectedPrefixes = [
    "/go",
    "/home",
    "/leads",
    "/customers",
    "/channels",
    "/ecosystems",
    "/opportunities",
    "/contracts",
    "/projects",
    "/dashboard",
    "/requests",
    "/settings",
    "/checkin",
    "/intake",
  ]
  if (protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!gate.loggedIn) {
      return finishDocument(req, NextResponse.redirect(new URL("/login", req.url)), {
        clearAllAuth: true,
        clearStaleSessionOnly: false,
      })
    }
    return finishDocument(req, NextResponse.next(), gate)
  }

  return finishDocument(req, NextResponse.next(), gate)
}
