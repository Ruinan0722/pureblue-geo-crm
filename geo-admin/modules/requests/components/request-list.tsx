"use client"

import { useAuth } from "@/modules/auth"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import { FilterField,FilterGrid,FilterSelect } from "@/modules/crm/components/ui"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import {
COUNTRY_OPTIONS,
displayCountryName,
DOMESTIC_OPTIMIZATION_GOALS,
OPTIMIZATION_GOALS,
regionLabel,
requestGoalLabel,
} from "@/modules/intake"
import { GeoSourceBadge } from "@/modules/requests/components/geo-source-badge"
import { StatusBadge } from "@/modules/requests/components/status-badge"
import { exportMergedPdfFromTemplates } from "@/modules/requests/export/export-pdf-html"
import { formatRequestOwner } from "@/modules/requests/lib/format-owner"
import { REQUEST_GEO_SOURCE_META } from "@/modules/requests/lib/geo-source"
import type { RequestListFilters } from "@/modules/requests/services/requests-api"
import {
exportRequestsExcel,
exportTimestamp,
fetchRequestStats,
type RequestStats,
} from "@/modules/requests/services/requests-api"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"
import { DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"
import { SortableTh,sortRows,useTableSort } from "@/shared/lib/table-sort"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { DateRangePicker } from "@/shared/ui/date-range-picker"
import { Input } from "@/shared/ui/input"
import { ListPagination } from "@/shared/ui/list-pagination"
import {
ArrowRight,
Download,
Search,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect,useMemo,useState } from "react"
import { toast } from "sonner"
import { useRequests } from "../context/requests-provider"
import type { RequestStatus } from "../lib/status"
import { STATUS_ACTIONS,STATUS_META } from "../lib/status"

const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

const STATUS_FILTERS: { value: RequestStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "submitted", label: STATUS_META.submitted.label },
  { value: "pending_review", label: STATUS_META.pending_review.label },
  { value: "confirmed", label: STATUS_META.confirmed.label },
  { value: "in_project", label: STATUS_META.in_project.label },
]

/** 销售等非海外角色可同时跟国内/海外；列表提供切换。海外运营由服务端强制 overseas，不展示。 */
const GEO_SOURCE_FILTERS: { value: "all" | "domestic" | "overseas"; label: string }[] = [
  { value: "all", label: "全部来源" },
  { value: "domestic", label: REQUEST_GEO_SOURCE_META.domestic.label },
  { value: "overseas", label: REQUEST_GEO_SOURCE_META.overseas.label },
]

type RequestSortKey = "code" | "company" | "region" | "goal" | "status" | "owner" | "submittedAt"

type RequestQuery = {
  keyword: string
  status: RequestStatus | "all"
  geoSource: "all" | "domestic" | "overseas"
  region: string
  goal: string
  submittedFrom: string
  submittedTo: string
}

const EMPTY_QUERY: RequestQuery = {
  keyword: "",
  status: "all",
  geoSource: "all",
  region: "all",
  goal: "all",
  submittedFrom: "",
  submittedTo: "",
}

const COUNTRY_FILTER_OPTIONS = COUNTRY_OPTIONS.map((code) => ({
  value: code,
  label: displayCountryName(code, "zh-CN"),
}))

const GOAL_FILTER_OPTIONS = [...OPTIMIZATION_GOALS, ...DOMESTIC_OPTIMIZATION_GOALS].filter(
  (g, index, arr) => arr.findIndex((x) => x.value === g.value) === index,
).map((g) => ({ value: g.value, label: g.label }))

function toApiFilters(query: RequestQuery, page: number, mineOnly: boolean): RequestListFilters {
  return {
    keyword: query.keyword.trim() || undefined,
    status: query.status,
    geoSource: query.geoSource !== "all" ? query.geoSource : undefined,
    region: query.region !== "all" ? query.region : undefined,
    goal: query.goal !== "all" ? query.goal : undefined,
    submittedFrom: query.submittedFrom || undefined,
    submittedTo: query.submittedTo || undefined,
    mineOnly: mineOnly || undefined,
    page,
    pageSize: PAGE_SIZE,
  }
}

export function RequestList() {
  const router = useRouter()
  const { can, user } = useAuth()
  const canExport = can("request:export")
  const canChangeStatus = can("request:change_status")
  /** 海外运营服务端已强制仅海外；销售/Leader/Admin 等可见混合归属，需要国内/海外筛选 */
  const showGeoSourceFilter = user?.role !== "overseas"
  const {
    requests,
    requestStats,
    requestListTotal,
    requestsListLoading,
    searchRequests,
    updateStatus,
  } = useRequests()
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()
  const [mineStats, setMineStats] = useState<RequestStats | null>(null)
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied(
    `crm:requests-list-v3:${user?.id || user?.name || "anonymous"}`,
    EMPTY_QUERY,
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const { sort, toggleSort } = useTableSort<RequestSortKey>({ key: "submittedAt", dir: "desc" })

  const totalPages = Math.max(1, Math.ceil(requestListTotal / PAGE_SIZE))
  const currentPage = Math.min(applied.page, totalPages)
  const displayStats = mineOnly && mineStats ? mineStats : requestStats

  useEffect(() => {
    if (!mineOnly) {
      setMineStats(null)
      return
    }
    let cancelled = false
    void fetchRequestStats({ mineOnly: true })
      .then((stats) => {
        if (!cancelled) setMineStats(stats)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mineOnly])

  useEffect(() => {
    if (!listStateReady) return
    let cancelled = false
    void searchRequests(toApiFilters(applied.query, applied.page, mineOnly))
      .then((result) => {
        if (cancelled) return
        const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (applied.page > pages) {
          setApplied((prev) => ({ ...prev, page: pages }))
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "加载需求列表失败")
        }
      })
    return () => {
      cancelled = true
    }
  }, [applied, searchRequests, mineOnly, listStateReady, setApplied])

  function advanceStatus(id: string, current: RequestStatus) {
    const action = STATUS_ACTIONS[current]
    if (!action) return
    updateStatus(id, action.next)
      .then((updated) => {
        toast.success(`状态已更新为「${STATUS_META[action.next].label}」`)
        void searchRequests(toApiFilters(applied.query, applied.page, mineOnly)).catch(() => undefined)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "状态更新失败"))
  }

  const sorted = useMemo(
    () =>
      sortRows(requests, sort, {
        code: (r) => r.code,
        company: (r) => r.data.companyName || r.data.brandName,
        region: (r) => regionLabel(r.data.regions),
        goal: (r) => requestGoalLabel(r.data),
        status: (r) => r.status,
        owner: (r) => formatRequestOwner(r.owner, r.ownerEmploymentStatus),
        submittedAt: (r) => r.submittedAt,
      }),
    [requests, sort],
  )

  const selectedRecords = sorted.filter((r) => selectedIds.includes(r.id))
  const allSelected = sorted.length > 0 && selectedRecords.length === sorted.length

  function handleSearch() {
    setSelectedIds([])
    setApplied({ query: { ...draft }, page: 1 })
  }

  function handleReset() {
    setDraft(EMPTY_QUERY)
    setSelectedIds([])
    setApplied({ query: EMPTY_QUERY, page: 1 })
  }

  function handleMineOnlyChange(next: boolean) {
    setMineOnly(next)
    setSelectedIds([])
    setApplied((prev) => ({ ...prev, page: 1 }))
  }

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === applied.page) return
    setSelectedIds([])
    setApplied((prev) => ({ ...prev, page: next }))
  }

  function setStatusFilter(value: RequestStatus | "all") {
    setDraft((prev) => ({ ...prev, status: value }))
    setSelectedIds([])
    setApplied((prev) => ({ query: { ...prev.query, status: value }, page: 1 }))
  }

  function setGeoSourceFilter(value: "all" | "domestic" | "overseas") {
    setDraft((prev) => ({ ...prev, geoSource: value }))
    setSelectedIds([])
    setApplied((prev) => ({ query: { ...prev.query, geoSource: value }, page: 1 }))
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((v) => v !== id)))
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? sorted.map((r) => r.id) : [])
  }

  async function handleExport() {
    if (selectedRecords.length === 0) {
      toast.error("请先勾选需要导出的需求")
      return
    }
    setExporting(true)
    try {
      const excelName = await exportRequestsExcel(selectedRecords.map((r) => r.id))
      const pdfName = `需求导出-${exportTimestamp()}.pdf`
      const result = await exportMergedPdfFromTemplates(selectedRecords, pdfName)
      if (!result.ok) throw new Error(result.error)
      toast.success("导出完成", {
        description: `已生成「${excelName}」与「${pdfName}」`,
      })
    } catch (err) {
      toast.error("导出失败", {
        description: err instanceof Error ? err.message : "请重试",
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "需求总数", value: displayStats.total, tone: "text-foreground" },
          { label: STATUS_META.submitted.label, value: displayStats.submitted, tone: "text-primary" },
          { label: STATUS_META.pending_review.label, value: displayStats.pending, tone: "text-amber-600" },
          { label: STATUS_META.in_project.label, value: displayStats.inProject, tone: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1 text-lg font-semibold tabular-nums", s.tone)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {mineOnly
              ? `当前仅显示本人（${user?.name || "我"}）跟进的需求`
              : mineOnlyAvailable
                ? "默认显示部门可见范围；可切换只看自己"
                : null}
          </p>
          {mineOnlyAvailable ? (
            <MineOnlyToggle value={mineOnly} onChange={handleMineOnlyChange} />
          ) : null}
        </div>
        <FilterGrid>
          <FilterField label="关键词">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="公司、品牌或编号"
                value={draft.keyword}
                onChange={(e) => setDraft((prev) => ({ ...prev, keyword: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch()
                }}
              />
            </div>
          </FilterField>
          <FilterField label="目标国家">
            <FilterSelect
              value={draft.region}
              onChange={(v) => setDraft((prev) => ({ ...prev, region: v }))}
              options={[{ value: "all", label: "全部国家" }, ...COUNTRY_FILTER_OPTIONS]}
              placeholder="全部国家"
            />
          </FilterField>
          <FilterField label="优化目标">
            <FilterSelect
              value={draft.goal}
              onChange={(v) => setDraft((prev) => ({ ...prev, goal: v }))}
              options={[{ value: "all", label: "全部目标" }, ...GOAL_FILTER_OPTIONS]}
              placeholder="全部优化目标"
            />
          </FilterField>
          <FilterField label="提交时间">
            <DateRangePicker
              from={draft.submittedFrom}
              to={draft.submittedTo}
              onChange={({ from, to }) =>
                setDraft((prev) => ({ ...prev, submittedFrom: from, submittedTo: to }))
              }
              placeholder="选择提交日期范围"
            />
          </FilterField>
        </FilterGrid>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">需求状态</span>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                    applied.query.status === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent/40",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {showGeoSourceFilter ? (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-xs font-medium text-muted-foreground">业务来源</span>
                {GEO_SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setGeoSourceFilter(f.value)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                      (applied.query.geoSource ?? "all") === f.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExport && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleExport()}
                  disabled={exporting}
                >
                  <Download className="size-4" />
                  {exporting ? "导出中…" : "导出"}
                </Button>
              </>
            )}
            <Button type="button" variant="outline" onClick={handleReset}>
              重置
            </Button>
            <Button type="button" className="gap-1.5" onClick={handleSearch}>
              <Search className="size-4" />
              查询
            </Button>
          </div>
        </div>
      </div>

      {!canExport ? (
        <p className="text-xs text-muted-foreground">
          共 {requestListTotal} 条。您可查看与筛选需求单，状态变更与导出请联系销售部同事
        </p>
      ) : null}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        {requestsListLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 text-sm text-muted-foreground">
            加载中…
          </div>
        )}
        <TableCellTip>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                <th className="min-w-max whitespace-nowrap px-4 py-3 font-medium">
                  {canExport && (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  )}
                </th>
                <SortableTh
                  label="需求编号"
                  sortKey="code"
                  sort={sort}
                  onToggle={toggleSort}
                  className="w-28 whitespace-nowrap px-3"
                />
                <SortableTh
                  label="公司 / 品牌"
                  sortKey="company"
                  sort={sort}
                  onToggle={toggleSort}
                />
                {showGeoSourceFilter ? (
                  <th className="min-w-max whitespace-nowrap px-4 py-3 font-medium">来源</th>
                ) : null}
                <SortableTh label="目标国家-语言" sortKey="region" sort={sort} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortableTh label="优化目标" sortKey="goal" sort={sort} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortableTh label="状态" sortKey="status" sort={sort} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortableTh label="跟进人" sortKey="owner" sort={sort} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortableTh label="提交时间" sortKey="submittedAt" sort={sort} onToggle={toggleSort} className="whitespace-nowrap" />
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const companyTitle = [r.data.companyName, r.data.brandName].filter(Boolean).join(" / ")
                return (
                <tr
                  key={r.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/30"
                  onClick={() => router.push(`/requests/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/requests/${r.id}`)
                    }
                  }}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {canExport && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={(e) => toggleSelect(r.id, e.target.checked)}
                      />
                    )}
                  </td>
                  <td
                    className="w-28 whitespace-nowrap px-3 py-3 font-mono text-[10px] leading-none tracking-tight text-muted-foreground"
                    title={r.code}
                  >
                    {r.code}
                  </td>
                  <td className="max-w-0 px-4 py-3">
                    <p className="truncate text-sm font-medium" title={companyTitle || undefined}>
                      <span>{r.data.companyName || "—"}</span>
                      {r.data.brandName ? (
                        <span className="font-normal text-muted-foreground"> · {r.data.brandName}</span>
                      ) : null}
                    </p>
                  </td>
                  {showGeoSourceFilter ? (
                    <td className="whitespace-nowrap px-4 py-3">
                      <GeoSourceBadge record={r} />
                    </td>
                  ) : null}
                  <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <span className="block truncate" title={regionLabel(r.data.regions)}>
                      {regionLabel(r.data.regions)}
                    </span>
                  </td>
                  <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <span className="block truncate" title={requestGoalLabel(r.data)}>
                      {requestGoalLabel(r.data)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3" >
                    <div className="inline-flex items-center gap-1.5">
                      <StatusBadge status={r.status} />
                    </div>
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">
                    {formatRequestOwner(r.owner, r.ownerEmploymentStatus)}
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-xs text-muted-foreground">{r.submittedAt}</td>
                  <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <div className="flex flex-nowrap items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/requests/${r.id}`)}>
                        查看详情
                      </Button>
                      {canChangeStatus && STATUS_ACTIONS[r.status] && <Button size="sm" className="gap-1" onClick={() => advanceStatus(r.id, r.status)}>{STATUS_ACTIONS[r.status]!.label}<ArrowRight className="size-3.5" /></Button>}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </TableCellTip>

        <div className="divide-y divide-border md:hidden">
          {sorted.map((r) => (
            <div key={r.id} className="p-4">
              <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                {canExport && (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(r.id)}
                    onChange={(e) => toggleSelect(r.id, e.target.checked)}
                  />
                )}
                {canExport ? "选中导出" : null}
              </label>
              <Link href={`/requests/${r.id}`} className="block transition-colors hover:opacity-80">
                <div className="flex items-center justify-between gap-3">
                  <p
                    className="min-w-0 flex-1 truncate font-medium"
                    title={[r.data.companyName, r.data.brandName].filter(Boolean).join(" / ") || undefined}
                  >
                    <span>{r.data.companyName || "—"}</span>
                    {r.data.brandName ? (
                      <span className="font-normal text-muted-foreground"> · {r.data.brandName}</span>
                    ) : null}
                  </p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {showGeoSourceFilter ? <GeoSourceBadge record={r} /> : null}
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-mono text-[10px] tracking-tight">{r.code}</span>
                  <span className="shrink-0">{r.submittedAt}</span>
                </div>
              </Link>
              <div className="mt-3 flex flex-col gap-2">
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/requests/${r.id}`}>查看详情</Link>
                </Button>
                {canChangeStatus && STATUS_ACTIONS[r.status] && <Button size="sm" className="w-full gap-1" onClick={() => advanceStatus(r.id, r.status)}>{STATUS_ACTIONS[r.status]!.label}<ArrowRight className="size-3.5" /></Button>}
              </div>
            </div>
          ))}
        </div>

        {!requestsListLoading && sorted.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">没有符合条件的需求记录</div>
        )}
      </div>

      <ListPagination
        total={requestListTotal}
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={goToPage}
        loading={requestsListLoading}
        hint={(() => {
          const parts: string[] = []
          if (applied.query.status !== "all") {
            parts.push(STATUS_META[applied.query.status].label)
          }
          if (showGeoSourceFilter && (applied.query.geoSource ?? "all") !== "all") {
            const geo = applied.query.geoSource
            if (geo === "domestic" || geo === "overseas") {
              parts.push(REQUEST_GEO_SOURCE_META[geo].label)
            }
          }
          return parts.length > 0 ? `（已按「${parts.join(" · ")}」筛选）` : undefined
        })()}
      />
    </div>
  )
}
