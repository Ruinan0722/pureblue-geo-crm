"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, FileUp, Loader2, Plus, Search, Settings2, UserCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { DateRangePicker } from "@/shared/ui/date-range-picker"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { canDo } from "@/modules/auth/lib/permissions"
import {
  LEAD_LEVEL_UNSET,
  LEAD_LEVELS,
  REGIONS,
  leadLevelLabel,
  leadStatusMeta,
  type LeadStatus,
  normalizeLeadSource,
} from "@/modules/crm/lib/crm-data"

import { Pill, StatCards, FilterSelect, FilterField, FilterGrid, EmptyState } from "@/modules/crm/components/ui"
import { ConvertLeadDialog, LeadFormDialog } from "@/modules/crm/components/lead-actions"
import { LeadSourceOptionsDialog } from "@/modules/crm/components/lead-source-options-dialog"
import { LeadSourceFilter } from "@/modules/crm/components/lead-source-filter"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { hasPermission } from "@/modules/auth/lib/permissions"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import type { LeadListFilters } from "@/modules/crm/services/crm-api"
import type { Lead } from "@/modules/crm/lib/crm-data"
import { cn } from "@/shared/lib/utils"
import { DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"

const LEVEL_TONE: Record<string, string> = { A: "success", B: "info", C: "warning", D: "neutral" }
const LEVEL_FILTER_OPTIONS = [
  { value: LEAD_LEVEL_UNSET, label: "未评级" },
  ...LEAD_LEVELS.map((l) => ({ value: l, label: leadLevelLabel(l) })),
]
const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

type LeadSortKey =
  | "createdAt"
  | "firstContactDate"
  | "name"
  | "contact"
  | "region"
  | "source"
  | "sourceDetail"
  | "level"
  | "sdr"
  | "sales"
  | "status"

/** 筛选条件与下方表头字段对齐；查询时传给后端。下拉字段为多选数组（空=全部） */
type LeadQuery = {
  createdFrom: string
  createdTo: string
  firstContactFrom: string
  firstContactTo: string
  transferFrom: string
  transferTo: string
  name: string
  contactName: string
  region: string[]
  source: string[]
  sourceDetail: string[]
  level: string[]
  sdr: string
  sales: string
  status: LeadStatus[]
}

const EMPTY_QUERY: LeadQuery = {
  createdFrom: "",
  createdTo: "",
  firstContactFrom: "",
  firstContactTo: "",
  transferFrom: "",
  transferTo: "",
  name: "",
  contactName: "",
  region: [],
  source: [],
  sourceDetail: [],
  level: [],
  sdr: "",
  sales: "",
  status: [],
}

function joinCsv(values: unknown): string | undefined {
  const cleaned = (Array.isArray(values) ? values : coerceMulti(values))
    .map((v) => String(v).trim())
    .filter((v) => v && v !== "all")
  return cleaned.length ? cleaned.join(",") : undefined
}

/** 兼容旧 sessionStorage：单值 / "all" / 逗号串 → 数组 */
function coerceMulti(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter((v) => v && v !== "all")
  }
  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t || t === "all") return []
    return t
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((v) => v && v !== "all")
  }
  return []
}

function normalizeLeadQuery(raw: Partial<LeadQuery> | Record<string, unknown> | null | undefined): LeadQuery {
  const q = { ...EMPTY_QUERY, ...(raw || {}) }
  return {
    ...q,
    region: coerceMulti(q.region),
    source: coerceMulti(q.source),
    sourceDetail: coerceMulti(q.sourceDetail),
    level: coerceMulti(q.level),
    status: coerceMulti(q.status) as LeadStatus[],
  }
}

function leadDisplayName(companyName: string, brandName?: string) {
  const brand = (brandName || "").trim()
  const company = (companyName || "").trim()
  return brand || company || "—"
}

function toApiFilters(query: LeadQuery, page: number): LeadListFilters {
  const q = normalizeLeadQuery(query)
  return {
    name: q.name,
    contactName: q.contactName,
    sdr: q.sdr,
    sales: q.sales,
    status: joinCsv(q.status),
    source: joinCsv(q.source),
    sourceDetail: joinCsv(q.sourceDetail),
    level: joinCsv(q.level),
    region: joinCsv(q.region),
    createdFrom: q.createdFrom,
    createdTo: q.createdTo,
    firstContactFrom: q.firstContactFrom,
    firstContactTo: q.firstContactTo,
    transferFrom: q.transferFrom,
    transferTo: q.transferTo,
    page,
    pageSize: PAGE_SIZE,
  }
}

export function LeadList() {
  const router = useRouter()
  const { leads, leadStats, leadListTotal, leadsListLoading, searchLeads, refreshLeadStats, createLead } = useCrm()
  const { user } = useAuth()
  const permissions = user?.permissions ?? []
  const canCreateLead = canDo(permissions, "leads:create", "leads:write")
  const canConvertLead = canDo(permissions, "leads:convert", "leads:write")
  const canManageSourceOptions = hasPermission(user?.permissions ?? [], "lead_source_options:manage")
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied(
    `crm:leads-list-v2:${user?.id || user?.name || "anonymous"}`,
    EMPTY_QUERY,
  )
  // 渲染期兜底：旧缓存可能把多选字段存成字符串
  const draftRegion = coerceMulti(draft.region)
  const draftSource = coerceMulti(draft.source)
  const draftSourceDetail = coerceMulti(draft.sourceDetail)
  const draftLevel = coerceMulti(draft.level)
  const draftStatus = coerceMulti(draft.status) as LeadStatus[]
  const [convertId, setConvertId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [sourceOptionsOpen, setSourceOptionsOpen] = useState(false)
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)
  const [bulkUploading, setBulkUploading] = useState(false)
  const { sort, toggleSort } = useTableSort<LeadSortKey>()

  const totalPages = Math.max(1, Math.ceil(leadListTotal / PAGE_SIZE))
  const currentPage = Math.min(applied.page, totalPages)

  useEffect(() => {
    if (!listStateReady) return
    let cancelled = false
    void searchLeads(toApiFilters(applied.query, applied.page))
      .then((result) => {
        if (cancelled) return
        const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        // 筛选后总页数变少时，自动回落到合法页，避免空表
        if (applied.page > pages) {
          setApplied((prev) => ({ ...prev, page: pages }))
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "加载线索列表失败")
        }
      })
    return () => {
      cancelled = true
    }
  }, [applied, searchLeads, listStateReady, setApplied])

  const sorted = useMemo(
    () =>
      sortRows(leads, sort, {
        createdAt: (l) => l.createdAt || "",
        firstContactDate: (l) => l.firstContactDate,
        name: (l) => leadDisplayName(l.companyName, l.brandName),
        contact: (l) => `${l.contactName || ""}/${l.contactTitle || ""}`,
        region: (l) => `${l.region || ""}/${l.city || ""}`,
        source: (l) => l.source,
        sourceDetail: (l) => l.sourceDetail || "",
        level: (l) => l.level,
        sdr: (l) => l.sdr || "",
        sales: (l) => l.sales || "",
        status: (l) => l.status,
      }),
    [leads, sort],
  )

  function patchDraft<K extends keyof LeadQuery>(key: K, value: LeadQuery[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function handleSearch() {
    setApplied({ query: { ...draft }, page: 1 })
  }

  function handleReset() {
    setDraft(EMPTY_QUERY)
    setApplied({ query: EMPTY_QUERY, page: 1 })
  }

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === applied.page) return
    setApplied((prev) => ({ ...prev, page: next }))
  }

  async function reloadAfterMutation() {
    await Promise.all([
      searchLeads(toApiFilters(applied.query, applied.page)),
      refreshLeadStats().catch(() => undefined),
    ])
  }

  function downloadLeadTemplate() {
    const headers = ["公司名称", "品牌名称", "联系人", "联系人电话", "微信", "职位", "部门", "邮箱", "区域", "城市", "官网", "一级来源", "二级来源", "首次触达日期", "线索等级"]
    const example = ["示例公司", "示例品牌", "张三", "13800000000", "", "市场总监", "市场部", "zhangsan@example.com", "华东", "上海", "https://example.com", "官网", "", "2026-08-25", "A"]
    const csv = `\uFEFF${headers.join(",")}\n${example.join(",")}\n`
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "线索批量导入模板.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = [], cell = "", quoted = false
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i += 1 } else quoted = !quoted
      } else if ((ch === "," || ch === "\t") && !quoted) { row.push(cell.trim()); cell = "" }
      else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && text[i + 1] === "\n") i += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "" }
      else cell += ch
    }
    if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row) }
    return rows
  }

  async function importLeads(file: File) {
    setBulkUploading(true)
    try {
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""))
      if (rows.length < 2) throw new Error("文件至少需要一行表头和一行数据")
      const aliases: Record<string, keyof Lead> = {
        "公司名称": "companyName", "公司": "companyName", companyName: "companyName",
        "品牌名称": "brandName", brandName: "brandName", "联系人": "contactName", contactName: "contactName",
        "联系人电话": "contactPhone", "电话": "contactPhone", contactPhone: "contactPhone", "微信": "contactWechat", contactWechat: "contactWechat",
        "职位": "contactTitle", contactTitle: "contactTitle", "部门": "contactDepartment", contactDepartment: "contactDepartment", "邮箱": "email", email: "email",
        "区域": "region", region: "region", "城市": "city", city: "city", "官网": "website", website: "website",
        "一级来源": "source", source: "source", "二级来源": "sourceDetail", sourceDetail: "sourceDetail", "首次触达日期": "firstContactDate", firstContactDate: "firstContactDate", "线索等级": "level", level: "level",
      }
      const header = rows[0].map((x) => aliases[x] || "")
      if (!header.includes("companyName") || !header.includes("contactName")) throw new Error("表头必须包含“公司名称”和“联系人”")
      let success = 0, failed = 0
      for (const raw of rows.slice(1)) {
        const item: Partial<Lead> = {}
        header.forEach((key, i) => { if (key) (item as Record<string, string>)[key] = raw[i] || "" })
        if (!item.companyName?.trim() || !item.contactName?.trim() || (!item.contactPhone?.trim() && !item.contactWechat?.trim())) { failed += 1; continue }
        try { await createLead({ ...item, source: item.source || "其他", sales: "未分配" }); success += 1 } catch { failed += 1 }
      }
      await reloadAfterMutation()
      toast.success(`批量导入完成：成功 ${success} 条${failed ? `，失败 ${failed} 条（请检查必填字段）` : ""}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : "批量导入失败") }
    finally { setBulkUploading(false) }
  }


  return (
    <div className="space-y-3">
      <StatCards
        dense
        cols={6}
        items={[
          { label: "线索总数", value: leadStats.total },
          { label: "今日新增", value: leadStats.today, tone: "text-primary" },
          { label: "未触达", value: leadStats.untouched, tone: "text-amber-600" },
          { label: "已触达", value: leadStats.touched },
          { label: "已转客户", value: leadStats.converted, tone: "text-emerald-600" },
          { label: "无效线索", value: leadStats.invalid },
        ]}
      />

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <FilterGrid>
          <FilterField label="创建时间">
            <DateRangePicker
              from={draft.createdFrom}
              to={draft.createdTo}
              onChange={({ from, to }) =>
                setDraft((prev) => ({ ...prev, createdFrom: from, createdTo: to }))
              }
              placeholder="选择创建日期范围"
            />
          </FilterField>
          <FilterField label="首次触达">
            <DateRangePicker
              from={draft.firstContactFrom}
              to={draft.firstContactTo}
              onChange={({ from, to }) =>
                setDraft((prev) => ({ ...prev, firstContactFrom: from, firstContactTo: to }))
              }
              placeholder="选择触达日期范围"
            />
          </FilterField>
          <FilterField label="客户 / 品牌">
            <Input
              className="h-9"
              placeholder="公司名或品牌名"
              value={draft.name}
              onChange={(e) => patchDraft("name", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="联系人">
            <Input
              className="h-9"
              placeholder="请输入联系人"
              value={draft.contactName}
              onChange={(e) => patchDraft("contactName", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="区域">
            <FilterSelect
              multiple
              values={draftRegion}
              onValuesChange={(v) => patchDraft("region", v)}
              options={REGIONS.map((r) => ({ value: r, label: r }))}
              placeholder="全部区域（可多选）"
            />
          </FilterField>
          <FilterField label="来源">
            <LeadSourceFilter
              source={draftSource}
              sourceDetail={draftSourceDetail}
              onValuesChange={(source, sourceDetail) =>
                setDraft((prev) => ({ ...prev, source, sourceDetail }))
              }
            />
          </FilterField>
          <FilterField label="等级">
            <FilterSelect
              multiple
              values={draftLevel}
              onValuesChange={(v) => patchDraft("level", v)}
              options={LEVEL_FILTER_OPTIONS}
              placeholder="全部等级（可多选）"
            />
          </FilterField>
          <FilterField label="SDR">
            <Input
              className="h-9"
              placeholder="请输入 SDR"
              value={draft.sdr}
              onChange={(e) => patchDraft("sdr", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="分配销售">
            <Input
              className="h-9"
              placeholder="请输入销售"
              value={draft.sales}
              onChange={(e) => patchDraft("sales", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="状态">
            <FilterSelect
              multiple
              values={draftStatus}
              onValuesChange={(v) => patchDraft("status", v as LeadStatus[])}
              options={[
                { value: "untouched", label: "未触达" },
                { value: "touched", label: "已触达" },
                { value: "converted", label: "已转客户" },
                { value: "invalid", label: "无效线索" },
              ]}
              placeholder="全部状态（可多选）"
            />
          </FilterField>
          <FilterField label="转出时间">
            <DateRangePicker
              from={draft.transferFrom}
              to={draft.transferTo}
              onChange={({ from, to }) => setDraft((prev) => ({ ...prev, transferFrom: from, transferTo: to }))}
              placeholder="选择转出日期范围"
            />
          </FilterField>
        </FilterGrid>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {canManageSourceOptions && (
            <Button type="button" variant="outline" className="mr-auto gap-1.5" onClick={() => setSourceOptionsOpen(true)}>
              <Settings2 className="size-4" />
              维护二级来源
            </Button>
          )}
          {canCreateLead && (
            <Button type="button" className={canManageSourceOptions ? "gap-1.5" : "mr-auto gap-1.5"} onClick={() => setFormOpen(true)}>
              <Plus className="size-4" />
              新增线索
            </Button>
          )}
          {canCreateLead && (
            <>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => setBulkUploadOpen((open) => !open)}
                disabled={bulkUploading}
                aria-expanded={bulkUploadOpen}
              >
                <FileUp className="size-4" />{bulkUploading ? "导入中…" : "批量上传"}
              </Button>
              {bulkUploadOpen && (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-secondary/20 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">先下载模板填写，再上传 CSV / TSV 文件</span>
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={downloadLeadTemplate} disabled={bulkUploading}>
                    <Download className="size-4" />下载模板
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent/40">
                    <FileUp className="size-4" />选择文件
                    <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="sr-only" disabled={bulkUploading} onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) void importLeads(file) }} />
                  </label>
                </div>
              )}
            </>
          )}
          <Button type="button" variant="outline" onClick={handleReset} disabled={leadsListLoading}>
            重置
          </Button>
          <Button type="button" className="gap-1.5" onClick={handleSearch} disabled={leadsListLoading}>
            <Search className="size-4" />
            查询
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        {leadsListLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </div>
          </div>
        )}
        <TableCellTip>
        <div className={cn("overflow-x-auto", leadsListLoading && "pointer-events-none select-none")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                <SortableTh label="创建时间" sortKey="createdAt" sort={sort} onToggle={toggleSort} />
                <SortableTh label="首次触达" sortKey="firstContactDate" sort={sort} onToggle={toggleSort} />
                <SortableTh label="客户 / 品牌" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortableTh label="联系人" sortKey="contact" sort={sort} onToggle={toggleSort} />
                <SortableTh label="区域 / 城市" sortKey="region" sort={sort} onToggle={toggleSort} />
                <SortableTh label="一级来源" sortKey="source" sort={sort} onToggle={toggleSort} />
                <SortableTh label="二级来源" sortKey="sourceDetail" sort={sort} onToggle={toggleSort} />
                <SortableTh label="等级" sortKey="level" sort={sort} onToggle={toggleSort} />
                <SortableTh label="SDR" sortKey="sdr" sort={sort} onToggle={toggleSort} />
                <SortableTh label="销售" sortKey="sales" sort={sort} onToggle={toggleSort} />
                <SortableTh label="状态" sortKey="status" sort={sort} onToggle={toggleSort} />
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const title = leadDisplayName(l.companyName, l.brandName)
                const statusMeta = leadStatusMeta(l.status, l.leadType)
                return (
                  <tr
                    key={l.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/30"
                    onClick={() => router.push(`/leads/${l.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        router.push(`/leads/${l.id}`)
                      }
                    }}
                  >
                    <td className="max-w-0 truncate px-4 py-3 text-xs text-muted-foreground">
                      {l.createdAt || "—"}
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-xs text-muted-foreground">{l.firstContactDate || "—"}</td>
                    <td className="max-w-0 px-4 py-3">
                      <p className="truncate font-medium" title={[l.companyName, l.brandName].filter(Boolean).join(" / ") || undefined}>
                        <span>{l.companyName || title}</span>
                        {l.brandName && l.brandName !== l.companyName ? (
                          <span className="font-normal text-muted-foreground"> · {l.brandName}</span>
                        ) : null}
                      </p>
                    </td>
                    <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                      <span className="block truncate" title={l.contactName || undefined}>
                        {l.contactName || "—"}
                      </span>
                      {l.contactTitle ? (
                        <span className="block truncate text-[11px] text-muted-foreground/80" title={l.contactTitle}>
                          {l.contactTitle}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">
                      {l.region || "—"}
                      {l.city ? ` / ${l.city}` : ""}
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{normalizeLeadSource(l.source) || l.source || "—"}</td>
                    <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                      <span className="block truncate" title={l.sourceDetail || undefined}>
                        {l.sourceDetail || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill
                        label={leadLevelLabel(l.level || "")}
                        tone={l.level ? LEVEL_TONE[l.level] || "neutral" : "muted"}
                      />
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{l.sdr || "—"}</td>
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{l.sales || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill label={statusMeta.label} tone={statusMeta.tone} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <div className="flex flex-nowrap items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => router.push(`/leads/${l.id}`)}>
                          查看
                        </Button>
                        {canConvertLead && l.leadType !== "channel" && l.status !== "converted" && l.status !== "invalid" && (
                          <Button size="sm" className="gap-1" onClick={() => setConvertId(l.id)}>
                            <UserCheck className="size-3.5" />
                            生成客户
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </TableCellTip>
        {!leadsListLoading && sorted.length === 0 && <EmptyState text="没有符合条件的线索" />}
      </div>

      <ListPagination
        total={leadListTotal}
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={goToPage}
        loading={leadsListLoading}
      />

      {convertId && (
        <ConvertLeadDialog
          leadId={convertId}
          open={!!convertId}
          onOpenChange={(o) => {
            if (!o) {
              setConvertId(null)
              void reloadAfterMutation()
            }
          }}
        />
      )}
      {formOpen && (
        <LeadFormDialog
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) void reloadAfterMutation()
          }}
        />
      )}
      {sourceOptionsOpen && (
        <LeadSourceOptionsDialog open={sourceOptionsOpen} onOpenChange={setSourceOptionsOpen} />
      )}
    </div>
  )
}
