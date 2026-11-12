"use client"

import { StatCards } from "@/modules/crm/components/ui"
import type { DashResolved } from "@/modules/crm/lib/dashboard-resolve"
import { AreaChart, BarChart, FunnelChart, GaugeChart, LineChart, PieChart } from "@/shared/charts"

export function DashboardWidgetView({ resolved }: { resolved: DashResolved }) {
  if (resolved.kind === "kpi") {
    const cols = resolved.items.length >= 6 ? 6 : resolved.items.length >= 4 ? 4 : 3
    return (
      <div className="space-y-2">
        {resolved.title !== "核心指标" ? (
          <div className="px-0.5">
            <h3 className="text-sm font-medium tracking-tight text-foreground">{resolved.title}</h3>
            {resolved.description ? (
              <p className="text-xs text-muted-foreground">{resolved.description}</p>
            ) : null}
          </div>
        ) : null}
        <StatCards cols={cols as 3 | 4 | 5 | 6} items={resolved.items} />
      </div>
    )
  }

  const {
    chart,
    title,
    description,
    data,
    series,
    emptyText,
    referenceAvg,
    showAvgLine,
    funnelMode,
    xAxisLabel,
    yAxisLabel,
    gaugeUnit,
    height,
  } = resolved

  const refLines =
    showAvgLine && referenceAvg && referenceAvg > 0
      ? [{ y: referenceAvg, label: `均值 ${referenceAvg}`, color: "var(--destructive)" }]
      : undefined

  const axisProps = { xAxisLabel, yAxisLabel }

  switch (chart) {
    case "funnel":
      return (
        <FunnelChart
          title={title}
          description={description}
          data={data}
          height={height ?? 300}
          emptyText={emptyText}
          valueSuffix={funnelMode === "conversion" ? "%" : funnelMode === "amount" ? " 万" : ""}
        />
      )
    case "pie":
      return (
        <PieChart
          title={title}
          description={description}
          data={data}
          height={height ?? 280}
          emptyText={emptyText}
        />
      )
    case "gauge": {
      const row = data[0]
      const value = Number(row?.value ?? 0)
      const settled = Number(row?.settled ?? 0)
      const unit = gaugeUnit ?? "%"
      const isPercent = unit === "%"
      return (
        <GaugeChart
          title={title}
          description={description}
          value={value}
          target={isPercent ? 100 : Math.max(value, 1)}
          unit={unit}
          caption={
            isPercent
              ? settled > 0
                ? `基于 ${settled} 个已完结商机`
                : "暂无已完结商机"
              : yAxisLabel
          }
          height={height ?? 240}
        />
      )
    }
    case "line":
      return (
        <LineChart
          title={title}
          description={description}
          data={data}
          height={height ?? 280}
          emptyText={emptyText}
          referenceLines={refLines}
          {...axisProps}
        />
      )
    case "area":
      return (
        <AreaChart
          title={title}
          description={description}
          data={data}
          showLegend={false}
          height={height ?? 280}
          emptyText={emptyText}
          referenceLines={refLines}
          {...axisProps}
        />
      )
    case "bar_horizontal":
      return (
        <BarChart
          title={title}
          description={description}
          data={data}
          layout="vertical"
          showLegend={false}
          height={height ?? Math.max(260, data.length * 36 + 80)}
          emptyText={emptyText}
          {...axisProps}
        />
      )
    case "bar_grouped":
      return (
        <BarChart
          title={title}
          description={description}
          data={data}
          series={series}
          height={height ?? 300}
          emptyText={emptyText}
          {...axisProps}
        />
      )
    case "bar":
    default:
      return (
        <BarChart
          title={title}
          description={description}
          data={data}
          series={series}
          showLegend={Boolean(series && series.length > 1)}
          height={height ?? 280}
          emptyText={emptyText}
          {...axisProps}
        />
      )
  }
}
