"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, History } from "lucide-react"
import { useAudit, type AuditRecord } from "@/modules/audit/context/audit-provider"
import {
  getCachedEntityAudits,
  loadEntityAudits,
  subscribeEntityAudits,
} from "@/modules/audit/lib/entity-audit-store"
import {
  auditActionLabel,
  auditChangeValue,
  auditFieldLabel,
} from "@/modules/audit/context/audit-provider"
import { Pill } from "@/modules/crm/components/ui"
import { cn } from "@/shared/lib/utils"

function matchesEntity(entityId: string, record: { entityId: string; relatedEntityIds?: string[] }) {
  return record.entityId === entityId || record.relatedEntityIds?.includes(entityId)
}

/** 「线索转为客户」历史脏字段：状态 / 客户 ID / 带入条数等不对外展示 */
const CONVERT_LEAD_HIDDEN_FIELDS = new Set([
  "status",
  "followState",
  "convertedCustomerId",
  "notes",
  "attachments",
])

const CONVERT_LEAD_HIDDEN_LABELS = new Set([
  "状态",
  "跟进状态",
  "生成客户 ID",
  "带入跟进条数",
  "带入附件数",
])

function visibleChanges(record: AuditRecord) {
  if (record.action !== "线索转为客户") return record.changes
  const kept = record.changes.filter((c) => {
    const field = (c.field || "").trim()
    const label = auditFieldLabel(c.field, c.label).trim()
    if (CONVERT_LEAD_HIDDEN_FIELDS.has(field)) return false
    if (CONVERT_LEAD_HIDDEN_LABELS.has(label)) return false
    return true
  })
  return kept.length > 0
    ? kept
    : [{ field: "customer", label: "客户档案", before: "—", after: "已生成" }]
}

function summarizeChanges(record: AuditRecord): string {
  const changes = visibleChanges(record).filter((c) => (c.label || c.field).trim())
  if (changes.length === 0) return "—"
  if (record.action === "线索转为客户") {
    const name = changes[0]?.after?.trim()
    return name && name !== "—" ? `已生成客户「${name}」` : "已生成客户档案"
  }
  if (changes.length === 1) {
    const c = changes[0]
    const label = auditFieldLabel(c.field, c.label || c.field)
    if (c.before === "—" || !c.before) {
      return `${label} → ${auditChangeValue(record.module, c, c.after) || "—"}`
    }
    return `${label}：${auditChangeValue(record.module, c, c.before) || "—"} → ${auditChangeValue(record.module, c, c.after) || "—"}`
  }
  const labels = changes.slice(0, 3).map((c) => auditFieldLabel(c.field, c.label || c.field)).filter(Boolean)
  const more = changes.length > 3 ? ` 等 ${changes.length} 项` : ""
  return `修改 ${labels.join("、")}${more}`
}

/**
 * 实体历史：以服务端列表为准（含线索带入），再用本地乐观记录按 id 合并。
 * Tab 角标与列表共用同一远程缓存，避免重复请求与数量不一致。
 */
function useEntityAudits(entityId: string): AuditRecord[] {
  const { records } = useAudit()
  const [remote, setRemote] = useState<AuditRecord[]>(() => getCachedEntityAudits(entityId) ?? [])

  useEffect(() => {
    setRemote(getCachedEntityAudits(entityId) ?? [])
    const unsub = subscribeEntityAudits(entityId, () => {
      setRemote(getCachedEntityAudits(entityId) ?? [])
    })
    void loadEntityAudits(entityId)
      .then((items) => setRemote(items))
      .catch(() => undefined)
    return unsub
  }, [entityId])

  return useMemo(() => {
    const byId = new Map<string, AuditRecord>()
    for (const item of remote) {
      byId.set(item.id, item)
    }
    for (const item of records) {
      if (!matchesEntity(entityId, item)) continue
      const prev = byId.get(item.id)
      byId.set(item.id, prev?.origin && !item.origin ? { ...item, origin: prev.origin } : item)
    }
    return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [remote, records, entityId])
}

function AuditEventCard({ record }: { record: AuditRecord }) {
  const fromLead = record.origin === "lead"
  const fromRequest = record.origin === "request"
  const changes = visibleChanges(record).filter((c) => (c.label || c.field || c.after || c.before).trim())
  const multi = changes.length > 1
  const [expanded, setExpanded] = useState(false)
  const convertLead = record.action === "线索转为客户"

  return (
    <article
      className={cn(
        "rounded-xl border border-border px-4 py-3",
        fromLead || fromRequest ? "border-amber-200/80 bg-amber-50/40" : "bg-card",
      )}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{auditActionLabel(record.action)}</span>
            {fromLead ? <Pill label="线索带入" tone="warning" /> : null}
            {fromRequest ? <Pill label="需求带入" tone="warning" /> : null}
            {multi && !convertLead ? (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {changes.length} 个字段
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{summarizeChanges(record)}</p>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
          <p className="font-medium text-foreground/80">{record.actor}</p>
          <p className="tabular-nums">{record.timestamp}</p>
        </div>
      </div>

      {multi && !convertLead ? (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            {expanded ? "收起明细" : "展开字段明细"}
          </button>
          {expanded ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background text-xs">
              <div className="grid grid-cols-[7rem_1fr_1fr] gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 font-medium text-muted-foreground">
                <span>字段</span>
                <span>修改前</span>
                <span>修改后</span>
              </div>
              {changes.map((change, index) => (
                <div
                  key={`${record.id}-${change.field}-${index}`}
                  className="grid grid-cols-[7rem_1fr_1fr] gap-2 border-b border-border px-3 py-2 last:border-0"
                >
                  <span className="font-medium text-foreground">{auditFieldLabel(change.field, change.label || change.field) || "—"}</span>
                  <span className="break-words text-muted-foreground">{auditChangeValue(record.module, change, change.before) || "—"}</span>
                  <span className="break-words text-foreground">{auditChangeValue(record.module, change, change.after) || "—"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function EntityAuditCount({ entityId, label = "历史操作记录" }: { entityId: string; label?: string }) {
  const items = useEntityAudits(entityId)
  return (
    <>
      {label} ({items.length})
    </>
  )
}

export function EntityAuditHistory({
  entityId,
  embedded = false,
  hint,
}: {
  entityId: string
  /** 置于 Tab 内时去掉外层大标题，避免与 Tab 文案重复 */
  embedded?: boolean
  /** Tab 内可选说明，与列表同列 flex，不破坏铺满滚动 */
  hint?: string
}) {
  const entityRecords = useEntityAudits(entityId)

  const listClassName = cn(
    "min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain pr-1",
    !embedded && "mt-4",
  )

  const body =
    entityRecords.length > 0 ? (
      <div className={listClassName}>
        {entityRecords.map((record) => (
          <AuditEventCard key={record.id} record={record} />
        ))}
      </div>
    ) : (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground",
          !embedded && "mt-4",
        )}
      >
        暂无历史操作记录
      </div>
    )

  if (embedded) {
    return (
      <section
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card p-5"
        aria-label="历史操作记录"
      >
        {hint ? <p className="mb-3 shrink-0 text-xs text-muted-foreground">{hint}</p> : null}
        {body}
      </section>
    )
  }

  return (
    <section
      className="flex h-[calc(100dvh-12rem)] min-h-[20rem] flex-col overflow-hidden rounded-2xl border border-border bg-card p-5"
      aria-label="历史操作记录"
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-primary" />
            历史操作记录
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            按每次操作汇总展示；多字段变更可展开查看明细。线索转客户带入的记录会标注「线索带入」。
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
          {entityRecords.length} 次
        </span>
      </div>
      {body}
    </section>
  )
}
