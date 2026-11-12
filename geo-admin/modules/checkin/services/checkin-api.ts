import type { CheckinListFilters, CheckinRecord, CheckinStats, CreateCheckinInput } from "../lib/types"

function buildQuery(filters: CheckinListFilters = {}): string {
  const params = new URLSearchParams()
  if (filters.scope) params.set("scope", filters.scope)
  if (filters.userId) params.set("userId", filters.userId)
  if (filters.type) params.set("type", filters.type)
  if (filters.from !== undefined) params.set("from", String(filters.from))
  if (filters.to !== undefined) params.set("to", String(filters.to))
  const query = params.toString()
  return query ? `?${query}` : ""
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string | { msg?: string }[] }
  if (typeof data.error === "string" && data.error) return data.error
  if (typeof data.detail === "string" && data.detail) return data.detail
  if (Array.isArray(data.detail) && data.detail[0]?.msg) return String(data.detail[0].msg)
  return fallback
}

export async function fetchCheckinRecords(filters: CheckinListFilters = {}): Promise<CheckinRecord[]> {
  const res = await fetch(`/api/checkin${buildQuery(filters)}`, { credentials: "include", cache: "no-store" })
  if (!res.ok) {
    throw new Error(await readApiError(res, "获取打卡记录失败"))
  }
  return res.json() as Promise<CheckinRecord[]>
}

export async function fetchActiveVisitId(): Promise<string | null> {
  const res = await fetch("/api/checkin/active-visit", { credentials: "include", cache: "no-store" })
  if (!res.ok) {
    throw new Error(await readApiError(res, "获取进行中拜访失败"))
  }
  const data = (await res.json()) as { activeVisitId?: string | null }
  return data.activeVisitId ?? null
}

export async function fetchCheckinStats(filters: CheckinListFilters = {}): Promise<CheckinStats> {
  const res = await fetch(`/api/checkin/stats${buildQuery(filters)}`, { credentials: "include", cache: "no-store" })
  if (!res.ok) {
    throw new Error(await readApiError(res, "获取打卡统计失败"))
  }
  return res.json() as Promise<CheckinStats>
}

export async function createCheckinRecord(input: CreateCheckinInput): Promise<CheckinRecord> {
  const res = await fetch("/api/checkin", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(await readApiError(res, "保存打卡记录失败"))
  }
  return res.json() as Promise<CheckinRecord>
}

export function dateToStartTimestamp(date: string): number {
  return new Date(`${date}T00:00:00+08:00`).getTime()
}

export function dateToEndTimestamp(date: string): number {
  return new Date(`${date}T23:59:59.999+08:00`).getTime()
}
