import {
  ALL_COUNTRY_CODES,
  ALL_LANGUAGE_CODES,
  isKnownCountryCode,
  isKnownLanguageCode,
} from "./locale-codes"
import { OPTIMIZATION_GOAL_VALUES } from "@/modules/requests/lib/status-catalog.generated"

export { OPTIMIZATION_GOAL_VALUES }
export type OptimizationGoalValue = (typeof OPTIMIZATION_GOAL_VALUES)[number]

/** @deprecated 保留旧映射结构；国家与语言已解耦为全量列表 */
export const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = Object.fromEntries(
  ALL_COUNTRY_CODES.map((c) => [c, ALL_LANGUAGE_CODES]),
)

export const COUNTRY_OPTIONS = ALL_COUNTRY_CODES

export const LANGUAGE_OPTIONS = ALL_LANGUAGE_CODES

export const AI_PLATFORM_OPTIONS = ["ChatGPT"]
export const DEFAULT_PLATFORM = "ChatGPT"

/** @deprecated 旧版中文国家名 → key，用于草稿迁移 */
export const LEGACY_COUNTRY_MAP: Record<string, string> = {
  美国: "US",
  英国: "GB",
  加拿大: "CA",
  德国: "DE",
  法国: "FR",
  日本: "JP",
  韩国: "KR",
  澳大利亚: "AU",
  东南亚: "SEA",
  中东: "MENA",
  UK: "GB",
  /** 旧表单用 ME 表示中东；ME 同时是黑山 ISO 码，产品内统一迁到 MENA */
  ME: "MENA",
}

/** @deprecated 旧版中文语言名 → key */
export const LEGACY_LANGUAGE_MAP: Record<string, string> = {
  英语: "en",
  西班牙语: "es",
  法语: "fr",
  德语: "de",
  日语: "ja",
  韩语: "ko",
  马来语: "ms",
  泰语: "th",
  越南语: "vi",
  印尼语: "id",
  阿拉伯语: "ar",
  中文: "zh",
  汉语: "zh",
}

export function normalizeCountryKey(value: string): string {
  if (!value) return ""
  const mapped = LEGACY_COUNTRY_MAP[value]
  if (mapped) return mapped
  if (isKnownCountryCode(value)) return value
  return value
}

export function normalizeLanguageKey(value: string): string {
  if (!value) return ""
  if (isKnownLanguageCode(value)) return value
  return LEGACY_LANGUAGE_MAP[value] ?? value
}

/** 语言与国家解耦：任意国家可选全部语言 */
export function languagesForCountry(_countryKey?: string): string[] {
  return LANGUAGE_OPTIONS
}

export {
  displayCountryName,
  displayLanguageName,
  ALL_COUNTRY_CODES,
  ALL_LANGUAGE_CODES,
} from "./locale-codes"
