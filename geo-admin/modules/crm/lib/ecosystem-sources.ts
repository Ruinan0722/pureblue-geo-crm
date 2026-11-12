export const ECOSYSTEM_SOURCES: Record<string, readonly string[]> = {
  "KA客户": [],
  "阿里集团": ["天猫", "天猫国际", "淘宝", "高德", "汇川"],
  "蓝色光标": ["多盟", "上海蓝标"],
  "新华网": [],
  "其他渠道": ["36氪", "知乎", "瀚海"],
}

const hasSource = (key: string) => Object.hasOwn(ECOSYSTEM_SOURCES, key)
export function ecosystemSource(source?: string | null, detail?: string | null) {
  if (source && hasSource(source)) return { source, sourceDetail: detail || "" }
  if (source === "战略生态" && detail) {
    const [first, ...rest] = detail.split(" / ")
    const primary = first === "新华网渠道" ? "新华网" : first
    if (hasSource(primary)) return { source: primary, sourceDetail: rest.join(" / ") }
  }
  return { source: "", sourceDetail: [source === "战略生态" ? "" : source, detail].filter(Boolean).join(" / ") }
}
export function ecosystemSourceLabel(source?: string | null, detail?: string | null) {
  const normalized = ecosystemSource(source, detail)
  return [normalized.source, normalized.sourceDetail].filter(Boolean).join(" / ")
}
