import { localeFromCountry } from "./detect-locale"
import type { AppLocale } from "./routing"

export function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.")) return true
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true
  return false
}

type GeoProvider = {
  name: string
  url: (ip: string) => string
  parse: (body: string) => string | null
}

const PROVIDERS: GeoProvider[] = [
  {
    name: "ip-api",
    url: (ip) => `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=countryCode`,
    parse: (body) => {
      try {
        const data = JSON.parse(body) as { countryCode?: string }
        return data.countryCode?.trim().toUpperCase() || null
      } catch {
        return null
      }
    },
  },
  {
    name: "ipapi",
    url: (ip) => `https://ipapi.co/${encodeURIComponent(ip)}/country_code/`,
    parse: (body) => body.trim().toUpperCase() || null,
  },
  {
    name: "ipwhois",
    url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}?fields=country_code`,
    parse: (body) => {
      try {
        const data = JSON.parse(body) as { country_code?: string; success?: boolean }
        if (data.success === false) return null
        return data.country_code?.trim().toUpperCase() || null
      } catch {
        return null
      }
    },
  },
]

/** 多源 IP 归属查询（ip-api 在国内较稳定，ipapi 作备选） */
export async function lookupCountryByIp(ip: string): Promise<string | null> {
  if (isPrivateIp(ip)) return null

  for (const provider of PROVIDERS) {
    try {
      const res = await fetch(provider.url(ip), {
        signal: AbortSignal.timeout(3000),
        headers: { "User-Agent": "geo-intake/1.0" },
        next: { revalidate: 86400 },
      })
      if (!res.ok) continue
      const code = provider.parse(await res.text())
      if (code && code !== "XX") return code
    } catch {
      continue
    }
  }
  return null
}

export function localeFromIpCountry(country: string | null | undefined): AppLocale | null {
  return localeFromCountry(country)
}
