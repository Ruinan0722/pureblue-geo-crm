import { NextResponse } from "next/server"
import { INVITE_COOKIE, JWT_COOKIE, SESSION_COOKIE } from "./constants"

/** 清除所有鉴权相关 Cookie（含遗留 session / 客户邀请） */
export function clearAuthCookies(res: NextResponse): NextResponse {
  res.cookies.delete(JWT_COOKIE)
  res.cookies.delete(SESSION_COOKIE)
  res.cookies.delete(INVITE_COOKIE)
  return res
}

/** 仅清除遗留 geo_session，保留有效 JWT（避免登录后 API 被误清票） */
export function clearStaleSessionCookie(res: NextResponse): NextResponse {
  res.cookies.delete(SESSION_COOKIE)
  return res
}

/** 员工登录成功后清除客户邀请 Cookie，避免身份混淆 */
export function clearInviteCookie(res: NextResponse): NextResponse {
  res.cookies.delete(INVITE_COOKIE)
  return res
}
