"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Clock3, KanbanSquare, List, Search } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { canDo } from "@/modules/auth/lib/permissions"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import { useAuth } from "@/modules/auth"
import { toast } from "sonner"
import { AdvanceOpportunityDialog } from "@/modules/crm/components/opportunity-actions"
import {
  OPP_FLOW_STAGES,
  OPP_STAGES,
  money,
  normalizeOppStage,
  oppStageMeta,
  wan,
  type Opportunity,
  type OpportunityStageHistory,
  type OppStage,
} from "@/modules/crm/lib/crm-data"
import { MSG_OPP_NO_ROLLBACK_TO_CONTACT } from "@/modules/crm/lib/opportunity-request-gate"
import {
  Pill,
  StatCards,
  EmptyState,
  FilterGrid,
  FilterField,
  FilterSelect,
  RangeFilterField,
} from "@/modules/crm/components/ui"
import { DateRangePicker } from "@/shared/ui/date-range-picker"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"

// 看板展示的阶段（与飞书 1:1；输单单独列）
const BOARD_STAGES: OppStage[] = OPP_FLOW_STAGES
const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

type OppView = "board" | "list"

type OppListQuery = {
  view: OppView
  businessType: string
  keyword: string
  stageFilter: OppStage[]
  ownerFilter: string
  amountMin: string
  amountMax: string
  probabilityMin: string
  probabilityMax: string
  expectedSignFrom: string
  expectedSignTo: string
  nextFollowFrom: string
  nextFollowTo: string
  stagnationMin: string
  stagnationMax: string
}

const EMPTY_OPP_QUERY: OppListQuery = {
  view: "board",
  businessType: "all",
  keyword: "",
  stageFilter: [],
  ownerFilter: "all",
  amountMin: "",
  amountMax: "",
  probabilityMin: "",
  probabilityMax: "",
  expectedSignFrom: "",
  expectedSignTo: "",
  nextFollowFrom: "",
  nextFollowTo: "",
  stagnationMin: "",
  stagnationMax: "",
}

type OppSortKey =
  | "name"
  | "customer"
  | "amount"
  | "probability"
  | "owner"
  | "expectedSignDate"
  | "nextFollowAt"
  | "stage"
  | "stagnation"

function stagnationDays(enteredAt?: string) {
  if (!enteredAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000))
}

function currentStageEnteredAt(stage: OppStage, history: OpportunityStageHistory[] = []) {
  return [...(history ?? [])]
    .reverse()
    .find((item) => normalizeOppStage(item.stage) === stage && !item.leftAt)?.enteredAt
}

export function OpportunityBoard({ initialBusinessType }: { initialBusinessType?: string }) {
  const router = useRouter()
  const { opportunities, customers, loading, ensureOpportunitiesLoaded, opportunitiesLoading } = useCrm()
  const { user } = useAuth()
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()
  const editable = canDo(user?.permissions ?? [], "opportunities:stage", "opportunities:write")

  useEffect(() => {
    void ensureOpportunitiesLoaded().catch((err) => {
      toast.error(err instanceof Error ? err.message : "加载商机失败")
    })
  }, [ensureOpportunitiesLoaded])

  const { applied, setApplied, listStateReady } = usePersistedListApplied(
    `crm:opportunities-list:${user?.id || user?.name || "anonymous"}`,
    EMPTY_OPP_QUERY,
  )
  const sourceApplied = useRef<string | null>(null)
  useEffect(() => {
    if (!listStateReady || !initialBusinessType || sourceApplied.current === initialBusinessType) return
    if (["direct", "channel", "strategic_ecosystem"].includes(initialBusinessType)) {
      setApplied((previous) => ({ query: { ...previous.query, businessType: initialBusinessType }, page: 1 }))
      sourceApplied.current = initialBusinessType
    }
  }, [initialBusinessType, listStateReady, setApplied])
  const businessType = applied.query.businessType || "all"
  const sourceLabel = (value?: string) => value === "channel" ? "渠道" : value === "strategic_ecosystem" ? "战略生态" : "直客"
  const view = applied.query.view
  const keyword = applied.query.keyword
  const rawStageFilter = applied.query.stageFilter as unknown
  const stageFilter = Array.isArray(rawStageFilter)
    ? (rawStageFilter as OppStage[])
    : rawStageFilter === "all" || !rawStageFilter
      ? []
      : [rawStageFilter as OppStage]
  const ownerFilter = applied.query.ownerFilter
  const {
    amountMin,
    amountMax,
    probabilityMin,
    probabilityMax,
    expectedSignFrom,
    expectedSignTo,
    nextFollowFrom,
    nextFollowTo,
    stagnationMin,
    stagnationMax,
  } = applied.query
  const listPage = applied.page
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<OppStage | null>(null)
  const [pendingAdvance, setPendingAdvance] = useState<{
    opp: Opportunity
    targetStage: OppStage
  } | null>(null)
  /** 拖拽结束后避免误触发点击进入详情 */
  const suppressClickRef = useRef(false)
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const { sort, toggleSort } = useTableSort<OppSortKey>()

  const effectiveOwnerFilter = mineOnly && user?.name ? user.name : ownerFilter

  function patchQuery<K extends keyof OppListQuery>(key: K, value: OppListQuery[K]) {
    setApplied((prev) => ({
      query: { ...prev.query, [key]: value },
      page: 1,
    }))
  }

  function changeView(next: OppView) {
    patchQuery("view", next)
  }

  function handleMineOnlyChange(next: boolean) {
    setMineOnly(next)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  function handleToggleSort(key: OppSortKey) {
    toggleSort(key)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  function custName(id: string, fallbackBrand?: string) {
    const c = customers.find((x) => x.id === id)
    return c?.brandName || c?.companyName || fallbackBrand || "—"
  }

  const ownerOptions = useMemo(() => {
    const names = [...new Set(opportunities.map((o) => o.owner).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    )
    return names
  }, [opportunities])

  const scopedOpps = useMemo(() => {
    if (!mineOnly || !user?.name) return opportunities
    return opportunities.filter((o) => o.owner === user.name)
  }, [opportunities, mineOnly, user?.name])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const rows = scopedOpps.filter((o) => {
      if (businessType !== "all" && (o.businessType || "direct") !== businessType) return false
      const mStage = view === "board" || stageFilter.length === 0 || stageFilter.includes(normalizeOppStage(o.stage))
      const mOwner = effectiveOwnerFilter === "all" || o.owner === effectiveOwnerFilter
      const mkw =
        !kw ||
        o.name.toLowerCase().includes(kw) ||
        custName(o.customerId, o.partnerName || o.brandName).toLowerCase().includes(kw) ||
        (o.owner || "").toLowerCase().includes(kw)
      const amount = Number(o.amount || 0)
      const mAmountMin = amountMin === "" || amount >= Number(amountMin)
      const mAmountMax = amountMax === "" || amount <= Number(amountMax)
      const prob = Number(o.probability ?? 0)
      const mProbMin = probabilityMin === "" || prob >= Number(probabilityMin)
      const mProbMax = probabilityMax === "" || prob <= Number(probabilityMax)
      const signDay = (o.expectedSignDate || "").slice(0, 10)
      const mSignFrom = expectedSignFrom === "" || signDay >= expectedSignFrom
      const mSignTo = expectedSignTo === "" || (signDay !== "" && signDay <= expectedSignTo)
      const followDay = (o.nextFollowAt || "").slice(0, 10)
      const mFollowFrom = nextFollowFrom === "" || followDay >= nextFollowFrom
      const mFollowTo = nextFollowTo === "" || (followDay !== "" && followDay <= nextFollowTo)
      const days = stagnationDays(currentStageEnteredAt(o.stage, o.stageHistory))
      const mDaysMin = stagnationMin === "" || days >= Number(stagnationMin)
      const mDaysMax = stagnationMax === "" || days <= Number(stagnationMax)
      return (
        mStage &&
        mOwner &&
        mkw &&
        mAmountMin &&
        mAmountMax &&
        mProbMin &&
        mProbMax &&
        mSignFrom &&
        mSignTo &&
        mFollowFrom &&
        mFollowTo &&
        mDaysMin &&
        mDaysMax
      )
    })
    return sortRows(rows, sort, {
      name: (o) => o.name,
      customer: (o) => custName(o.customerId, o.partnerName || o.brandName),
      amount: (o) => o.amount,
      probability: (o) => o.probability,
      owner: (o) => o.owner,
      expectedSignDate: (o) => o.expectedSignDate || "",
      nextFollowAt: (o) => o.nextFollowAt || "",
      stage: (o) => OPP_STAGES.indexOf(o.stage),
      stagnation: (o) => stagnationDays(currentStageEnteredAt(o.stage, o.stageHistory)),
    })
  }, [
    scopedOpps,
    businessType,
    keyword,
    customers,
    stageFilter,
    effectiveOwnerFilter,
    sort,
    view,
    amountMin,
    amountMax,
    probabilityMin,
    probabilityMax,
    expectedSignFrom,
    expectedSignTo,
    nextFollowFrom,
    nextFollowTo,
    stagnationMin,
    stagnationMax,
  ])

  const listPaged = useMemo(() => paginateSlice(filtered, listPage, PAGE_SIZE), [filtered, listPage])

  const stats = useMemo(() => {
    const active = scopedOpps.filter((o) => o.stage !== "lost" && o.stage !== "won")
    const won = scopedOpps.filter((o) => o.stage === "won")
    // 历史数据 amount 可能缺失：按数字兜底，避免 Pipeline 显示 NaN 万
    const pipeline = active.reduce((s, o) => s + (Number(o.amount) || 0), 0)
    const wonAmount = won.reduce((s, o) => s + (Number(o.amount) || 0), 0)
    const settled = scopedOpps.filter((o) => o.stage === "won" || o.stage === "lost")
    const winRate = settled.length ? Math.round((won.length / settled.length) * 100) : 0
    return { count: active.length, pipeline, wonAmount, winRate }
  }, [scopedOpps])

  function syncBoardScrollAffordance() {
    const el = boardScrollRef.current
    if (!el) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const max = el.scrollWidth - el.clientWidth
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(max > 4 && el.scrollLeft < max - 4)
  }

  useEffect(() => {
    if (view !== "board") return
    const el = boardScrollRef.current
    if (!el) return
    syncBoardScrollAffordance()
    const onScroll = () => syncBoardScrollAffordance()
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => syncBoardScrollAffordance()) : null
    ro?.observe(el)
    window.addEventListener("resize", syncBoardScrollAffordance)
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro?.disconnect()
      window.removeEventListener("resize", syncBoardScrollAffordance)
    }
  }, [view, filtered.length, loading])

  function scrollBoard(direction: "left" | "right") {
    const el = boardScrollRef.current
    if (!el) return
    const delta = Math.max(240, Math.floor(el.clientWidth * 0.7))
    el.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" })
  }

  function handleDropOnStage(targetStage: OppStage) {
    if (!editable || !draggingId) return
    const opp = opportunities.find((o) => o.id === draggingId)
    setDraggingId(null)
    setOverStage(null)
    if (!opp || opp.stage === targetStage) return
    if (targetStage === "contact" && opp.stage !== "contact") {
      toast.error(MSG_OPP_NO_ROLLBACK_TO_CONTACT)
      return
    }
    setPendingAdvance({ opp, targetStage })
  }

  if (loading || opportunitiesLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">加载商机数据中…</div>
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5", view === "board" && "h-full min-h-0")}>
      <div className="shrink-0">
        <StatCards
          dense
          items={[
            { label: "进行中商机", value: stats.count },
            { label: "商机金额（Pipeline）", value: wan(stats.pipeline), tone: "text-primary" },
            { label: "已赢单金额", value: wan(stats.wonAmount), tone: "text-emerald-600" },
            { label: "赢单率", value: `${stats.winRate}%`, tone: "text-amber-600" },
          ]}
        />
      </div>

      <div className="shrink-0 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {mineOnlyAvailable ? (
              <MineOnlyToggle value={mineOnly} onChange={handleMineOnlyChange} />
            ) : null}
            <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => changeView("board")}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <KanbanSquare className="size-4" />
                看板
              </button>
              <button
                type="button"
                onClick={() => changeView("list")}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="size-4" />
                列表
              </button>
            </div>
          </div>
          <FilterGrid>
            <FilterField label="商机来源"><FilterSelect value={businessType} onChange={(value) => patchQuery("businessType", value)} options={[{ value: "all", label: "全部来源" }, { value: "direct", label: "直客" }, { value: "channel", label: "渠道" }, { value: "strategic_ecosystem", label: "战略生态" }]} /></FilterField>
            <FilterField label="关键词">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-9"
                  placeholder="搜索商机、客户或负责人"
                  value={keyword}
                  onChange={(e) => patchQuery("keyword", e.target.value)}
                />
              </div>
            </FilterField>
            <RangeFilterField
              label="金额（万元）"
              minValue={amountMin}
              maxValue={amountMax}
              onMinChange={(v) => patchQuery("amountMin", v)}
              onMaxChange={(v) => patchQuery("amountMax", v)}
              minProps={{ min: 0 }}
              maxProps={{ min: 0 }}
            />
            <RangeFilterField
              label="概率（%）"
              minValue={probabilityMin}
              maxValue={probabilityMax}
              onMinChange={(v) => patchQuery("probabilityMin", v)}
              onMaxChange={(v) => patchQuery("probabilityMax", v)}
              minProps={{ min: 0, max: 100 }}
              maxProps={{ min: 0, max: 100 }}
            />
            <FilterField label="负责人">
              <FilterSelect
                value={effectiveOwnerFilter}
                onChange={(v) => patchQuery("ownerFilter", v)}
                disabled={mineOnly}
                options={[
                  { value: "all", label: "全部负责人" },
                  ...ownerOptions.map((name) => ({ value: name, label: name })),
                ]}
              />
            </FilterField>
            <FilterField label="预计签约">
              <DateRangePicker
                from={expectedSignFrom}
                to={expectedSignTo}
                onChange={({ from, to }) =>
                  setApplied((prev) => ({
                    query: { ...prev.query, expectedSignFrom: from, expectedSignTo: to },
                    page: 1,
                  }))
                }
                placeholder="选择预计签约日期范围"
              />
            </FilterField>
            <FilterField label="下次计划跟进">
              <DateRangePicker
                from={nextFollowFrom}
                to={nextFollowTo}
                onChange={({ from, to }) =>
                  setApplied((prev) => ({
                    query: { ...prev.query, nextFollowFrom: from, nextFollowTo: to },
                    page: 1,
                  }))
                }
                placeholder="选择下次计划跟进日期范围"
              />
            </FilterField>
            <RangeFilterField
              label="阶段停滞（天）"
              minValue={stagnationMin}
              maxValue={stagnationMax}
              onMinChange={(v) => patchQuery("stagnationMin", v)}
              onMaxChange={(v) => patchQuery("stagnationMax", v)}
              minProps={{ min: 0 }}
              maxProps={{ min: 0 }}
            />
          </FilterGrid>
          {view === "list" ? (
            <div className="mt-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => patchQuery("stageFilter", [])}
                  className={cn("shrink-0 rounded-full border px-3 py-1 text-xs transition-colors", stageFilter.length === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent/40")}
                >全部阶段</button>
                {BOARD_STAGES.map((s) => {
                  const active = stageFilter.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => patchQuery("stageFilter", active ? stageFilter.filter((x) => x !== s) : [...stageFilter, s])}
                      className={cn("shrink-0 rounded-full border px-3 py-1 text-xs transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent/40")}
                    >{oppStageMeta(s).label}</button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {view === "board" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {editable
                ? "拖拽商机卡片到目标阶段列：可推进或回退至「需求调研/需求诊断」及之后阶段；不可回退到初步接触（可标记输单）。变更需填写原因后生效。"
                : "横向滑动或点击两侧箭头，可查看全部阶段列。"}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-8"
                disabled={!canScrollLeft}
                onClick={() => scrollBoard("left")}
                aria-label="向左滚动阶段列"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-8"
                disabled={!canScrollRight}
                onClick={() => scrollBoard("right")}
                aria-label="向右滚动阶段列"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div
            ref={boardScrollRef}
            className="show-scrollbar-x flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2"
          >
            {BOARD_STAGES.map((stage) => {
              const items = filtered.filter((o) => normalizeOppStage(o.stage) === stage)
              const total = items.reduce((s, o) => s + (Number(o.amount) || 0), 0)
              const isOver = overStage === stage && draggingId != null
              return (
                <div
                  key={stage}
                  className="flex h-full w-72 shrink-0 flex-col"
                  onDragOver={(e) => {
                    if (!editable || !draggingId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                    if (overStage !== stage) setOverStage(stage)
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setOverStage((prev) => (prev === stage ? null : prev))
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDropOnStage(stage)
                  }}
                >
                  <div className="mb-2 flex shrink-0 items-center justify-between rounded-lg bg-secondary/60 px-3 py-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {oppStageMeta(stage).label}
                      <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground">
                        {items.length}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{wan(total)}</span>
                  </div>
                  <div
                    className={cn(
                      "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-transparent p-0.5 transition-colors",
                      isOver && "border-primary/50 bg-primary/5",
                    )}
                  >
                    {items.map((o) => (
                      <div
                        key={o.id}
                        role="link"
                        tabIndex={0}
                        draggable={editable}
                        onDragStart={(e) => {
                          if (!editable) return
                          suppressClickRef.current = true
                          setDraggingId(o.id)
                          e.dataTransfer.setData("text/plain", o.id)
                          e.dataTransfer.effectAllowed = "move"
                        }}
                        onDragEnd={() => {
                          setDraggingId(null)
                          setOverStage(null)
                          window.setTimeout(() => {
                            suppressClickRef.current = false
                          }, 0)
                        }}
                        onClick={() => {
                          if (suppressClickRef.current) return
                          router.push(`/opportunities/${o.id}`)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            router.push(`/opportunities/${o.id}`)
                          }
                        }}
                        className={cn(
                          "rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/30",
                          editable && "cursor-grab active:cursor-grabbing",
                          draggingId === o.id && "opacity-50",
                        )}
                      >
                        <p className="text-sm font-medium leading-snug">{o.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{custName(o.customerId, o.partnerName || o.brandName)}</p><div className="mt-2"><Pill label={sourceLabel(o.businessType)} tone="neutral" /></div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-semibold tabular-nums">{money(o.amount)}</span>
                          <span className="text-xs text-muted-foreground">{o.probability}%</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{o.owner}</span>
                          <span>预计 {o.expectedSignDate || "—"}</span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-amber-700">
                          下次跟进 {o.nextFollowAt?.slice(0, 10) || "未安排"}
                        </p>
                        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-600">
                          <Clock3 className="size-3" />
                          {oppStageMeta(o.stage).label}停滞{" "}
                          {stagnationDays(currentStageEnteredAt(o.stage, o.stageHistory))} 天
                        </p>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <div
                        className={cn(
                          "rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground",
                          isOver && "border-primary/40 text-primary",
                        )}
                      >
                        {isOver ? "松开放入此阶段" : "暂无"}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-border bg-card">
          <TableCellTip>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                  <SortableTh label="商机名称" sortKey="name" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="客户" sortKey="customer" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="金额" sortKey="amount" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="概率" sortKey="probability" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="负责人" sortKey="owner" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="预计签约" sortKey="expectedSignDate" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="下次计划跟进" sortKey="nextFollowAt" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="阶段" sortKey="stage" sort={sort} onToggle={handleToggleSort} />
                  <SortableTh label="阶段停滞" sortKey="stagnation" sort={sort} onToggle={handleToggleSort} />
                  <th className="px-4 py-3 font-medium">商机来源</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {listPaged.pageItems.map((o) => (
                  <tr
                    key={o.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/30"
                    onClick={() => router.push(`/opportunities/${o.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        router.push(`/opportunities/${o.id}`)
                      }
                    }}
                  >
                    <td className="max-w-0 px-4 py-3 font-medium">
                      <span className="block truncate" title={o.name}>
                        {o.name}
                      </span>
                    </td>
                    <td className="max-w-0 px-4 py-3 text-muted-foreground">
                      <span className="block truncate" title={custName(o.customerId, o.partnerName || o.brandName) || undefined}>
                        {custName(o.customerId, o.partnerName || o.brandName)}
                      </span>
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 font-semibold tabular-nums">{money(o.amount)}</td>
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{o.probability}%</td>
                    <td className="max-w-0 truncate px-4 py-3">{o.owner}</td>
                    <td className="max-w-0 truncate px-4 py-3 text-xs text-muted-foreground">
                      {o.expectedSignDate || "—"}
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-xs text-amber-600">
                      {o.nextFollowAt?.slice(0, 10) || "未安排"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill label={oppStageMeta(o.stage).label} tone={oppStageMeta(o.stage).tone} />
                    </td>
                    <td className="max-w-0 truncate px-4 py-3 text-xs text-amber-600">
                      {stagnationDays(currentStageEnteredAt(o.stage, o.stageHistory))} 天
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><Pill label={sourceLabel(o.businessType)} tone="neutral" /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" onClick={() => router.push(`/opportunities/${o.id}`)}>
                        查看详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </TableCellTip>
          {filtered.length === 0 && <EmptyState text="没有符合条件的商机" />}
          {filtered.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <ListPagination
                total={listPaged.total}
                page={listPaged.currentPage}
                pageSize={PAGE_SIZE}
                onPageChange={(next) => setApplied((prev) => ({ ...prev, page: next }))}
              />
            </div>
          )}
        </div>
      )}

      {pendingAdvance && (
        <AdvanceOpportunityDialog
          opp={pendingAdvance.opp}
          targetStage={pendingAdvance.targetStage}
          open
          onOpenChange={(open) => {
            if (!open) setPendingAdvance(null)
          }}
        />
      )}
    </div>
  )
}
