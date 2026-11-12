"use client"

import { useMemo, useState } from "react"
import { History, Search } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import {
  auditActionLabel,
  auditChangeValue,
  auditEntityTypeLabel,
  auditFieldLabel,
  auditModuleLabel,
  useAudit,
  type AuditModule,
} from "@/modules/audit/context/audit-provider"

const MODULES: Array<AuditModule | "全部"> = ["全部", "线索管理", "公海池", "客户管理", "商机管理", "合同管理", "需求管理", "项目", "系统设置"]

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

function visibleAuditChanges(record: { action: string; changes: Array<{ field: string; label: string; before: string; after: string }> }) {
  if (record.action !== "线索转为客户") return record.changes
  const kept = record.changes.filter((c) => {
    if (CONVERT_LEAD_HIDDEN_FIELDS.has((c.field || "").trim())) return false
    if (CONVERT_LEAD_HIDDEN_LABELS.has(auditFieldLabel(c.field, c.label).trim())) return false
    return true
  })
  return kept.length > 0 ? kept : [{ field: "customer", label: "客户档案", before: "—", after: "已生成" }]
}

export function AuditTrailButton() {
  const { records } = useAudit()
  const [open, setOpen] = useState(false)
  const [module, setModule] = useState<AuditModule | "全部">("全部")
  const [keyword, setKeyword] = useState("")

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return records.filter((record) => {
      const moduleMatch = module === "全部" || auditModuleLabel(record.module) === module
      const keywordMatch = !query || [record.entityName, record.actor, record.action, record.entityId].some((item) => item.toLowerCase().includes(query))
      return moduleMatch && keywordMatch
    })
  }, [records, module, keyword])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent"
      >
        <span className="flex items-center gap-2"><History className="size-4" />变更记录</span>
        {records.length > 0 && <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[11px]">{Math.min(records.length, 999)}</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>全平台变更记录</DialogTitle>
            <DialogDescription>记录操作人、操作时间及字段修改前后值。数据保存在服务器（MySQL），最近最多展示 500 条。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 border-b border-border px-6 py-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索对象、操作人或动作" />
            </div>
            <SearchableSelect
              value={module}
              onChange={(v) => setModule(v as AuditModule | "全部")}
              options={toSelectOptions(MODULES)}
              className="w-full sm:w-44"
              placeholder="筛选模块"
            />
          </div>
          <div className="max-h-[62vh] overflow-y-auto px-6 py-4">
            {filtered.length ? (
              <div className="space-y-3">
                {filtered.map((record) => (
                  <article key={record.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{auditModuleLabel(record.module)}</span>
                          <span className="text-sm font-semibold">{auditActionLabel(record.action)}</span>
                        </div>
                        <p className="mt-1 text-sm">{auditEntityTypeLabel(record.entityType)}：{record.entityName}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{record.entityId}</p>
                      </div>
                      <div className="text-xs text-muted-foreground sm:text-right"><p>{record.actor}</p><p>{record.timestamp}</p></div>
                    </div>
                    {visibleAuditChanges(record).length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-border text-xs">
                        {visibleAuditChanges(record).map((change, index) => (
                          <div key={`${change.field}-${index}`} className="grid grid-cols-[7rem_1fr] gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[8rem_1fr_1fr]">
                            <span className="font-medium">{auditFieldLabel(change.field, change.label)}</span>
                            <span className="break-words text-muted-foreground"><span className="sm:hidden">修改前：</span>{auditChangeValue(record.module, change, change.before)}</span>
                            <span className="col-start-2 break-words text-foreground sm:col-start-auto"><span className="sm:hidden">修改后：</span>{auditChangeValue(record.module, change, change.after)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无符合条件的变更记录</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
