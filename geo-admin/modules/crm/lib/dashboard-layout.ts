/** 数据看板布局持久化（可配置数据源 / 指标 / 维度 / 图表） */

import {
  createWidget,
  defaultDashboardWidgets,
  sanitizeWidget,
  type DashWidgetConfig,
} from "@/modules/crm/lib/dashboard-schema"
import { migrateFromLegacy, readRaw, removeRaw, writeJson } from "@/shared/lib/storage"

export type { DashWidgetConfig }

const STORAGE_KEY = "geo-crm-dashboard-layout-v5"
const LEGACY_STORAGE_KEYS = [
  "geo-crm-dashboard-layout-v4",
  "geo-crm-dashboard-layout-v3",
  "geo-crm-dashboard-layout-v2",
]

export const DEFAULT_DASHBOARD_LAYOUT: DashWidgetConfig[] = defaultDashboardWidgets()

function isWidgetConfig(row: unknown): row is DashWidgetConfig {
  if (!row || typeof row !== "object") return false
  const r = row as Record<string, unknown>
  return typeof r.instanceId === "string" && typeof r.source === "string" && typeof r.chart === "string"
}

/** 旧版固定 id → 新配置（兼容 v2/v3） */
const LEGACY_FIXED: Record<string, Partial<DashWidgetConfig>> = {
  kpi: { preset: "core_kpi", span: 2 },
  win_rate_gauge: {
    source: "opportunities",
    xAxis: "none",
    yAxis: "win_rate",
    chart: "gauge",
    title: "赢单率",
    span: 1,
  },
  opp_funnel: {
    source: "opportunities",
    xAxis: "stage",
    yAxis: "count",
    chart: "funnel",
    title: "商机阶段漏斗",
    span: 1,
  },
  lead_source: {
    source: "leads",
    xAxis: "source",
    yAxis: "count",
    chart: "bar",
    title: "线索来源分布",
    span: 1,
  },
  customer_mix: {
    source: "customers",
    xAxis: "status",
    yAxis: "count",
    chart: "pie",
    title: "客户状态构成",
    span: 1,
  },
  request_mix: {
    source: "requests",
    xAxis: "status",
    yAxis: "count",
    chart: "pie",
    title: "需求状态构成",
    span: 1,
  },
  request_stack: {
    source: "requests",
    xAxis: "status",
    yAxis: "count",
    chart: "pie",
    title: "需求状态构成",
    span: 1,
  },
  lost_reason: {
    source: "opportunities",
    xAxis: "lost_reason",
    yAxis: "count",
    chart: "pie",
    title: "输单原因分布",
    span: 1,
  },
  sales_rank: {
    source: "opportunities",
    xAxis: "owner",
    yAxis: "amount",
    chart: "bar_horizontal",
    oppScope: "won",
    title: "销售赢单排行",
    span: 2,
  },
  contract_trend: {
    source: "contracts",
    xAxis: "month",
    yAxis: "signed_amount",
    chart: "line",
    months: 6,
    title: "签约金额趋势",
    span: 1,
  },
  contract_area: {
    source: "contracts",
    xAxis: "month",
    yAxis: "signed_amount",
    chart: "area",
    months: 6,
    title: "签约体量面积",
    span: 1,
    visible: false,
  },
  pipeline_vs_won: {
    source: "opportunities",
    xAxis: "owner",
    yAxis: "compare_pipeline_won",
    chart: "bar_grouped",
    title: "Pipeline 与赢单对比",
    span: 2,
  },
}

function normalizeStoredWidget(row: DashWidgetConfig): DashWidgetConfig {
  return sanitizeWidget({
    ...row,
    xAxis: row.xAxis ?? row.dimension,
    yAxis: row.yAxis ?? row.metric,
    dimension: row.dimension ?? row.xAxis,
    metric: row.metric ?? row.yAxis,
  })
}

function migrateLegacyRow(row: Record<string, unknown>): DashWidgetConfig | null {
  const id = row.id
  if (typeof id !== "string") return null
  const seed = LEGACY_FIXED[id]
  if (!seed) return null
  const visible = row.visible !== false
  const span = row.span === 1 ? 1 : 2
  if (seed.preset === "core_kpi") {
    return createWidget({ preset: "core_kpi", instanceId: `legacy_${id}`, visible, span })
  }
  return createWidget({
    ...seed,
    instanceId: `legacy_${id}`,
    visible: seed.visible === false ? false : visible,
    span: (seed.span as 1 | 2) ?? span,
  })
}

/** 规范化任意来源的布局数据；不可用时返回 null（调用方自动清除旧值）。 */
function normalizeLayoutRows(parsed: unknown): DashWidgetConfig[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const items: DashWidgetConfig[] = []
  const seen = new Set<string>()
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue
    const rec = row as Record<string, unknown>
    let widget: DashWidgetConfig | null = null
    if (isWidgetConfig(row)) {
      widget =
        rec.preset === "core_kpi"
          ? createWidget({
              preset: "core_kpi",
              instanceId: String(rec.instanceId),
              title: typeof rec.title === "string" ? rec.title : undefined,
              visible: rec.visible !== false,
              span: rec.span === 1 ? 1 : 2,
            })
          : normalizeStoredWidget(row as DashWidgetConfig)
    } else {
      widget = migrateLegacyRow(rec)
    }
    if (!widget || seen.has(widget.instanceId)) continue
    seen.add(widget.instanceId)
    items.push(widget)
  }
  return items.length ? items : null
}

export function loadDashboardLayout(): DashWidgetConfig[] {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w }))
  const raw = readRaw("local", STORAGE_KEY)
  if (raw != null) {
    // v5 存在：可识别则使用；未知/未来格式保留原数据（不破坏、不回退旧版）；
    // 仅 JSON 无法解析的脏数据才清理。
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      removeRaw("local", STORAGE_KEY)
      return DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w }))
    }
    const current = normalizeLayoutRows(parsed)
    if (current) return current
    return DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w }))
  }
  // v5 不存在：一次性迁移旧版本（v2/v3/v4），迁移成功即写入 v5 并删除旧 key
  const migrated = migrateFromLegacy<DashWidgetConfig[]>(
    "local",
    LEGACY_STORAGE_KEYS,
    STORAGE_KEY,
    (raw) => {
      try {
        return normalizeLayoutRows(JSON.parse(raw))
      } catch {
        return null
      }
    },
    (value) => writeJson("local", STORAGE_KEY, value),
  )
  if (migrated) return migrated
  return DEFAULT_DASHBOARD_LAYOUT.map((w) => ({ ...w }))
}

export function saveDashboardLayout(layout: DashWidgetConfig[]) {
  if (typeof window === "undefined") return
  writeJson("local", STORAGE_KEY, layout)
}
