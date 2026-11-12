"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, LayoutDashboard, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useRequests } from "@/modules/requests"
import { DashboardWidgetView } from "@/modules/crm/components/dashboard-widget-view"
import {
  DEFAULT_DASHBOARD_LAYOUT,
  loadDashboardLayout,
  saveDashboardLayout,
} from "@/modules/crm/lib/dashboard-layout"
import { resolveDashboardWidget } from "@/modules/crm/lib/dashboard-resolve"
import {
  CHART_OPTIONS,
  X_AXIS_OPTIONS,
  Y_AXIS_OPTIONS,
  SOURCE_OPTIONS,
  createWidget,
  recommendedCharts,
  sanitizeWidget,
  xAxesForSource,
  yAxesForSource,
  type DashChartKind,
  type DashDataSource,
  type DashDimension,
  type DashFunnelValueMode,
  type DashMetric,
  type DashOppScope,
  type DashWidgetConfig,
} from "@/modules/crm/lib/dashboard-schema"
import { Button } from "@/shared/ui/button"
import { Checkbox } from "@/shared/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { cn } from "@/shared/lib/utils"

const FUNNEL_MODE_OPTIONS: { value: DashFunnelValueMode; label: string }[] = [
  { value: "count", label: "数量" },
  { value: "amount", label: "金额（万）" },
  { value: "conversion", label: "阶段转化率 %" },
]

const OPP_SCOPE_OPTIONS: { value: DashOppScope; label: string }[] = [
  { value: "all", label: "全部商机" },
  { value: "open", label: "进行中" },
  { value: "won", label: "仅赢单" },
  { value: "lost", label: "仅输单" },
]

export function Dashboard() {
  const {
    leads,
    customers,
    opportunities,
    contracts,
    ensureOpportunitiesLoaded,
    ensureContractsLoaded,
    opportunitiesLoading,
    contractsLoading,
  } = useCrm()
  const { requestStats } = useRequests()
  const [layout, setLayout] = useState<DashWidgetConfig[]>(() =>
    DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w })),
  )
  const [configOpen, setConfigOpen] = useState(false)
  const [draft, setDraft] = useState<DashWidgetConfig[]>(() =>
    DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w })),
  )

  useEffect(() => {
    setLayout(loadDashboardLayout())
  }, [])

  useEffect(() => {
    void Promise.all([ensureOpportunitiesLoaded(), ensureContractsLoaded()]).catch(() => undefined)
  }, [ensureOpportunitiesLoaded, ensureContractsLoaded])

  const ctx = useMemo(
    () => ({ leads, customers, opportunities, contracts, requestStats }),
    [leads, customers, opportunities, contracts, requestStats],
  )

  const dataLoading = opportunitiesLoading || contractsLoading

  const visible = layout.filter((item) => item.visible)

  function openConfig() {
    setDraft(layout.map((item) => ({ ...item })))
    setConfigOpen(true)
  }

  function applyConfig() {
    const next = draft.map((item) =>
      item.preset === "core_kpi" ? { ...item } : sanitizeWidget(item),
    )
    setLayout(next)
    saveDashboardLayout(next)
    setConfigOpen(false)
    toast.success("看板布局已保存（本机）")
  }

  function resetConfig() {
    setDraft(DEFAULT_DASHBOARD_LAYOUT.map((item) => ({ ...item })))
  }

  function moveDraft(instanceId: string, dir: -1 | 1) {
    setDraft((prev) => {
      const idx = prev.findIndex((x) => x.instanceId === instanceId)
      const nextIdx = idx + dir
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev
      const copy = [...prev]
      const tmp = copy[idx]!
      copy[idx] = copy[nextIdx]!
      copy[nextIdx] = tmp
      return copy
    })
  }

  function patchDraft(instanceId: string, patch: Partial<DashWidgetConfig>) {
    setDraft((prev) =>
      prev.map((item) => {
        if (item.instanceId !== instanceId) return item
        if (item.preset === "core_kpi") {
          return {
            ...item,
            title: patch.title ?? item.title,
            visible: patch.visible ?? item.visible,
            span: patch.span ?? item.span,
          }
        }
        return sanitizeWidget({ ...item, ...patch })
      }),
    )
  }

  function addWidget() {
    setDraft((prev) => [
      ...prev,
      createWidget({
        source: "opportunities",
        xAxis: "stage",
        yAxis: "count",
        chart: "bar",
        title: "新建图表",
        span: 1,
      }),
    ])
  }

  function removeWidget(instanceId: string) {
    setDraft((prev) => prev.filter((x) => x.instanceId !== instanceId))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutDashboard className="size-4" />
          <span>可配置数据源、指标、维度与图表类型；布局保存在本机浏览器。</span>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openConfig}>
          <Settings2 className="size-4" />
          自定义看板
        </Button>
      </div>

      {dataLoading ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          加载看板数据中…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">尚未选择任何图表或指标</p>
          <Button type="button" className="mt-4" onClick={openConfig}>
            去配置
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {visible.map((item) => {
            const resolved = resolveDashboardWidget(item, ctx)
            return (
              <div
                key={item.instanceId}
                className={cn("min-w-0", item.span === 2 && "lg:col-span-2")}
              >
                <DashboardWidgetView resolved={resolved} />
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>自定义数据看板</DialogTitle>
            <DialogDescription>
              为每个模块选择数据源、X/Y 轴与图表类型（图表类型全部可选）。轴标题可自定义。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {draft.map((item, index) => (
              <WidgetConfigCard
                key={item.instanceId}
                item={item}
                index={index}
                total={draft.length}
                onPatch={(patch) => patchDraft(item.instanceId, patch)}
                onMove={(dir) => moveDraft(item.instanceId, dir)}
                onRemove={() => removeWidget(item.instanceId)}
              />
            ))}
          </div>

          <Button type="button" variant="outline" className="w-full gap-1.5" onClick={addWidget}>
            <Plus className="size-4" />
            添加图表
          </Button>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" className="gap-1.5" onClick={resetConfig}>
              <RotateCcw className="size-4" />
              恢复默认
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfigOpen(false)}>
                取消
              </Button>
              <Button type="button" onClick={applyConfig}>
                保存布局
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WidgetConfigCard({
  item,
  index,
  total,
  onPatch,
  onMove,
  onRemove,
}: {
  item: DashWidgetConfig
  index: number
  total: number
  onPatch: (patch: Partial<DashWidgetConfig>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const isCore = item.preset === "core_kpi"
  const xAxis = item.xAxis ?? item.dimension ?? "none"
  const yAxis = item.yAxis ?? item.metric ?? "count"
  const xOpts = xAxesForSource(item.source).map((v) => ({
    value: v,
    label: X_AXIS_OPTIONS.find((d) => d.value === v)?.label ?? v,
  }))
  const yOpts = yAxesForSource(item.source).map((v) => ({
    value: v,
    label: Y_AXIS_OPTIONS.find((m) => m.value === v)?.label ?? v,
  }))
  const chartOpts = CHART_OPTIONS.map((c) => ({
    value: c.value,
    label: c.hint ? `${c.label}（${c.hint}）` : c.label,
  }))
  const recommended = recommendedCharts(xAxis, yAxis)
  const showCartesianAxes = !["kpi", "gauge", "funnel", "pie"].includes(item.chart)

  return (
    <div className="rounded-xl border border-border bg-secondary/20 px-3 py-3 space-y-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={item.visible}
            onCheckedChange={(v) => onPatch({ visible: v === true })}
          />
          <span className="font-medium">{isCore ? "核心指标（组合）" : "图表模块"}</span>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <SearchableSelect
            value={String(item.span)}
            onChange={(v) => onPatch({ span: v === "1" ? 1 : 2 })}
            options={[
              { value: "1", label: "半宽" },
              { value: "2", label: "全宽" },
            ]}
            className="w-[6.5rem]"
            disabled={!item.visible}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="上移"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="下移"
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label="删除"
            disabled={isCore && total <= 1}
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <Input
        value={item.title ?? ""}
        placeholder="标题（可空，自动生成）"
        onChange={(e) => onPatch({ title: e.target.value })}
        disabled={!item.visible}
      />

      {isCore ? (
        <p className="text-xs text-muted-foreground">
          固定展示线索 / 客户 / 需求 / 商机金额 / 签约 / 赢单率。如需单独指标，请添加新图表并选择对应数据源。
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="数据源">
            <SearchableSelect
              value={item.source}
              onChange={(v) => onPatch({ source: v as DashDataSource })}
              options={SOURCE_OPTIONS}
              disabled={!item.visible}
            />
          </Field>
          <Field label="图表类型（全部可选）">
            <SearchableSelect
              value={item.chart}
              onChange={(v) => onPatch({ chart: v as DashChartKind })}
              options={chartOpts}
              disabled={!item.visible}
            />
          </Field>
          <Field label="X 轴（分类）">
            <SearchableSelect
              value={xAxis}
              onChange={(v) => onPatch({ xAxis: v as DashDimension, dimension: v as DashDimension })}
              options={xOpts}
              disabled={!item.visible}
            />
          </Field>
          <Field label="Y 轴（数值）">
            <SearchableSelect
              value={yAxis}
              onChange={(v) => onPatch({ yAxis: v as DashMetric, metric: v as DashMetric })}
              options={yOpts}
              disabled={!item.visible}
            />
          </Field>
          {showCartesianAxes ? (
            <>
              <Field label="X 轴标题（可改）">
                <Input
                  value={item.xAxisLabel ?? ""}
                  placeholder={X_AXIS_OPTIONS.find((o) => o.value === xAxis)?.label}
                  onChange={(e) => onPatch({ xAxisLabel: e.target.value })}
                  disabled={!item.visible}
                />
              </Field>
              <Field label="Y 轴标题（可改）">
                <Input
                  value={item.yAxisLabel ?? ""}
                  placeholder={Y_AXIS_OPTIONS.find((o) => o.value === yAxis)?.label}
                  onChange={(e) => onPatch({ yAxisLabel: e.target.value })}
                  disabled={!item.visible}
                />
              </Field>
            </>
          ) : null}
          {item.chart === "funnel" ? (
            <Field label="漏斗数值含义">
              <SearchableSelect
                value={item.funnelMode ?? "count"}
                onChange={(v) => onPatch({ funnelMode: v as DashFunnelValueMode })}
                options={FUNNEL_MODE_OPTIONS}
                disabled={!item.visible}
              />
            </Field>
          ) : null}
          {item.source === "opportunities" &&
          yAxis !== "win_rate" &&
          yAxis !== "compare_pipeline_won" ? (
            <Field label="商机范围">
              <SearchableSelect
                value={item.oppScope ?? "all"}
                onChange={(v) => onPatch({ oppScope: v as DashOppScope })}
                options={OPP_SCOPE_OPTIONS}
                disabled={!item.visible}
              />
            </Field>
          ) : null}
          {xAxis === "month" ? (
            <Field label="近 N 个月">
              <SearchableSelect
                value={String(item.months ?? 6)}
                onChange={(v) => onPatch({ months: Number(v) })}
                options={[3, 6, 12].map((n) => ({ value: String(n), label: `${n} 个月` }))}
                disabled={!item.visible}
              />
            </Field>
          ) : null}
          {xAxis === "month" && (item.chart === "line" || item.chart === "area") ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
              <Checkbox
                checked={item.showAvgLine !== false}
                onCheckedChange={(v) => onPatch({ showAvgLine: v === true })}
                disabled={!item.visible}
              />
              显示有数据月份的均值线
            </label>
          ) : null}
          <p className="sm:col-span-2 text-[11px] text-muted-foreground">
            推荐图表：
            {recommended
              .map((k) => CHART_OPTIONS.find((c) => c.value === k)?.label ?? k)
              .join("、")}
            （可忽略，任意类型均可选）
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** 兼容旧导出 */
export const DASHBOARD_AVAILABLE_WIDGETS = DEFAULT_DASHBOARD_LAYOUT
