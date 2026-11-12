import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const INVITE = "geo_invite_token"

function redirectBlocked(req: NextRequest, reason?: "revoked" | "invalid") {
  const url = new URL("/", req.url)
  if (reason) url.searchParams.set("reason", reason)
  const res = NextResponse.redirect(url)
  res.cookies.delete(INVITE)
  return res
}

/** 客户填报端：仅 invite cookie；有效性在 POST /api/intake/submit 时由 geo-api 校验。 */
export async function intakeMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const inviteToken = req.cookies.get(INVITE)?.value
  const hasInvite = Boolean(inviteToken)

  if (pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/c/")) {
    return NextResponse.next()
  }

  if (pathname === "/channel-profile") return NextResponse.next()

  // 首页为无权访问提示，不是填报入口
  if (pathname === "/") {
    return NextResponse.next()
  }

  // 旧地址兼容：跳回首页
  if (pathname.startsWith("/intake/need-link")) {
    const reason = req.nextUrl.searchParams.get("reason")
    const url = new URL("/", req.url)
    if (reason) url.searchParams.set("reason", reason)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/intake")) {
    if (!hasInvite) {
      return redirectBlocked(req, "invalid")
    }
    return NextResponse.next()
  }

  return redirectBlocked(req, "invalid")
}
