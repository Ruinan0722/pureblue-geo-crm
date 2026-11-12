/**
 * ISO 3166-1 alpha-2 国家/地区与 ISO 639-1 语言码。
 * 用 Intl.DisplayNames 探测有效码；特殊 GEO 区域单独追加。
 *
 * 注意：中东使用 MENA（勿用 ME，ME 是黑山 ISO 码）。
 * 不再提供「东南亚」泛指，需选择具体国家（如 SG/MY/TH/VN/ID/PH）。
 */

/** GEO 特殊区域（非 ISO）；不含东南亚等泛指 */
const SPECIAL_REGION_CODES = ["MENA"] as const

/** 过时 / 别名地区码 → 优先保留的现行码（同名去重） */
const OBSOLETE_REGION_CODES = new Set([
  "UK", // → GB
  "ME", // ISO 黑山；产品内「中东」使用 MENA，避免同码冲突
  "DD", // 东德 → DE
  "FX", // 法国本土 → FR
  "VD", // 北越 → VN
  "AN", // 荷属安的列斯 → CW 等
  "HV", // 上沃尔特 → BF
  "DY", // 达荷美 → BJ
  "BU", // 缅甸旧码 → MM
  "ZR", // 扎伊尔 → CD
  "CS", // 塞尔维亚和黑山 → RS
  "YU", // 南斯拉夫 → RS
  "NH", // 新赫布里底 → VU
  "RH", // 罗得西亚 → ZW
  "SU", // 苏联 → RU
  "TP", // 东帝汶旧码 → TL
  "YD", // 南也门 → YE
  "HK", // 产品不提供香港作为独立目标市场
  "TW", // 产品不提供台湾作为独立目标市场
])

/** 过时 / 别名语言码 */
const OBSOLETE_LANGUAGE_CODES = new Set([
  "in", // → id
  "iw", // → he
  "ji", // → yi
  "jw", // → jv
  "mo", // → ro
  "tw", // 与 ak 同名「阿肯语」，保留 ak
])

/** 常用目标市场置顶，便于快速选择 */
const PINNED_COUNTRY_CODES = [
  "US",
  "GB",
  "CA",
  "AU",
  "DE",
  "FR",
  "JP",
  "KR",
  "SG",
  "MY",
  "TH",
  "VN",
  "ID",
  "PH",
  "IN",
  "AE",
  "SA",
  "BR",
  "MX",
  "ES",
  "IT",
  "NL",
  "SE",
  "CH",
  "CN",
] as const

const PINNED_LANGUAGE_CODES = [
  "en",
  "zh",
  "es",
  "fr",
  "de",
  "ja",
  "ko",
  "pt",
  "ar",
  "ms",
  "th",
  "vi",
  "id",
  "hi",
  "ru",
  "it",
  "nl",
  "tr",
] as const

function discoverRegionCodes(): string[] {
  const dn = new Intl.DisplayNames(["en"], { type: "region" })
  const codes: string[] = []
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b)
      if (OBSOLETE_REGION_CODES.has(code)) continue
      const name = dn.of(code)
      if (name && name !== code) codes.push(code)
    }
  }
  return dedupeByLabel(codes, (code) => {
    try {
      return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code
    } catch {
      return code
    }
  })
}

function discoverLanguageCodes(): string[] {
  const dn = new Intl.DisplayNames(["en"], { type: "language" })
  const codes: string[] = []
  for (let a = 97; a <= 122; a++) {
    for (let b = 97; b <= 122; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b)
      if (OBSOLETE_LANGUAGE_CODES.has(code)) continue
      const name = dn.of(code)
      if (name && name !== code) codes.push(code)
    }
  }
  return dedupeByLabel(codes, (code) => {
    try {
      return new Intl.DisplayNames(["zh-CN"], { type: "language" }).of(code) ?? code
    } catch {
      return code
    }
  })
}

/** 同名只保留首次出现（配合置顶 / 字母序，优先现行码） */
function dedupeByLabel(codes: string[], labelOf: (code: string) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const code of codes) {
    const label = labelOf(code)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(code)
  }
  return out
}

function pinFirst(all: string[], pinned: readonly string[]): string[] {
  const set = new Set(all)
  const head = pinned.filter((c) => set.has(c))
  const headSet = new Set(head)
  const rest = all.filter((c) => !headSet.has(c)).sort()
  return [...head, ...rest]
}

const ISO_COUNTRY_CODES = discoverRegionCodes()
const ISO_LANGUAGE_CODES = discoverLanguageCodes()

/** 全部可选国家/地区码（含 MENA；已去重，不含东南亚泛指） */
export const ALL_COUNTRY_CODES: string[] = [
  ...SPECIAL_REGION_CODES,
  ...pinFirst(ISO_COUNTRY_CODES, PINNED_COUNTRY_CODES),
]

/** 全部可选语言码（已去重） */
export const ALL_LANGUAGE_CODES: string[] = pinFirst(ISO_LANGUAGE_CODES, PINNED_LANGUAGE_CODES)

const COUNTRY_CODE_SET = new Set(ALL_COUNTRY_CODES)
const LANGUAGE_CODE_SET = new Set(ALL_LANGUAGE_CODES)

export function isKnownCountryCode(code: string): boolean {
  return COUNTRY_CODE_SET.has(code)
}

export function isKnownLanguageCode(code: string): boolean {
  return LANGUAGE_CODE_SET.has(code)
}

export function displayCountryName(code: string, locale: string): string {
  if (!code) return ""
  if (code === "SEA") return locale.startsWith("zh") ? "东南亚" : "Southeast Asia"
  // MENA = 中东；历史草稿 ME 也曾表示中东（非黑山）
  if (code === "MENA" || code === "ME") {
    return locale.startsWith("zh") ? "中东" : "Middle East"
  }
  if (code === "UK") return displayCountryName("GB", locale)
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

export function displayLanguageName(code: string, locale: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}
