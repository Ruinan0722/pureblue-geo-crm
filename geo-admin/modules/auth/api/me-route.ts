import { NextResponse } from "next/server"
import { getAuthFromRequest } from "@/modules/auth/lib/get-auth"
import { INVITE_COOKIE, SESSION_COOKIE } from "@/modules/auth/lib/constants"
import { isFeishuConfigured } from "@/modules/auth/lib/feishu"
import { jwtCookieName } from "@/modules/auth/lib/dev-jwt"
import { clearAuthCookies, clearInviteCookie } from "@/modules/auth/lib/auth-cookies"
import { resolveRequestOrigin } from "@/modules/auth/lib/request-origin"

export const runtime = "nodejs"

const GEO_API = process.env.GEO_API_URL?.replace(/\/$/, "")

function hadAuthCookies(header: string): boolean {
  const values = new Map(header.split(";").map((part) => {
    const position = part.indexOf("=")
    return [part.slice(0, position).trim(), part.slice(position + 1)]
  }))
  return [jwtCookieName(), SESSION_COOKIE, INVITE_COOKIE].some((name) => Boolean(values.get(name)))
}


function anonymousMeResponse(clearStaleCookies: boolean) {
  const res = NextResponse.json({ kind: "anonymous", feishuConfigured: isFeishuConfigured() })
  return clearStaleCookies ? clearAuthCookies(res) : res
}

/**
 * 测试身份登录 / 退出统一转发 geo-api（唯一数据与权限来源）。
 * 本路由只做浏览器 cookie/kind 适配，不直连 MySQL/Redis。
 */
async function forwardToGeoApi(req: Request, path: string): Promise<NextResponse> {
  if (!GEO_API) {
    return NextResponse.json({ error: "GEO_API_URL 未配置" }, { status: 500 })
  }
  const origin = resolveRequestOrigin(req)
  const url = new URL(origin)
  const headers = new Headers()
  headers.set("x-forwarded-host", url.host)
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""))
  const cookie = req.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)

  const body = req.method === "POST" ? await req.arrayBuffer() : undefined
  const upstream = await fetch(`${GEO_API}${path}`, {
    method: req.method,
    headers: {
      ...Object.fromEntries(headers.entries()),
      ...(body !== undefined
        ? { "Content-Type": req.headers.get("content-type") || "application/json" }
        : {}),
    },
    ...(body !== undefined ? { body } : {}),
  })
  const upstreamBody = await upstream.arrayBuffer()
  const res = new NextResponse(upstreamBody, { status: upstream.status })
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return
    res.headers.set(key, value)
  })
  return res
}

export async function GET(req: Request) {
  // Route handlers already have the incoming request; resolve its cookies directly.
  // The API remains the sole source of the effective role, permissions and data scope.
  const hadCookies = hadAuthCookies(req.headers.get("cookie") ?? "")
  const auth = await getAuthFromRequest(req)

  if (auth.kind === "user") {
    const res = NextResponse.json({
      kind: "user",
      user: auth.user,
      feishuConfigured: isFeishuConfigured(),
    })
    return clearInviteCookie(res)
  }

  if (auth.kind === "customer") {
    return NextResponse.json({
      kind: "customer",
      feishuConfigured: isFeishuConfigured(),
    })
  }

  return anonymousMeResponse(hadCookies)
}

export async function POST(req: Request) {
  return forwardToGeoApi(req, "/api/auth/me")
}

export async function DELETE(req: Request) {
  return forwardToGeoApi(req, "/api/auth/me")
}
