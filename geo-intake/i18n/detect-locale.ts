import type { NextRequest } from "next/server"
import { isPrivateIp, lookupCountryByIp } from "./geoip"
import { routing, type AppLocale } from "./routing"

export const LOCALE_COOKIE = "NEXT_LOCALE"
export const LOCALE_MANUAL_COOKIE = "NEXT_LOCALE_MANUAL"
export const LOCALE_IP_COOKIE = "NEXT_LOCALE_IP"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export const localeCookieOptions = {
  path: "/",
  maxAge: ONE_YEAR_SECONDS,
  sameSite: "lax" as const,
}

const GEO_HEADERS = ["X-Geo-Country", "CF-IPCountry", "X-Vercel-IP-Country", "CloudFront-Viewer-Country"]

function isAppLocale(value: string | undefined | null): value is AppLocale {
  return Boolean(value && routing.locales.includes(value as AppLocale))
}

export function localeFromCountry(country: string | null | undefined): AppLocale | null {
  if (!country) return null
  return country.toUpperCase() === "CN" ? "zh-CN" : "en"
}

/** 从反向代理注入的 Geo 头读取国家码 */
export function getGeoCountryFromHeaders(req: NextRequest): string | null {
  const configured = process.env.I18N_GEO_HEADER?.trim()
  const headers = configured ? [configured, ...GEO_HEADERS] : GEO_HEADERS
  for (const name of headers) {
    const value = req.headers.get(name)?.trim().toUpperCase()
    if (value && value !== "XX" && value !== "T1") return value
  }
  return null
}

/** 提取客户端真实 IP（兼容 Nginx / 负载均衡，跳过内网地址） */
export function getClientIp(req: NextRequest): string | null {
  const candidates: string[] = []

  for (const name of ["cf-connecting-ip", "x-real-ip", "x-client-ip", "true-client-ip"]) {
    const value = req.headers.get(name)?.trim()
    if (value) candidates.push(value)
  }

  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    candidates.push(...forwarded.split(",").map((s) => s.trim()).filter(Boolean))
  }

  const reqIp = (req as NextRequest & { ip?: string }).ip?.trim()
  if (reqIp) candidates.push(reqIp)

  for (const ip of candidates) {
    if (!isPrivateIp(ip)) return ip
  }

  return candidates[0] ?? null
}

export { isPrivateIp, lookupCountryByIp } from "./geoip"

export type LocaleDetectSource =
  | "cookie"
  | "param"
  | "geo-header"
  | "ip"
  | "accept-language"
  | "default"

export type LocaleDetectResult = {
  locale: AppLocale
  source: LocaleDetectSource
  country: string | null
}

/**
 * 语言检测优先级：
 * 手动切换 > URL 参数 > Geo 头 > IP 查询 > 已验证 IP Cookie > Accept-Language > 默认 en
 */
export async function detectLocale(req: NextRequest): Promise<LocaleDetectResult> {
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value
  const isManual = Boolean(req.cookies.get(LOCALE_MANUAL_COOKIE)?.value)
  const ipVerified = req.cookies.get(LOCALE_IP_COOKIE)?.value

  if (isManual && isAppLocale(cookie)) {
    return { locale: cookie, source: "cookie", country: null }
  }

  const langParam = req.nextUrl.searchParams.get("lang")
  if (isAppLocale(langParam)) {
    return { locale: langParam, source: "param", country: null }
  }

  const forced = process.env.I18N_FORCE_LOCALE?.trim()
  if (isAppLocale(forced)) {
    return { locale: forced, source: "param", country: null }
  }

  const headerCountry = getGeoCountryFromHeaders(req)
  const headerLocale = localeFromCountry(headerCountry)
  if (headerLocale) {
    return { locale: headerLocale, source: "geo-header", country: headerCountry }
  }

  const clientIp = getClientIp(req)
  if (clientIp) {
    const ipCountry = await lookupCountryByIp(clientIp)
    const ipLocale = localeFromCountry(ipCountry)
    if (ipLocale) {
      return { locale: ipLocale, source: "ip", country: ipCountry }
    }
  }

  // 仅信任经 IP 检测写入的 Cookie，忽略旧的未验证 Cookie（如开 VPN 时残留的 en）
  if (ipVerified && isAppLocale(cookie)) {
    return { locale: cookie, source: "cookie", country: ipVerified }
  }

  const acceptLang = req.headers.get("accept-language")?.toLowerCase() ?? ""
  if (acceptLang.includes("zh")) {
    return { locale: "zh-CN", source: "accept-language", country: null }
  }

  return { locale: routing.defaultLocale, source: "default", country: null }
}

export function shouldPersistLocaleCookie(source: LocaleDetectSource): boolean {
  return source === "param" || source === "geo-header" || source === "ip" || source === "cookie"
}
