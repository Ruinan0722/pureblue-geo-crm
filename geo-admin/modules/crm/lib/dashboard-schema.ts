/**
 * 数据看板配置：数据源 + X/Y 轴 + 图表类型（图表类型全量可选）。
 */

export type DashDataSource =
  | "leads"
  | "customers"
  | "opportunities"
  | "contracts"
  | "requests"

/** Y 轴数值指标 */
export type DashMetric =
  | "count"
  | "amount"
  | "win_rate"
  | "pipeline_amount"
  | "signed_amount"
  | "compare_pipeline_won"

/** X 轴分类维度 */
export type DashDimension =
  | "none"
  | "stage"
  | "source"
  | "owner"
  | "status"
  | "month"
  | "lost_reason"

export type DashChartKind =
  | "kpi"
  | "funnel"
  | "bar"
  | "bar_horizontal"
  | "bar_grouped"
  | "line"
  | "area"
  | "pie"
  | "gauge"

export type DashFunnelValueMode = "count" | "amount" | "conversion"
export type DashOppScope = "all" | "open" | "won" | "lost"

export type DashWidgetConfig = {
  instanceId: string
  title?: string
  preset?: "core_kpi"
  source: DashDataSource
  /** X 轴：分类 / 分组字段 */
  xAxis: DashDimension
  /** Y 轴：主数值指标 */
  yAxis: DashMetric
  /**
   * 第二 Y 系列（分组柱 / 多指标对比）。
   * 设为 none 或不传表示单系列。
   */
  yAxis2?: DashMetric | "none"
  chart: DashChartKind
  /** 自定义轴标题（展示在图上） */
  xAxisLabel?: string
  yAxisLabel?: string
  months?: number
  funnelMode?: DashFunnelValueMode
  oppScope?: DashOppScope
  showAvgLine?: boolean
  span: 1 | 2
  visible: boolean

  /** @deprecated 兼容旧字段 → xAxis */
  dimension?: DashDimension
  /** @deprecated 兼容旧字段 → yAxis */
  metric?: DashMetric
}

export const SOURCE_OPTIONS: { value: DashDataSource; label: string }[] = [
  { value: "leads", label: "线索" },
  { value: "customers", label: "客户" },
  { value: "opportunities", label: "商机" },
  { value: "contracts", label: "合同" },
  { value: "requests", label: "需求单" },
]

export const Y_AXIS_OPTIONS: { value: DashMetric; label: string; sources: DashDataSource[] }[] = [
  { value: "count", label: "数量", sources: ["leads", "customers", "opportunities", "contracts", "requests"] },
  { value: "amount", label: "金额（万元）", sources: ["opportunities", "contracts"] },
  { value: "pipeline_amount", label: "进行中商机金额（万元）", sources: ["opportunities"] },
  { value: "signed_amount", label: "已签约金额（万元）", sources: ["contracts"] },
  { value: "win_rate", label: "赢单率（%）", sources: ["opportunities"] },
  {
    value: "compare_pipeline_won",
    label: "进行中 + 已赢单（双系列）",
    sources: ["opportunities"],
  },
]

/** @deprecated 使用 Y_AXIS_OPTIONS */
export const METRIC_OPTIONS = Y_AXIS_OPTIONS

export const X_AXIS_OPTIONS: {
  value: DashDimension
  label: string
  sources: DashDataSource[]
}[] = [
  { value: "none", label: "无（合计 / 单值）", sources: ["leads", "customers", "opportunities", "contracts", "requests"] },
  { value: "stage", label: "商机阶段", sources: ["opportunities"] },
  { value: "source", label: "来源渠道", sources: ["leads", "customers"] },
  { value: "owner", label: "负责人", sources: ["opportunities", "contracts", "leads", "customers"] },
  { value: "status", label: "状态", sources: ["customers", "contracts", "requests"] },
  { value: "month", label: "月份（近 N 月）", sources: ["contracts", "opportunities", "leads"] },
  { value: "lost_reason", label: "输单原因", sources: ["opportunities"] },
]

/** @deprecated 使用 X_AXIS_OPTIONS */
export const DIMENSION_OPTIONS = X_AXIS_OPTIONS

/** 图表类型：配置面板始终展示全部，不按组合裁剪 */
export const CHART_OPTIONS: { value: DashChartKind; label: string; hint?: string }[] = [
  { value: "kpi", label: "指标卡", hint: "适合 X=无 的合计" },
  { value: "gauge", label: "仪表盘", hint: "适合赢单率等比例" },
  { value: "funnel", label: "漏斗", hint: "适合 X=商机阶段" },
  { value: "bar", label: "柱状图", hint: "X=分类，Y=数值" },
  { value: "bar_horizontal", label: "横向条形", hint: "分类在纵轴，数值在横轴" },
  { value: "bar_grouped", label: "分组柱状", hint: "适合双 Y 系列" },
  { value: "line", label: "折线图", hint: "适合 X=月份" },
  { value: "area", label: "面积图", hint: "适合 X=月份" },
  { value: "pie", label: "环图", hint: "X=分类占比" },
]

export function yAxesForSource(source: DashDataSource): DashMetric[] {
  return Y_AXIS_OPTIONS.filter((m) => m.sources.includes(source)).map((m) => m.value)
}

/** @deprecated */
export function metricsForSource(source: DashDataSource): DashMetric[] {
  return yAxesForSource(source)
}

export function xAxesForSource(source: DashDataSource): DashDimension[] {
  return X_AXIS_OPTIONS.filter((d) => d.sources.includes(source)).map((d) => d.value)
}

/** @deprecated 不再按指标裁剪 X；仅按数据源 */
export function dimensionsFor(source: DashDataSource, _metric?: DashMetric): DashDimension[] {
  return xAxesForSource(source)
}

/** 推荐图表（仅提示，不强制） */
export function recommendedCharts(
  xAxis: DashDimension,
  yAxis: DashMetric,
): DashChartKind[] {
  if (yAxis === "win_rate" && xAxis === "none") return ["gauge", "kpi"]
  if (yAxis === "compare_pipeline_won") return ["bar_grouped", "bar"]
  if (xAxis === "none") return ["kpi", "gauge"]
  if (xAxis === "stage") return ["funnel", "bar", "pie"]
  if (xAxis === "month") return ["line", "area", "bar"]
  if (xAxis === "owner") return ["bar_horizontal", "bar", "pie"]
  return ["bar", "pie", "line"]
}

/** @deprecated */
export function chartsFor(
  _source: DashDataSource,
  metric: DashMetric,
  dimension: DashDimension,
): DashChartKind[] {
  return recommendedCharts(dimension, metric)
}

function normalizeAxes(partial: Partial<DashWidgetConfig>): {
  xAxis: DashDimension
  yAxis: DashMetric
} {
  const source = partial.source ?? "opportunities"
  const xAxisRaw = partial.xAxis ?? partial.dimension ?? "none"
  const yAxisRaw = partial.yAxis ?? partial.metric ?? "count"
  const xs = xAxesForSource(source)
  const ys = yAxesForSource(source)
  return {
    xAxis: xs.includes(xAxisRaw) ? xAxisRaw : (xs[0] ?? "none"),
    yAxis: ys.includes(yAxisRaw) ? yAxisRaw : (ys[0] ?? "count"),
  }
}

/**
 * 校正：只保证 X/Y 属于当前数据源；图表类型完全保留用户选择。
 */
export function sanitizeWidget(partial: DashWidgetConfig): DashWidgetConfig {
  const source = partial.source
  const { xAxis, yAxis } = normalizeAxes(partial)
  const y2raw = partial.yAxis2
  const ys = yAxesForSource(source)
  const yAxis2 =
    y2raw && y2raw !== "none" && ys.includes(y2raw) && y2raw !== yAxis ? y2raw : "none"

  // 双系列指标时强制视为分组语义，但仍允许用户选其他图
  const chart = partial.chart || "bar"

  return {
    ...partial,
    source,
    xAxis,
    yAxis,
    yAxis2,
    // 同步旧字段，便于 resolve 过渡
    dimension: xAxis,
    metric: yAxis,
    chart,
    months: partial.months && partial.months > 0 ? Math.min(24, partial.months) : 6,
    funnelMode:
      partial.funnelMode ??
      (yAxis === "amount" || yAxis === "signed_amount" || yAxis === "pipeline_amount"
        ? "amount"
        : "count"),
    oppScope: partial.oppScope ?? "all",
    showAvgLine: partial.showAvgLine ?? true,
    xAxisLabel: partial.xAxisLabel?.trim() || undefined,
    yAxisLabel: partial.yAxisLabel?.trim() || undefined,
    span: partial.span === 1 ? 1 : 2,
    visible: partial.visible !== false,
  }
}

export function newWidgetId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function createWidget(seed?: Partial<DashWidgetConfig>): DashWidgetConfig {
  if (seed?.preset === "core_kpi") {
    return {
      instanceId: seed.instanceId ?? newWidgetId(),
      title: seed.title ?? "核心指标",
      preset: "core_kpi",
      source: "opportunities",
      xAxis: "none",
      yAxis: "count",
      dimension: "none",
      metric: "count",
      chart: "kpi",
      span: 2,
      visible: seed.visible ?? true,
    }
  }
  return sanitizeWidget({
    instanceId: seed?.instanceId ?? newWidgetId(),
    title: seed?.title,
    source: seed?.source ?? "opportunities",
    xAxis: seed?.xAxis ?? seed?.dimension ?? "stage",
    yAxis: seed?.yAxis ?? seed?.metric ?? "count",
    yAxis2: seed?.yAxis2,
    dimension: seed?.dimension,
    metric: seed?.metric,
    chart: seed?.chart ?? "bar",
    xAxisLabel: seed?.xAxisLabel,
    yAxisLabel: seed?.yAxisLabel,
    months: seed?.months ?? 6,
    funnelMode: seed?.funnelMode,
    oppScope: seed?.oppScope,
    showAvgLine: seed?.showAvgLine,
    span: seed?.span ?? 1,
    visible: seed?.visible ?? true,
  })
}

export function defaultAxisLabel(
  axis: "x" | "y",
  cfg: Pick<DashWidgetConfig, "xAxis" | "yAxis" | "xAxisLabel" | "yAxisLabel">,
): string {
  if (axis === "x") {
    if (cfg.xAxisLabel?.trim()) return cfg.xAxisLabel.trim()
    return X_AXIS_OPTIONS.find((o) => o.value === cfg.xAxis)?.label ?? "分类"
  }
  if (cfg.yAxisLabel?.trim()) return cfg.yAxisLabel.trim()
  return Y_AXIS_OPTIONS.find((o) => o.value === cfg.yAxis)?.label ?? "数值"
}

export function defaultDashboardWidgets(): DashWidgetConfig[] {
  return [
    createWidget({ preset: "core_kpi", instanceId: "preset_kpi" }),
    createWidget({
      instanceId: "preset_funnel",
      source: "opportunities",
      xAxis: "stage",
      yAxis: "count",
      chart: "funnel",
      funnelMode: "count",
      xAxisLabel: "商机阶段",
      yAxisLabel: "商机数",
      title: "商机阶段漏斗",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_win_gauge",
      source: "opportunities",
      xAxis: "none",
      yAxis: "win_rate",
      chart: "gauge",
      title: "赢单率",
      span: 1,
      visible: false,
    }),
    createWidget({
      instanceId: "preset_lead_source",
      source: "leads",
      xAxis: "source",
      yAxis: "count",
      chart: "bar",
      xAxisLabel: "来源",
      yAxisLabel: "线索数",
      title: "线索来源分布",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_customer_mix",
      source: "customers",
      xAxis: "status",
      yAxis: "count",
      chart: "pie",
      title: "客户状态构成",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_request_mix",
      source: "requests",
      xAxis: "status",
      yAxis: "count",
      chart: "pie",
      title: "需求状态构成",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_lost",
      source: "opportunities",
      xAxis: "lost_reason",
      yAxis: "count",
      chart: "pie",
      title: "输单原因分布",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_sales_rank",
      source: "opportunities",
      xAxis: "owner",
      yAxis: "amount",
      chart: "bar_horizontal",
      oppScope: "won",
      xAxisLabel: "负责人",
      yAxisLabel: "赢单金额（万）",
      title: "销售赢单排行",
      span: 2,
    }),
    createWidget({
      instanceId: "preset_contract_trend",
      source: "contracts",
      xAxis: "month",
      yAxis: "signed_amount",
      chart: "line",
      months: 6,
      showAvgLine: true,
      xAxisLabel: "月份",
      yAxisLabel: "签约金额（万）",
      title: "签约金额趋势",
      span: 1,
    }),
    createWidget({
      instanceId: "preset_pipeline_vs_won",
      source: "opportunities",
      xAxis: "owner",
      yAxis: "compare_pipeline_won",
      chart: "bar_grouped",
      xAxisLabel: "负责人",
      yAxisLabel: "金额（万）",
      title: "Pipeline 与赢单对比",
      span: 2,
    }),
  ]
}
