import type { CheckinRecord, CheckinStats, CheckinType, CheckinUserBreakdown } from "./types"

export function filterCheckinRecords(
  records: CheckinRecord[],
  filters: { userIds: string[]; types: CheckinType[] },
): CheckinRecord[] {
  return records.filter((record) => {
    if (filters.userIds.length > 0 && !filters.userIds.includes(record.userId)) return false
    if (filters.types.length > 0 && !filters.types.includes(record.type)) return false
    return true
  })
}

export function computeCheckinStats(records: CheckinRecord[]): CheckinStats {
  let arriveCount = 0
  let leaveCount = 0
  const byUser = new Map<string, CheckinUserBreakdown>()

  for (const record of records) {
    if (record.type === "arrive") arriveCount += 1
    else leaveCount += 1

    const existing = byUser.get(record.userId)
    if (existing) {
      existing.count += 1
      if (record.type === "arrive") existing.arriveCount += 1
      else existing.leaveCount += 1
    } else {
      byUser.set(record.userId, {
        userId: record.userId,
        userName: record.userName,
        count: 1,
        arriveCount: record.type === "arrive" ? 1 : 0,
        leaveCount: record.type === "leave" ? 1 : 0,
      })
    }
  }

  const userBreakdown = [...byUser.values()].sort(
    (a, b) => b.count - a.count || a.userName.localeCompare(b.userName, "zh-CN"),
  )

  return {
    total: records.length,
    arriveCount,
    leaveCount,
    uniqueUsers: byUser.size,
    userBreakdown,
  }
}
