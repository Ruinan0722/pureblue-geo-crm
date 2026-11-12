import type { GeoFormData } from "@/modules/intake"
import type { RequestRecord } from "./types"

// 状态机/常量唯一权威源：geo-api/app/modules/contracts/status_catalog.py
import {
  REQUEST_GEO_SOURCE_META,
  type RequestGeoSource,
} from "@/modules/crm/lib/status-catalog.generated"

export { REQUEST_GEO_SOURCE_META }
export type { RequestGeoSource }

/** 飞书来源名 → 枚举（由 catalog 的 feishuSource 派生，禁止手写） */
const SOURCE_BY_FEISHU: Record<string, RequestGeoSource> = Object.fromEntries(
  (Object.keys(REQUEST_GEO_SOURCE_META) as RequestGeoSource[])
    .map((code) => [REQUEST_GEO_SOURCE_META[code].feishuSource, code] as const)
    .filter(([name]) => name),
)

export function requestImportSource(data: GeoFormData | Record<string, unknown> | null | undefined): string {
  if (!data || typeof data !== "object") return ""
  const meta = (data as { importMeta?: { source?: unknown } }).importMeta
  return typeof meta?.source === "string" ? meta.source.trim() : ""
}

export function resolveRequestGeoSource(
  record: Pick<RequestRecord, "code" | "data"> | null | undefined,
): RequestGeoSource {
  if (!record) return "manual"
  const fromMeta = SOURCE_BY_FEISHU[requestImportSource(record.data)]
  if (fromMeta) return fromMeta
  const code = (record.code || "").toUpperCase()
  if (code.startsWith("GEO-CN")) return "domestic"
  if (code.startsWith("GEO-OV")) return "overseas"
  if (code.startsWith("GEO-MS")) return "mestbo"
  return "manual"
}
