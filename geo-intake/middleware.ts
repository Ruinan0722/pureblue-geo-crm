import { NextRequest, NextResponse } from "next/server"
import {
  detectLocale,
  LOCALE_COOKIE,
  LOCALE_IP_COOKIE,
  localeCookieOptions,
  shouldPersistLocaleCookie,
  type LocaleDetectSource,
} from "@/i18n/detect-locale"
import { intakeMiddleware } from "@/modules/auth/intake-middleware"

const LOCALE_HEADER = "x-next-intl-locale"

function applyLocaleCookies(res: NextResponse, locale: string, source: LocaleDetectSource, country?: string | null) {
  if (!shouldPersistLocaleCookie(source)) return
  res.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions)
  if ((source === "ip" || source === "geo-header") && country) {
    res.cookies.set(LOCALE_IP_COOKIE, country, localeCookieOptions)
  }
}

export async function middleware(req: NextRequest) {
  const { locale, source, country } = await detectLocale(req)
  const langParam = req.nextUrl.searchParams.get("lang")
  const shouldSetCookie = Boolean(langParam) || shouldPersistLocaleCookie(source)

  const authResponse = await intakeMiddleware(req)
  if (authResponse.headers.has("location")) {
    if (shouldSetCookie) applyLocaleCookies(authResponse, locale, source, country)
    return authResponse
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set(LOCALE_HEADER, locale)

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  })
  if (shouldSetCookie) applyLocaleCookies(res, locale, source, country)
  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
