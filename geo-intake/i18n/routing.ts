import { defineRouting } from "next-intl/routing"

export const routing = defineRouting({
  locales: ["en", "zh-CN"],
  defaultLocale: "en",
  localePrefix: "never",
  localeDetection: false,
})

export type AppLocale = (typeof routing.locales)[number]
