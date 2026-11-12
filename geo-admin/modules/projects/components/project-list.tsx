"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MapPin, Search } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { useAuth } from "@/modules/auth"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import {
  EmptyState,
  FilterChips,
  FilterField,
  FilterGrid,
  FilterSelect,
  Pill,
  RangeFilterField,
  StatCards,
} from "@/modules/crm/components/ui"
import { money } from "@/modules/crm/lib/crm-data"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import {
  PROJECT_HEALTH_META,
  PROJECT_RISK_META,
  PROJECT_STAGE_META,
} from "@/modules/projects/lib/labels"
import type { ProjectHealth, ProjectRecord, ProjectRisk, ProjectStage } from "@/modules/projects/lib/types"
import { fetchProjects, fetchProjectStats } from "@/modules/projects/services/projects-api"
import { DateRangePicker } from "@/shared/ui/date-range-picker"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"

type SortKey = "name" | "customer" | "office" | "stage" | "intents" | "start" | "plannedStart" | "actualDelivery" | "updated"

type ProjectQuery = {
  keyword: string
  stage: string
  health: string
  risk: string
  office: string
  renewalOnly: boolean
  amountMin: string
  amountMax: string
  sowFrom: string
  sowTo: string
  updatedFrom: string
  updatedTo: string
  dueDaysMin: string
  dueDaysMax: string
}

const EMPTY_QUERY: ProjectQuery = {
  keyword: "",
  stage: "all",
  health: "all",
  risk: "all",
  office: "all",
  renewalOnly: false,
  amountMin: "",
  amountMax: "",
  sowFrom: "",
  sowTo: "",
  updatedFrom: "",
  updatedTo: "",
  dueDaysMin: "",
  dueDaysMax: "",
}

const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

export function ProjectList({ view }: { view: "active" | "archive" }) {
  const router = useRouter()
  const { user } = useAuth()
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ProjectRecord[]>([])
  const { applied, setApplied, listStateReady } = usePersistedListApplied(
    `crm:projects-list:${view}:${user?.id || user?.name || "anonymous"}`,
    EMPTY_QUERY,
  )
  const {
    keyword,
    stage,
    health,
    risk,
    office,
    renewalOnly,
    amountMin,
    amountMax,
    sowFrom,
    sowTo,
    updatedFrom,
    updatedTo,
    dueDaysMin,
    dueDaysMax,
  } = applied.query
  const page = applied.page
  const [stats, setStats] = useState({
    active: 0,
    delayed: 0,
    renewalWarning: 0,
    unhealthy: 0,
    completed: 0,
  })
  const { sort, toggleSort } = useTableSort<SortKey>()

  function patchQuery<K extends keyof ProjectQuery>(key: K, value: ProjectQuery[K]) {
    setApplied((prev) => ({
      query: { ...prev.query, [key]: value },
      page: 1,
    }))
  }

  function handleMineOnlyChange(next: boolean) {
    setMineOnly(next)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  function handleToggleSort(key: SortKey) {
    toggleSort(key)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, st] = await Promise.all([
        fetchProjects({
          view,
          keyword,
          stage,
          health,
          riskLevel: risk,
          office,
          renewalWarning: view === "active" ? renewalOnly : false,
          mineOnly,
          amountMin: amountMin !== "" ? Number(amountMin) : undefined,
          amountMax: amountMax !== "" ? Number(amountMax) : undefined,
          sowFrom: sowFrom || undefined,
          sowTo: sowTo || undefined,
          updatedFrom: updatedFrom || undefined,
          updatedTo: updatedTo || undefined,
          dueDaysMin: dueDaysMin !== "" ? Number(dueDaysMin) : undefined,
          dueDaysMax: dueDaysMax !== "" ? Number(dueDaysMax) : undefined,
        }),
        fetchProjectStats(view),
      ])
      setItems(list.items || [])
      setStats(st)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [
    view,
    keyword,
    stage,
    health,
    risk,
    office,
    renewalOnly,
    mineOnly,
    amountMin,
    amountMax,
    sowFrom,
    sowTo,
    updatedFrom,
    updatedTo,
    dueDaysMin,
    dueDaysMax,
  ])

  useEffect(() => {
    if (!listStateReady) return
    void load()
  }, [load, listStateReady])

  const filtered = useMemo(
    () =>
      sortRows(items, sort, {
        name: (p) => p.name,
        customer: (p) => p.customerName,
        office: (p) => p.office || p.customerRegion || "",
        stage: (p) => p.stage,
        intents: (p) => p.intentTotal,
        start: (p) => p.startDate || "",
        plannedStart: (p) => p.plannedStartDate || "",
        actualDelivery: (p) => p.actualDeliveryDate || "",
        updated: (p) => p.updatedAt,
      }),
    [items, sort],
  )

  const paged = useMemo(() => paginateSlice(filtered, page, PAGE_SIZE), [filtered, page])

  const stageOptions = (Object.keys(PROJECT_STAGE_META) as ProjectStage[])
    .filter((s) => (view === "archive" ? s === "completed" : s !== "completed"))
    .map((s) => ({ value: s, label: PROJECT_STAGE_META[s].label }))

  if (loading && items.length === 0) {
    return <div className="px-1 py-10 text-center text-sm text-muted-foreground">加载项目数据中…</div>
  }

  return (
    <div className="space-y-3">
      {view === "active" ? (
        <StatCards
          dense
          items={[
            { label: "执行中", value: stats.active, tone: "text-sky-700" },
            { label: "已延期", value: stats.delayed, tone: "text-red-600" },
            { label: "续约预警", value: stats.renewalWarning, tone: "text-amber-600" },
            { label: "不健康", value: stats.unhealthy, tone: "text-rose-600" },
          ]}
        />
      ) : (
        <StatCards dense cols={3} items={[{ label: "已归档", value: stats.completed }]} />
      )}

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {view === "active"
              ? "按地点、阶段、风险与关键日期筛选交付项目"
              : "查看已归档交付项目"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {mineOnlyAvailable && <MineOnlyToggle value={mineOnly} onChange={handleMineOnlyChange} />}
            <Button variant="outline" size="sm" asChild>
              <Link href={view === "active" ? "/projects/archive" : "/projects"}>
                {view === "active" ? "查看归档" : "返回交付进度"}
              </Link>
            </Button>
          </div>
        </div>
        <FilterGrid>
          <FilterField label="关键词">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="项目 / 客户 / 负责人"
                value={keyword}
                onChange={(e) => patchQuery("keyword", e.target.value)}
              />
            </div>
          </FilterField>
          <FilterField label="阶段">
            <FilterSelect
              value={stage}
              onChange={(v) => patchQuery("stage", v)}
              options={[{ value: "all", label: "全部阶段" }, ...stageOptions]}
              placeholder="全部阶段"
            />
          </FilterField>
          <FilterField label="健康度">
            <FilterSelect
              value={health}
              onChange={(v) => patchQuery("health", v)}
              options={[
                { value: "all", label: "全部健康度" },
                ...(Object.keys(PROJECT_HEALTH_META) as ProjectHealth[]).map((h) => ({
                  value: h,
                  label: PROJECT_HEALTH_META[h].label,
                })),
              ]}
              placeholder="全部健康度"
            />
          </FilterField>
          <FilterField label="风险">
            <FilterSelect
              value={risk}
              onChange={(v) => patchQuery("risk", v)}
              options={[
                { value: "all", label: "全部风险" },
                ...(Object.keys(PROJECT_RISK_META) as ProjectRisk[]).map((r) => ({
                  value: r,
                  label: PROJECT_RISK_META[r].label,
                })),
              ]}
              placeholder="全部风险"
            />
          </FilterField>
          <FilterField label="交付地点">
            <FilterSelect
              value={office}
              onChange={(v) => patchQuery("office", v)}
              options={[
                { value: "all", label: "全部地点" },
                { value: "北京", label: "北京" },
                { value: "厦门", label: "厦门" },
                { value: "未设置", label: "未设置" },
              ]}
              placeholder="全部地点"
            />
          </FilterField>
          <RangeFilterField
            label="合同金额（万元）"
            minValue={amountMin}
            maxValue={amountMax}
            onMinChange={(v) => patchQuery("amountMin", v)}
            onMaxChange={(v) => patchQuery("amountMax", v)}
            minProps={{ min: 0 }}
            maxProps={{ min: 0 }}
          />
          <FilterField label="SOW 截止">
            <DateRangePicker
              from={sowFrom}
              to={sowTo}
              onChange={({ from, to }) =>
                setApplied((prev) => ({
                  query: { ...prev.query, sowFrom: from, sowTo: to },
                  page: 1,
                }))
              }
              placeholder="选择 SOW 截止范围"
            />
          </FilterField>
          <RangeFilterField
            label="距到期（天）"
            minValue={dueDaysMin}
            maxValue={dueDaysMax}
            onMinChange={(v) => patchQuery("dueDaysMin", v)}
            onMaxChange={(v) => patchQuery("dueDaysMax", v)}
          />
          <FilterField label="更新时间">
            <DateRangePicker
              from={updatedFrom}
              to={updatedTo}
              onChange={({ from, to }) =>
                setApplied((prev) => ({
                  query: { ...prev.query, updatedFrom: from, updatedTo: to },
                  page: 1,
                }))
              }
              placeholder="选择更新时间范围"
            />
          </FilterField>
        </FilterGrid>
        {view === "active" ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">续约预警</span>
              <FilterChips
                value={renewalOnly ? "yes" : "all"}
                onChange={(v) => patchQuery("renewalOnly", v === "yes")}
                options={[
                  { value: "all", label: "全部" },
                  { value: "yes", label: "续约预警" },
                ]}
              />
            </div>
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          text={
            view === "active"
              ? "暂无执行中项目。合同变为「已签订」后将自动生成交付项目。"
              : "暂无归档项目。将项目阶段设为「已完成」后会出现在此列表。"
          }
        />
      ) : (
        <TableCellTip>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <SortableTh label="项目名称" sortKey="name" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="客户" sortKey="customer" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="地点" sortKey="office" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="项目状态" sortKey="stage" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="优化意图数量" sortKey="intents" sort={sort} onToggle={handleToggleSort} />
                <th className="min-w-max whitespace-nowrap px-3 py-2 font-medium">项目经理</th>
                <th className="min-w-max whitespace-nowrap px-3 py-2 font-medium">合同金额</th>
                <SortableTh label="项目启动时间" sortKey="start" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="计划启动时间" sortKey="plannedStart" sort={sort} onToggle={handleToggleSort} />
                <th className="min-w-max whitespace-nowrap px-3 py-2 font-medium">计划交付</th>
                <SortableTh label="实际交付时间" sortKey="actualDelivery" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="更新时间" sortKey="updated" sort={sort} onToggle={handleToggleSort} />
                <th className="sticky right-0 min-w-max whitespace-nowrap border-l border-border bg-muted/90 px-3 py-2 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((p) => {
                const stageMeta = PROJECT_STAGE_META[p.stage]
                const healthMeta = PROJECT_HEALTH_META[p.health]
                const riskMeta = PROJECT_RISK_META[p.riskLevel]
                return (
                  <tr
                    key={p.id}
                    className="group cursor-pointer border-b border-border/70 last:border-0 hover:bg-muted/30"
                    onClick={() => router.push(`/projects/${p.id}`)}
                  >
                    <td className="max-w-0 px-3 py-2.5 font-medium text-foreground">
                      <span className="block truncate" title={p.name}>
                        {p.name}
                      </span>
                    </td>
                    <td className="max-w-0 px-3 py-2.5">
                      <span className="block truncate" title={p.customerName || undefined}>
                        {p.customerName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.office || p.customerRegion || "未设置"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="flex flex-wrap gap-1"><Pill label={stageMeta.label} tone={stageMeta.tone} /><Pill label={healthMeta.label} tone={healthMeta.tone} /><Pill label={`风险 ${riskMeta.label}`} tone={riskMeta.tone} /></div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center font-medium tabular-nums">{p.intentTotal}</td>
                    <td className="max-w-0 truncate px-3 py-2.5 text-muted-foreground">{p.projectManager || "—"}</td>
                    <td className="max-w-0 truncate px-3 py-2.5 tabular-nums">
                      {p.contractAmount != null ? money(p.contractAmount) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{p.startDate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{p.plannedStartDate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{p.latestDeliveryDate || p.sowEndDate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{p.actualDeliveryDate || "—"}</td>
                    <td className="max-w-0 truncate px-3 py-2.5 text-xs text-muted-foreground">{p.updatedAt}</td>
                    <td className="sticky right-0 whitespace-nowrap border-l border-border bg-card px-3 py-2.5 text-center group-hover:bg-muted/30">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/projects/${p.id}`} onClick={(event) => event.stopPropagation()}>
                          查看详情
                        </Link>
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </TableCellTip>
      )}
      {filtered.length > 0 && (
        <ListPagination
          total={paged.total}
          page={paged.currentPage}
          pageSize={PAGE_SIZE}
          onPageChange={(next) => setApplied((prev) => ({ ...prev, page: next }))}
          loading={loading}
        />
      )}
      {user?.name && mineOnly && (
        <p className="text-xs text-muted-foreground">当前仅显示本人（{user.name}）相关项目</p>
      )}
    </div>
  )
}
