/**
 * 将看板 widget 配置解析为可渲染的图表载荷
 */

import {
  CONTRACT_STATUS_META,
  CUSTOMER_STATUSES,
  LEAD_SOURCES,
  normalizeLeadSource,
  OPP_FLOW_STAGES,
  OPP_STAGE_META,
  contractOwnerNames,
  customerStatusMeta,
  normalizeCustomerStatus,
  normalizeOppStage,
  wan,
  type Contract,
  type Customer,
  type Lead,
  type Opportunity,
  type OppStage,
} from "@/modules/crm/lib/crm-data"
import type { RequestStats } from "@/modules/requests/services/requests-api"
import { STATUS_META } from "@/modules/requests/lib/status"
import type {
  DashChartKind,
  DashFunnelValueMode,
  DashOppScope,
  DashWidgetConfig,
} from "@/modules/crm/lib/dashboard-schema"
import { defaultAxisLabel } from "@/modules/crm/lib/dashboard-schema"
import type { ChartDatum, NamedSeries } from "@/shared/charts"

export type DashResolveContext = {
  leads: Lead[]
  customers: Customer[]
  opportunities: Opportunity[]
  contracts: Contract[]
  requestStats: RequestStats
}

export type DashResolvedKpi = {
  kind: "kpi"
  title: string
  description?: string
  items: { label: string; value: string | number; tone?: string }[]
}

export type DashResolvedChart = {
  kind: "chart"
  chart: DashChartKind
  title: string
  description?: string
  data: ChartDatum[]
  series?: NamedSeries[]
  emptyText?: string
  referenceAvg?: number
  showAvgLine?: boolean
  funnelMode?: DashFunnelValueMode
  xAxisLabel?: string
  yAxisLabel?: string
  /** 仪表盘单位后缀 */
  gaugeUnit?: string
  height?: number
}

export type DashResolved = DashResolvedKpi | DashResolvedChart

function monthKey(iso: string): string | null {
  const d = (iso || "").slice(0, 7)
  return /^\d{4}-\d{2}$/.test(d) ? d : null
}

function lastNMonths(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

function monthLabel(ym: string): string {
  return `${Number(ym.slice(5))}月`
}

function toWan(n: number): number {
  return Math.round((n / 10000) * 10) / 10
}

/** 金额兜底：接口历史数据可能缺失 amount，求和一律按数字处理，避免 NaN */
function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function filterOpps(opps: Opportunity[], scope: DashOppScope | undefined): Opportunity[] {
  const s = scope ?? "all"
  if (s === "open") return opps.filter((o) => o.stage !== "won" && o.stage !== "lost")
  if (s === "won") return opps.filter((o) => o.stage === "won")
  if (s === "lost") return opps.filter((o) => o.stage === "lost")
  return opps
}

function autoTitle(cfg: DashWidgetConfig): string {
  if (cfg.title?.trim()) return cfg.title.trim()
  const xAxis = cfg.xAxis ?? cfg.dimension ?? "none"
  const yAxis = cfg.yAxis ?? cfg.metric ?? "count"
  const parts: string[] = []
  const src =
    { leads: "线索", customers: "客户", opportunities: "商机", contracts: "合同", requests: "需求" }[
      cfg.source
    ] ?? ""
  const metric =
    {
      count: "数量",
      amount: "金额",
      win_rate: "赢单率",
      pipeline_amount: "进行中金额",
      signed_amount: "已签约金额",
      compare_pipeline_won: "Pipeline vs 赢单",
    }[yAxis] ?? ""
  const dim =
    {
      none: "",
      stage: "按阶段",
      source: "按来源",
      owner: "按负责人",
      status: "按状态",
      month: "按月",
      lost_reason: "按输单原因",
    }[xAxis] ?? ""
  parts.push(src + metric)
  if (dim) parts.push(dim)
  return parts.filter(Boolean).join(" · ")
}

function axesOf(cfg: DashWidgetConfig) {
  const xAxis = cfg.xAxis ?? cfg.dimension ?? "none"
  const yAxis = cfg.yAxis ?? cfg.metric ?? "count"
  return {
    xAxis,
    yAxis,
    xLabel: defaultAxisLabel("x", { ...cfg, xAxis, yAxis }),
    yLabel: defaultAxisLabel("y", { ...cfg, xAxis, yAxis }),
  }
}

function avgOfPositive(values: number[]): number {
  const xs = values.filter((v) => v > 0)
  if (xs.length === 0) return 0
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}

function funnelRows(
  opportunities: Opportunity[],
  mode: DashFunnelValueMode,
): ChartDatum[] {
  const stages = OPP_FLOW_STAGES
  const counts = stages.map((stage) => opportunities.filter((o) => normalizeOppStage(o.stage) === stage).length)
  const amounts = stages.map((stage) =>
    opportunities.filter((o) => normalizeOppStage(o.stage) === stage).reduce((s, o) => s + toAmount(o.amount), 0),
  )

  return stages.map((stage, i) => {
    const name = OPP_STAGE_META[stage].label
    if (mode === "amount") {
      return { name, value: toWan(amounts[i]!), amount: amounts[i], count: counts[i] }
    }
    if (mode === "conversion") {
      const prev = i === 0 ? counts[0]! : counts[i - 1]!
      const cur = counts[i]!
      const rate = i === 0 ? 100 : prev > 0 ? Math.round((cur / prev) * 100) : 0
      return { name, value: rate, count: cur, conversion: rate }
    }
    return { name, value: counts[i]!, amount: amounts[i], count: counts[i] }
  })
}

export function resolveDashboardWidget(
  cfg: DashWidgetConfig,
  ctx: DashResolveContext,
): DashResolved {
  if (cfg.preset === "core_kpi") return resolveCoreKpi(ctx)

  const title = autoTitle(cfg)
  const months = cfg.months ?? 6
  const opps = filterOpps(ctx.opportunities, cfg.oppScope)
  const { xAxis, yAxis, xLabel, yLabel } = axesOf(cfg)

  const withAxes = (chart: DashResolvedChart): DashResolvedChart => ({
    ...chart,
    xAxisLabel: chart.xAxisLabel ?? xLabel,
    yAxisLabel: chart.yAxisLabel ?? yLabel,
  })

  // —— 赢单率 ——
  if (yAxis === "win_rate") {
    const won = ctx.opportunities.filter((o) => o.stage === "won").length
    const lost = ctx.opportunities.filter((o) => o.stage === "lost").length
    const settled = won + lost
    const rate = settled ? Math.round((won / settled) * 100) : 0
    if (cfg.chart === "kpi") {
      return {
        kind: "kpi",
        title,
        description: settled ? `基于 ${settled} 个已完结商机` : "暂无已完结商机",
        items: [{ label: "赢单率", value: `${rate}%`, tone: "text-amber-600" }],
      }
    }
    return withAxes({
      kind: "chart",
      chart: cfg.chart === "bar" || cfg.chart === "line" || cfg.chart === "area" || cfg.chart === "pie"
        ? cfg.chart
        : "gauge",
      title,
      description: "赢 /（赢+输）",
      data:
        cfg.chart === "bar" || cfg.chart === "line" || cfg.chart === "area" || cfg.chart === "pie"
          ? [{ name: "赢单率", value: rate }]
          : [{ name: "赢单率", value: rate, settled }],
      gaugeUnit: "%",
      emptyText: "暂无已完结商机",
      height: 240,
    })
  }

  // —— 合计类（X=无）——
  if (xAxis === "none") {
    let raw = 0
    let display: string | number = 0
    let tone: string | undefined
    if (yAxis === "pipeline_amount") {
      raw = ctx.opportunities
        .filter((o) => o.stage !== "won" && o.stage !== "lost")
        .reduce((s, o) => s + toAmount(o.amount), 0)
      display = wan(raw)
      tone = "text-primary"
    } else if (yAxis === "signed_amount") {
      raw = ctx.contracts.filter((c) => c.status === "signed").reduce((s, c) => s + toAmount(c.amount), 0)
      display = wan(raw)
      tone = "text-emerald-600"
    } else if (yAxis === "amount") {
      raw =
        cfg.source === "opportunities"
          ? opps.reduce((s, o) => s + toAmount(o.amount), 0)
          : ctx.contracts.reduce((s, c) => s + toAmount(c.amount), 0)
      display = wan(raw)
      tone = "text-primary"
    } else {
      raw =
        cfg.source === "leads"
          ? ctx.leads.length
          : cfg.source === "customers"
            ? ctx.customers.length
            : cfg.source === "opportunities"
              ? opps.length
              : cfg.source === "contracts"
                ? ctx.contracts.length
                : ctx.requestStats.total
      display = raw
    }

    if (cfg.chart === "kpi" || cfg.chart === "gauge") {
      if (cfg.chart === "gauge") {
        const isWan =
          yAxis === "amount" || yAxis === "pipeline_amount" || yAxis === "signed_amount"
        return withAxes({
          kind: "chart",
          chart: "gauge",
          title,
          data: [
            {
              name: title,
              value: isWan ? toWan(typeof raw === "number" ? raw : 0) : Number(display),
              settled: 0,
            },
          ],
          gaugeUnit: isWan ? "万" : "",
          height: 240,
        })
      }
      return {
        kind: "kpi",
        title,
        items: [{ label: yLabel, value: display, tone }],
      }
    }

    const pointValue =
      yAxis === "amount" || yAxis === "pipeline_amount" || yAxis === "signed_amount"
        ? toWan(raw)
        : raw
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: `${xLabel} · ${yLabel}`,
      data: [{ name: "合计", value: pointValue }],
      height: 280,
    })
  }

  // —— Pipeline vs 赢单（双系列）——
  if (yAxis === "compare_pipeline_won") {
    const map = new Map<string, { pipeline: number; won: number }>()
    ctx.opportunities.forEach((o) => {
      const cur = map.get(o.owner) ?? { pipeline: 0, won: 0 }
      if (o.stage === "won") cur.won += toAmount(o.amount)
      else if (o.stage !== "lost") cur.pipeline += toAmount(o.amount)
      map.set(o.owner, cur)
    })
    const data = Array.from(map.entries())
      .map(([name, v]) => ({
        name: name || "未分配",
        pipeline: toWan(v.pipeline),
        won: toWan(v.won),
      }))
      .sort((a, b) => b.won + b.pipeline - (a.won + a.pipeline))
      .slice(0, 10)
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: "单位：万元",
      data,
      series: [
        { dataKey: "pipeline", name: "进行中" },
        { dataKey: "won", name: "已赢单" },
      ],
      emptyText: "暂无商机数据",
      height: 300,
    })
  }

  // —— 漏斗（图表类型=漏斗，或 X=阶段且用户选了漏斗）——
  if (cfg.chart === "funnel") {
    const mode: DashFunnelValueMode =
      cfg.funnelMode ?? (yAxis === "amount" || yAxis === "pipeline_amount" ? "amount" : "count")
    const data = funnelRows(ctx.opportunities, mode)
    const desc =
      mode === "amount"
        ? "外形按阶段路径；数值为各阶段商机金额（万元）"
        : mode === "conversion"
          ? "外形按阶段路径；数值为相对上一阶段转化率（%）"
          : "外形按阶段路径；数值为各阶段当前商机数"
    return withAxes({
      kind: "chart",
      chart: "funnel",
      title,
      description: desc,
      data,
      funnelMode: mode,
      height: 300,
    })
  }

  const useWan =
    yAxis === "amount" || yAxis === "pipeline_amount" || yAxis === "signed_amount"

  // —— 按阶段 ——
  if (xAxis === "stage") {
    const stages = OPP_FLOW_STAGES as OppStage[]
    const data = stages.map((stage) => {
      const items = opps.filter((o) => normalizeOppStage(o.stage) === stage)
      const value = useWan ? toWan(items.reduce((s, o) => s + toAmount(o.amount), 0)) : items.length
      return { name: OPP_STAGE_META[stage].label, value }
    })
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: useWan ? "单位：万元" : "单位：个",
      data: data.filter((d) => (cfg.chart === "pie" ? d.value > 0 : true)),
      height: 280,
    })
  }

  // —— 按来源 ——
  if (xAxis === "source") {
    const map = new Map<string, number>()
    if (cfg.source === "leads") {
      ctx.leads.forEach((l) => {
        const src = normalizeLeadSource(l.source) || l.source || "未填写"
        map.set(src, (map.get(src) ?? 0) + 1)
      })
    } else {
      ctx.customers.forEach((c) => {
        const src = normalizeLeadSource(c.source) || c.source || "未填写"
        map.set(src, (map.get(src) ?? 0) + 1)
      })
    }
    const ordered = LEAD_SOURCES.map((s) => ({ name: s, value: map.get(s) ?? 0 })).filter(
      (x) => x.value > 0,
    )
    const extras = Array.from(map.entries())
      .filter(([k]) => !(LEAD_SOURCES as readonly string[]).includes(k))
      .map(([name, value]) => ({ name, value }))
    const data = [...ordered, ...extras].sort((a, b) => b.value - a.value).slice(0, 10)
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: "按渠道统计数量",
      data,
      emptyText: "暂无来源数据",
      height: 280,
    })
  }

  // —— 按状态 ——
  if (xAxis === "status") {
    let data: ChartDatum[] = []
    if (cfg.source === "customers") {
      data = CUSTOMER_STATUSES.map((status) => ({
        name: customerStatusMeta(status).label,
        value: ctx.customers.filter((c) => normalizeCustomerStatus(c.status) === status).length,
      }))
    } else if (cfg.source === "contracts") {
      data = (Object.keys(CONTRACT_STATUS_META) as (keyof typeof CONTRACT_STATUS_META)[]).map(
        (status) => ({
          name: CONTRACT_STATUS_META[status].label,
          value: ctx.contracts.filter((c) => c.status === status).length,
        }),
      )
    } else {
      data = [
        { name: STATUS_META.submitted.label, value: ctx.requestStats.submitted },
        { name: STATUS_META.pending_review.label, value: ctx.requestStats.pending },
        { name: STATUS_META.supplement.label, value: ctx.requestStats.supplement },
        { name: STATUS_META.confirmed.label, value: ctx.requestStats.confirmed },
        { name: STATUS_META.in_project.label, value: ctx.requestStats.inProject },
      ]
    }
    const filtered = data.filter((d) => Number(d.value) > 0)
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: "当前可见范围内的状态构成",
      data: filtered,
      emptyText: "暂无状态数据",
      height: 280,
    })
  }

  // —— 输单原因 ——
  if (xAxis === "lost_reason") {
    const map = new Map<string, number>()
    ctx.opportunities.forEach((o) => {
      if (o.stage !== "lost") return
      const key = (o.lostReasonL1 || o.lostReason || "未填写").trim() || "未填写"
      map.set(key, (map.get(key) ?? 0) + 1)
    })
    const data = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: "按一级原因统计已输单商机",
      data,
      emptyText: "暂无输单数据",
      height: 280,
    })
  }

  // —— 按负责人 ——
  if (xAxis === "owner") {
    const map = new Map<string, number>()
    const bump = (owner: string, delta: number) => {
      const key = owner || "未分配"
      map.set(key, (map.get(key) ?? 0) + delta)
    }
    if (cfg.source === "opportunities") {
      opps.forEach((o) => {
        if (yAxis === "pipeline_amount") {
          if (o.stage === "won" || o.stage === "lost") return
          bump(o.owner, toAmount(o.amount))
        } else if (yAxis === "amount") {
          bump(o.owner, toAmount(o.amount))
        } else {
          bump(o.owner, 1)
        }
      })
    } else if (cfg.source === "contracts") {
      ctx.contracts.forEach((c) => {
        const owners = contractOwnerNames(c)
        const list = owners.length ? owners : ["未分配"]
        list.forEach((owner) => {
          if (yAxis === "signed_amount" || yAxis === "amount") {
            if (yAxis === "signed_amount" && c.status !== "signed") return
            bump(owner, toAmount(c.amount))
          } else {
            bump(owner, 1)
          }
        })
      })
    } else if (cfg.source === "leads") {
      ctx.leads.forEach((l) => bump(l.sales || l.sdr || "未分配", 1))
    } else {
      ctx.customers.forEach((c) => bump(c.owner, 1))
    }
    const data = Array.from(map.entries())
      .map(([name, value]) => ({ name, value: useWan ? toWan(value) : value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: useWan ? "单位：万元" : "单位：个",
      data,
      emptyText: "暂无负责人数据",
      height: Math.max(260, data.length * 36 + 80),
    })
  }

  // —— 按月 ——
  if (xAxis === "month") {
    const keys = lastNMonths(months)
    const map = new Map<string, number>()
    for (const m of keys) map.set(m, 0)

    if (cfg.source === "contracts") {
      ctx.contracts.forEach((c) => {
        if (yAxis === "signed_amount" || yAxis === "amount") {
          if (c.status !== "signed" && yAxis === "signed_amount") return
          const key = monthKey(c.dualSignDate || c.effectiveDate || c.createdAt)
          if (!key || !map.has(key)) return
          map.set(key, (map.get(key) ?? 0) + toAmount(c.amount))
        } else {
          const key = monthKey(c.createdAt)
          if (!key || !map.has(key)) return
          map.set(key, (map.get(key) ?? 0) + 1)
        }
      })
    } else if (cfg.source === "opportunities") {
      opps.forEach((o) => {
        const key = monthKey(o.createdAt)
        if (!key || !map.has(key)) return
        if (yAxis === "amount" || yAxis === "pipeline_amount") {
          map.set(key, (map.get(key) ?? 0) + toAmount(o.amount))
        } else {
          map.set(key, (map.get(key) ?? 0) + 1)
        }
      })
    } else {
      ctx.leads.forEach((l) => {
        const key = monthKey(l.createdAt || l.firstContactDate || "")
        if (!key || !map.has(key)) return
        map.set(key, (map.get(key) ?? 0) + 1)
      })
    }

    const data = keys.map((m) => ({
      name: monthLabel(m),
      value: useWan ? toWan(map.get(m) ?? 0) : (map.get(m) ?? 0),
    }))
    const avg = avgOfPositive(data.map((d) => Number(d.value)))
    return withAxes({
      kind: "chart",
      chart: cfg.chart,
      title,
      description: useWan
        ? `近 ${months} 个月 · 万元${cfg.showAvgLine !== false ? "（虚线为有数据月均值）" : ""}`
        : `近 ${months} 个月 · 数量`,
      data,
      referenceAvg: avg,
      showAvgLine: cfg.showAvgLine !== false,
      height: 280,
    })
  }

  return withAxes({
    kind: "chart",
    chart: cfg.chart,
    title,
    description: "当前 X/Y 轴组合暂无匹配数据，请调整轴字段",
    data: [],
    emptyText: "请调整数据源 / X 轴 / Y 轴 / 图表类型",
  })
}

/** 默认「核心指标」多卡：单独合成，不走单源配置 */
export function resolveCoreKpi(ctx: DashResolveContext): DashResolvedKpi {
  const won = ctx.opportunities.filter((o) => o.stage === "won")
  const lost = ctx.opportunities.filter((o) => o.stage === "lost")
  const settled = won.length + lost.length
  const pipeline = ctx.opportunities
    .filter((o) => o.stage !== "won" && o.stage !== "lost")
    .reduce((s, o) => s + toAmount(o.amount), 0)
  const signedAmount = ctx.contracts
    .filter((c) => c.status === "signed")
    .reduce((s, c) => s + toAmount(c.amount), 0)
  const winRate = settled ? Math.round((won.length / settled) * 100) : 0
  return {
    kind: "kpi",
    title: "核心指标",
    items: [
      { label: "线索总数", value: ctx.leads.length },
      { label: "客户总数", value: ctx.customers.length },
      { label: "需求单", value: ctx.requestStats.total },
      { label: "商机金额", value: wan(pipeline), tone: "text-primary" },
      { label: "已签约金额", value: wan(signedAmount), tone: "text-emerald-600" },
      {
        label: "赢单率",
        value: settled === 0 ? "—" : `${winRate}%`,
        tone: "text-amber-600",
      },
    ],
  }
}
