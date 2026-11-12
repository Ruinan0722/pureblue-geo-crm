/** 需求管理：读写 geo-api / MySQL。 */
import type { RequestStatus } from "@/modules/requests/lib/status"
import type { RequestRecord } from "@/modules/requests/lib/types"
import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"

export type RequestStats = {
  total: number
  submitted: number
  pending: number
  confirmed: number
  inProject: number
  supplement: number
}

export const EMPTY_REQUEST_STATS: RequestStats = {
  total: 0,
  submitted: 0,
  pending: 0,
  confirmed: 0,
  inProject: 0,
  supplement: 0,
}

export type RequestListFilters = {
  keyword?: string
  status?: RequestStatus | "all"
  geoSource?: "domestic" | "overseas" | "mestbo" | "manual" | "all"
  region?: string
  goal?: string
  submittedFrom?: string
  submittedTo?: string
  mineOnly?: boolean
  page?: number
  pageSize?: number
}

export type RequestListResult = {
  items: RequestRecord[]
  total: number
  page: number
  pageSize: number
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

async function requestJson<T>(url: string, init?: RequestInit, fallback = "请求失败"): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(await readError(res, fallback))
  return res.json() as Promise<T>
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return fallback
    }
  }
  return fallback
}

export function exportTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 批量导出 Excel：服务端生成 1 个 .xlsx（校验权限与数据范围），返回下载文件名。 */
export async function exportRequestsExcel(ids: string[]): Promise<string> {
  if (ids.length === 0) throw new Error("请先勾选需要导出的需求")

  const excelRes = await fetch("/api/requests/export/excel", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  if (!excelRes.ok) throw new Error(await readError(excelRes, "导出 Excel 失败"))
  const excelBlob = await excelRes.blob()
  const excelName = filenameFromDisposition(
    excelRes.headers.get("Content-Disposition"),
    `需求导出-${exportTimestamp()}.xlsx`,
  )
  triggerBlobDownload(excelBlob, excelName)
  return excelName
}

function buildQuery(filters: RequestListFilters = {}): string {
  const params = new URLSearchParams()
  const entries: [string, string | undefined][] = [
    ["keyword", filters.keyword],
    ["status", filters.status && filters.status !== "all" ? filters.status : undefined],
    ["geoSource", filters.geoSource && filters.geoSource !== "all" ? filters.geoSource : undefined],
    ["region", filters.region],
    ["goal", filters.goal],
    ["submittedFrom", filters.submittedFrom],
    ["submittedTo", filters.submittedTo],
    ["mineOnly", filters.mineOnly ? "true" : undefined],
    ["page", filters.page != null ? String(filters.page) : undefined],
    ["pageSize", filters.pageSize != null ? String(filters.pageSize) : undefined],
  ]
  for (const [key, value] of entries) {
    const trimmed = (value || "").trim()
    if (trimmed) params.set(key, trimmed)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export async function fetchRequests(filters: RequestListFilters = {}): Promise<RequestListResult> {
  const data = await requestJson<
    (RequestListResult & { page_size?: number; in_project?: number }) | RequestRecord[]
  >(`/api/requests${buildQuery(filters)}`, undefined, "加载需求列表失败")
  if (Array.isArray(data)) {
    return {
      items: data,
      total: data.length,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? data.length,
    }
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total ?? 0),
    page: Number(data.page ?? filters.page ?? 1),
    pageSize: Number(data.pageSize ?? data.page_size ?? filters.pageSize ?? 10),
  }
}

export async function fetchRequestById(id: string): Promise<RequestRecord> {
  return requestJson<RequestRecord>(
    `/api/requests/${encodeURIComponent(id)}`,
    undefined,
    "加载需求详情失败",
  )
}

export async function fetchRequestStats(opts?: { mineOnly?: boolean }): Promise<RequestStats> {
  const qs = opts?.mineOnly ? "?mineOnly=true" : ""
  const data = await requestJson<RequestStats & Record<string, number>>(
    `/api/requests/stats${qs}`,
    undefined,
    "加载需求统计失败",
  )
  return {
    total: Number(data.total ?? 0),
    submitted: Number(data.submitted ?? 0),
    pending: Number(data.pending ?? 0),
    confirmed: Number(data.confirmed ?? 0),
    inProject: Number(data.inProject ?? data.in_project ?? 0),
    supplement: Number(data.supplement ?? 0),
  }
}

export async function patchRequestDocument(
  id: string,
  body: Record<string, unknown>,
): Promise<RequestRecord> {
  return requestJson<RequestRecord>(
    `/api/requests/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    "操作失败",
  )
}


