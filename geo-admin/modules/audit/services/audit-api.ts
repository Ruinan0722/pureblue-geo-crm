/** CRM 操作审计：读写 geo-api / MySQL（替代 localStorage）。 */

import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import type { AuditChange, AuditModule, AuditRecord } from "@/modules/audit/context/audit-provider"

export type AuditInput = {
  module: AuditModule
  entityType: string
  entityId: string
  relatedEntityIds?: string[]
  entityName: string
  action: string
  changes: AuditChange[]
  /** 迁移旧数据时可带上 */
  id?: string
  actor?: string
  timestamp?: string
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

function normalizeRecord(raw: Record<string, unknown>): AuditRecord {
  const changesRaw = Array.isArray(raw.changes) ? raw.changes : []
  const originRaw = String(raw.origin || "").trim()
  return {
    id: String(raw.id || ""),
    module: String(raw.module || "") as AuditModule,
    entityType: String(raw.entityType ?? raw.entity_type ?? ""),
    entityId: String(raw.entityId ?? raw.entity_id ?? ""),
    relatedEntityIds: Array.isArray(raw.relatedEntityIds)
      ? (raw.relatedEntityIds as string[])
      : Array.isArray(raw.related_entity_ids)
        ? (raw.related_entity_ids as string[])
        : undefined,
    entityName: String(raw.entityName ?? raw.entity_name ?? ""),
    action: String(raw.action || ""),
    actor: String(raw.actor || ""),
    timestamp: String(raw.timestamp || ""),
    origin: originRaw === "lead" || originRaw === "request" ? originRaw : undefined,
    changes: changesRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        field: String(item.field || ""),
        label: String(item.label || ""),
        before: String(item.before || ""),
        after: String(item.after || ""),
      })),
  }
}

export async function fetchAuditRecords(options?: {
  entityId?: string
  module?: string
  limit?: number
}): Promise<AuditRecord[]> {
  const params = new URLSearchParams()
  if (options?.entityId) params.set("entityId", options.entityId)
  if (options?.module) params.set("module", options.module)
  if (options?.limit) params.set("limit", String(options.limit))
  const qs = params.toString()
  const res = await fetch(`/api/crm/audit${qs ? `?${qs}` : ""}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) throw new Error(await readError(res, "加载操作历史失败"))
  const data = (await res.json()) as { items?: unknown[] }
  const items = Array.isArray(data.items) ? data.items : []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map(normalizeRecord)
}

export async function createAuditRecord(input: AuditInput): Promise<AuditRecord> {
  const res = await fetch("/api/crm/audit", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      relatedEntityIds: input.relatedEntityIds,
      entityName: input.entityName,
      action: input.action,
      changes: input.changes,
      id: input.id,
      actor: input.actor,
      timestamp: input.timestamp,
    }),
  })
  if (!res.ok) throw new Error(await readError(res, "写入操作历史失败"))
  const data = (await res.json()) as Record<string, unknown>
  return normalizeRecord(data)
}
