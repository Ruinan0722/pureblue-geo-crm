"use client"

import { useRouter } from "next/navigation"
import { useLocale } from "next-intl"
import { cn } from "@/shared/lib/utils"
import { LOCALE_COOKIE, LOCALE_IP_COOKIE, LOCALE_MANUAL_COOKIE, localeCookieOptions } from "@/i18n/detect-locale"
import { routing, type AppLocale } from "@/i18n/routing"

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as AppLocale
  const router = useRouter()

  function switchTo(next: AppLocale) {
    if (next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next};path=${localeCookieOptions.path};max-age=${localeCookieOptions.maxAge};samesite=${localeCookieOptions.sameSite}`
    document.cookie = `${LOCALE_MANUAL_COOKIE}=1;path=${localeCookieOptions.path};max-age=${localeCookieOptions.maxAge};samesite=${localeCookieOptions.sameSite}`
    document.cookie = `${LOCALE_IP_COOKIE}=;path=${localeCookieOptions.path};max-age=0;samesite=${localeCookieOptions.sameSite}`
    router.refresh()
  }

  return (
    <div className={cn("flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5 text-xs", className)}>
      {routing.locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => switchTo(loc)}
          className={cn(
            "rounded-md px-2 py-1 font-medium transition-colors",
            locale === loc ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={locale === loc}
        >
          {loc === "en" ? "EN" : "中文"}
        </button>
      ))}
    </div>
  )
}
