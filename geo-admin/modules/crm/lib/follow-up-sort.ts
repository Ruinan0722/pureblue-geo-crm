/**
 * 将 CRM 跟进时间规范为可比较时间戳。
 * 明确解析系统支持的格式，避免浏览器对 `YYYY-MM-DD HH:mm:ss` 的差异行为。
 */
function followUpTimestamp(value: unknown): number | null {
  const text = String(value ?? "").trim()
  const match = text.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  )
  if (!match) return null

  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y, m, d, h, min, s] = parts
  const timestamp = new Date(y, m - 1, d, h, min, s).getTime()
  const parsed = new Date(timestamp)
  if (
    Number.isNaN(timestamp) ||
    parsed.getFullYear() !== y ||
    parsed.getMonth() !== m - 1 ||
    parsed.getDate() !== d ||
    parsed.getHours() !== h ||
    parsed.getMinutes() !== min ||
    parsed.getSeconds() !== s
  ) {
    return null
  }
  return timestamp
}

/** 按实际跟进时间全局倒序；来源和对接池不参与排序，id 用作稳定兜底。 */
export function sortFollowUpsNewestFirst<T extends { id: string; date: string }>(records: readonly T[]): T[] {
  return records
    .map((record, index) => ({ record, index, timestamp: followUpTimestamp(record.date) }))
    .sort((a, b) => {
      if (a.timestamp !== null && b.timestamp !== null) {
        const byTime = b.timestamp - a.timestamp
        if (byTime !== 0) return byTime
        const byId = b.record.id.localeCompare(a.record.id)
        return byId !== 0 ? byId : a.index - b.index
      }
      if (a.timestamp !== null) return -1
      if (b.timestamp !== null) return 1
      const byId = b.record.id.localeCompare(a.record.id)
      return byId !== 0 ? byId : a.index - b.index
    })
    .map(({ record }) => record)
}
