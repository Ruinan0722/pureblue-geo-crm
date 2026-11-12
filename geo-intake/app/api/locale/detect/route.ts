import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  getClientIp,
  localeFromCountry,
  lookupCountryByIp,
} from "@/i18n/detect-locale"

export const runtime = "nodejs"

/** 供客户端检测当前访问者 IP 归属（走本站域名，避免浏览器直连境外 IP 库被墙） */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  if (!ip) {
    return NextResponse.json({ ip: null, country: null, locale: null })
  }

  const country = await lookupCountryByIp(ip)
  const locale = localeFromCountry(country)

  return NextResponse.json({ ip, country, locale })
}
