import {
  ALL_COUNTRY_CODES,
  ALL_LANGUAGE_CODES,
  displayCountryName,
  displayLanguageName,
  isKnownCountryCode,
  isKnownLanguageCode,
} from "./locale-codes"

/** @deprecated 保留旧映射结构；国家与语言已解耦为全量列表 */
export const COUNTRY_LANGUAGES: Record<string, string[]> = Object.fromEntries(
  ALL_COUNTRY_CODES.map((c) => [c, ALL_LANGUAGE_CODES]),
)

export const COUNTRY_OPTIONS = ALL_COUNTRY_CODES

export const LANGUAGE_OPTIONS = ALL_LANGUAGE_CODES

/** 客户填报端存储的 stable key → 中文展示名（含 Intl 全量国家/语言） */
export const REGION_KEY_COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  ALL_COUNTRY_CODES.map((code) => [code, displayCountryName(code, "zh-CN")]),
)

export const REGION_KEY_LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  ALL_LANGUAGE_CODES.map((code) => [code, displayLanguageName(code, "zh-CN")]),
)

export function languagesForCountry(_country?: string): string[] {
  return LANGUAGE_OPTIONS
}

export function normalizeCountryKey(value: string): string {
  if (!value) return ""
  const legacy: Record<string, string> = {
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
  const mapped = legacy[value]
  if (mapped) return mapped
  if (isKnownCountryCode(value)) return value
  return value
}

export function normalizeLanguageKey(value: string): string {
  if (!value) return ""
  if (isKnownLanguageCode(value)) return value
  const legacy: Record<string, string> = {
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
    中文: "zh-Hans",
    汉语: "zh-Hans",
    简体中文: "zh-Hans",
    繁体中文: "zh-Hant",
  }
  return legacy[value] ?? value
}

export const AI_PLATFORM_OPTIONS = ["ChatGPT", "Gemini"]
export const DEFAULT_PLATFORM = "ChatGPT"

export const OPTIMIZATION_GOALS = [
  { value: "source", label: "来源率", desc: "品牌官网/内容被 AI 引用作为信息来源的比例" },
  { value: "recommend", label: "推荐率", desc: "AI 回答中提及或推荐该品牌的比例" },
  { value: "top3", label: "前三推荐率", desc: "品牌出现在 AI 推荐前三位的比例" },
  { value: "priority", label: "优先推荐率", desc: "品牌被作为首选推荐的比例" },
] as const

export const OVERSEAS_RECOMMENDATION_GOALS = ["recommend", "top3", "priority"] as const

export { displayCountryName, displayLanguageName, ALL_COUNTRY_CODES, ALL_LANGUAGE_CODES }

/** 设置页「选项库」展示用：常用国家/语言中文名，避免全量列表撑爆 UI */
export const SETTINGS_COUNTRY_PRESETS = [
  "美国",
  "英国",
  "加拿大",
  "澳大利亚",
  "德国",
  "法国",
  "日本",
  "韩国",
  "新加坡",
  "马来西亚",
  "泰国",
  "越南",
  "印尼",
  "菲律宾",
  "阿联酋",
  "沙特阿拉伯",
  "中东",
]

export const SETTINGS_LANGUAGE_PRESETS = [
  "英语",
  "中文",
  "西班牙语",
  "法语",
  "德语",
  "日语",
  "韩语",
  "葡萄牙语",
  "阿拉伯语",
  "马来语",
  "泰语",
  "越南语",
  "印尼语",
]
