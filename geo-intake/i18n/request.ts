import { getRequestConfig } from "next-intl/server"
import { cookies, headers } from "next/headers"
import { routing, type AppLocale } from "./routing"
import { LOCALE_COOKIE } from "./detect-locale"

function resolveLocale(value: string | undefined | null): AppLocale | null {
  if (value && routing.locales.includes(value as AppLocale)) {
    return value as AppLocale
  }
  return null
}

export default getRequestConfig(async () => {
  const headerStore = await headers()
  const cookieStore = await cookies()

  const locale =
    resolveLocale(headerStore.get("x-next-intl-locale")) ??
    resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value) ??
    routing.defaultLocale

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
