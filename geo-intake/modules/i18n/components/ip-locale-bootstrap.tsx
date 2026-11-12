"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { LOCALE_COOKIE, LOCALE_IP_COOKIE, LOCALE_MANUAL_COOKIE, localeCookieOptions } from "@/i18n/detect-locale"
import { routing, type AppLocale } from "@/i18n/routing"

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=${localeCookieOptions.path};max-age=${localeCookieOptions.maxAge};samesite=${localeCookieOptions.sameSite}`
}

function deleteCookie(name: string) {
  document.cookie = `${name}=;path=${localeCookieOptions.path};max-age=0;samesite=${localeCookieOptions.sameSite}`
}

function isAppLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value && routing.locales.includes(value as AppLocale))
}

/**
 * 通过本站 API 检测 IP 归属（服务端查 IP，国内用户不被墙）。
 * 手动切换语言后不再自动覆盖。
 */
export function IpLocaleBootstrap() {
  const router = useRouter()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    if (readCookie(LOCALE_MANUAL_COOKIE)) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 5000)

    fetch("/api/locale/detect", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { country?: string | null; locale?: string | null } | null) => {
        const rawLocale = data?.locale ?? null
        let locale: AppLocale | null = isAppLocale(rawLocale) ? rawLocale : null

        // IP 检测失败（如负载均衡未透传公网 IP）时，用浏览器语言兜底
        if (!locale && typeof navigator !== "undefined") {
          const lang = navigator.language.toLowerCase()
          if (lang.includes("zh")) locale = "zh-CN"
        }

        if (!locale) return

        const country = data?.country?.trim().toUpperCase() ?? ""
        const current = readCookie(LOCALE_COOKIE)

        if (country) writeCookie(LOCALE_IP_COOKIE, country)
        writeCookie(LOCALE_COOKIE, locale)

        if (current !== locale) router.refresh()
      })
      .catch(() => {
        /* 检测失败时保留服务端结果 */
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [router])

  return null
}

export function clearLocaleCookiesForDebug() {
  deleteCookie(LOCALE_COOKIE)
  deleteCookie(LOCALE_MANUAL_COOKIE)
  deleteCookie(LOCALE_IP_COOKIE)
}
