const CHINA_TZ = "Asia/Shanghai"

/** Docker 容器未设 TZ 时，修复前写入的 UTC 时间戳截止点（对应北京时间 2026-7-8 19:51） */
export const UTC_BUG_FIX_CUTOFF_MS = Date.parse("2026-07-08T11:51:00.000Z")

function padStoredDatetime(raw: string): string {
  return raw
    .replace(" ", "T")
    .replace(/-(\d)\b/g, "-0$1")
    .replace(/-(\d)T/, "-0$1T")
}

/** 带「时:分:秒」的时间字符串（服务器 UTC 错误写入期的特征） */
export function hasStoredSeconds(raw: string): boolean {
  return /\d{1,2}:\d{2}:\d{2}$/.test(raw.trim())
}

/** 将库内 naive 字符串按 UTC 解析（修复前服务器实际写入的是 UTC） */
export function parseStoredAsUtcMs(raw: string): number | null {
  if (!raw || raw === "—") return null
  const ts = Date.parse(`${padStoredDatetime(raw)}Z`)
  return Number.isNaN(ts) ? null : ts
}

/** 修复前误存为 UTC 的时间 → 中国时区展示字符串 */
export function normalizeStoredDatetime(raw: string): string {
  if (!raw || raw === "—" || !hasStoredSeconds(raw)) return raw
  const utcMs = parseStoredAsUtcMs(raw)
  if (utcMs == null || utcMs >= UTC_BUG_FIX_CUTOFF_MS) return raw
  return formatChinaDatetime(new Date(utcMs))
}

/** 与历史库表兼容的中国时区时间字符串，例如 2026-7-8 19:51:29 */
export function formatChinaDatetime(date: Date = new Date()): string {
  return date
    .toLocaleString("zh-CN", {
      hour12: false,
      timeZone: CHINA_TZ,
    })
    .replace(/\//g, "-")
}

/** 中国时区自然日 YYYY-MM-DD（用于「今日新增」等按日统计） */
export function chinaDateISO(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const y = parts.find((p) => p.type === "year")?.value ?? "0000"
  const m = parts.find((p) => p.type === "month")?.value ?? "01"
  const d = parts.find((p) => p.type === "day")?.value ?? "01"
  return `${y}-${m}-${d}`
}

/** 需求编号日期段：GEO-YYYYMMDD-XXXX（中国时区自然日） */
export function chinaDateStamp(date: Date = new Date()): string {
  return chinaDateISO(date).replace(/-/g, "")
}
