import { NextResponse } from "next/server"
import { INVITE_COOKIE, JWT_COOKIE, SESSION_COOKIE } from "@/modules/auth/lib/constants"
import { inviteCookieOptions } from "@/modules/auth/lib/cookies"
import { resolveInviteToken } from "@/modules/invites/lib/resolve-invite"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

/** 邀请入口：写入 cookie 后进表单。优先按库中 geo_variant 跳转，?v=cn 仅作兜底。 */
export async function GET(req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.url

  if (!token?.trim()) {
    return NextResponse.redirect(new URL("/?reason=invalid", baseUrl))
  }

  const incoming = new URL(req.url)
  const resolved = await resolveInviteToken(token.trim())
  const domestic =
    resolved.geoVariant === "domestic" ||
    (resolved.geoVariant == null && incoming.searchParams.get("v") === "cn")
  const path = domestic ? "/intake/cn" : "/intake"
  const res = NextResponse.redirect(new URL(path, baseUrl))
  res.cookies.delete(SESSION_COOKIE)
  res.cookies.delete(JWT_COOKIE)
  res.cookies.set(INVITE_COOKIE, token.trim(), inviteCookieOptions())
  return res
}
