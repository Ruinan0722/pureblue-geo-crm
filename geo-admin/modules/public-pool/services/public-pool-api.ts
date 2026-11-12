import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import type { PublicPoolClaim, PublicPoolItem, PublicPoolList, PublicPoolStats } from "@/modules/public-pool/types"

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}))
  return parseApiErrorMessage(body) || fallback
}

async function requestJson<T>(url: string, init?: RequestInit, fallback = "请求失败"): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(await readError(res, fallback))
  return res.json() as Promise<T>
}

export type PublicPoolFilters = {
  companyName?: string
  industry?: string
  region?: string
  source?: string
  status?: string
  page?: number
  pageSize?: number
}

export function fetchPublicPool(filters: PublicPoolFilters): Promise<PublicPoolList> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value))
  })
  return requestJson(`/api/public-pool?${params}`, undefined, "加载公海池失败")
}

export function fetchPublicPoolStats(): Promise<PublicPoolStats> {
  return requestJson("/api/public-pool/stats", undefined, "加载公海池统计失败")
}

export function fetchPublicPoolDetail(entryId: string): Promise<PublicPoolItem> {
  return requestJson(`/api/public-pool/${encodeURIComponent(entryId)}`, undefined, "加载公海客户详情失败")
}

export function applyPublicPoolClaim(entryId: string): Promise<PublicPoolClaim> {
  return requestJson(`/api/public-pool/${encodeURIComponent(entryId)}/claim`, { method: "POST" }, "提交认领申请失败")
}

export function reviewPublicPoolClaim(claimId: string, approved: boolean, reason: string): Promise<PublicPoolClaim> {
  return requestJson(`/api/public-pool/claims/${encodeURIComponent(claimId)}/review`, {
    method: "POST",
    body: JSON.stringify({ approved, reason }),
  }, "审核认领申请失败")
}
