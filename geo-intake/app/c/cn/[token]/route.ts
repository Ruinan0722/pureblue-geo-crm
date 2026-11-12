import { NextResponse } from "next/server"
import { INVITE_COOKIE, JWT_COOKIE, SESSION_COOKIE } from "@/modules/auth/lib/constants"
import { inviteCookieOptions } from "@/modules/auth/lib/cookies"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

/** 国内邀请入口：/c/cn/[token] → /intake/cn（路径本身编码变体，不依赖 query）。 */
export async function GET(req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.url

  if (!token?.trim()) {
    return NextResponse.redirect(new URL("/?reason=invalid", baseUrl))
  }

  const res = NextResponse.redirect(new URL("/intake/cn", baseUrl))
  res.cookies.delete(SESSION_COOKIE)
  res.cookies.delete(JWT_COOKIE)
  res.cookies.set(INVITE_COOKIE, token.trim(), inviteCookieOptions())
  return res
}
