"use client"

import { useLocale, useTranslations } from "next-intl"
import { useMemo } from "react"
import {
  ALL_COUNTRY_CODES,
  ALL_LANGUAGE_CODES,
  OPTIMIZATION_GOAL_VALUES,
  displayCountryName,
  displayLanguageName,
  type OptimizationGoalValue,
} from "@/modules/intake/lib/form-options"

export function useCountryLabels() {
  const locale = useLocale()
  return (countryKey: string) => displayCountryName(countryKey, locale)
}

export function useLanguageLabels() {
  const locale = useLocale()
  return (languageKey: string) => displayLanguageName(languageKey, locale)
}

export function useCountryOptions() {
  const locale = useLocale()
  return useMemo(
    () =>
      ALL_COUNTRY_CODES.map((key) => ({
        value: key,
        label: displayCountryName(key, locale),
        keywords: `${key} ${displayCountryName(key, "en")} ${displayCountryName(key, "zh-CN")}`,
      })),
    [locale],
  )
}

export function useLanguageOptions(_countryKey?: string) {
  const locale = useLocale()
  return useMemo(
    () =>
      ALL_LANGUAGE_CODES.map((key) => ({
        value: key,
        label: displayLanguageName(key, locale),
        keywords: `${key} ${displayLanguageName(key, "en")} ${displayLanguageName(key, "zh-CN")}`,
      })),
    [locale],
  )
}

export function useOptimizationGoals() {
  const t = useTranslations("goals")
  return OPTIMIZATION_GOAL_VALUES.map((value) => ({
    value,
    label: t(`${value}.label`),
    desc: t(`${value}.desc`),
  }))
}

export type { OptimizationGoalValue }
