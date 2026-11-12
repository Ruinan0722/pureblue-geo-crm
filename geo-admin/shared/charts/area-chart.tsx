"use client"

import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartShell } from "./chart-shell"
import { ChartReferenceLines } from "./reference-lines"
import { CHART_AXIS, CHART_TOOLTIP_STYLE, chartColor } from "./theme"
import type { CartesianChartBaseProps, NamedSeries } from "./types"

export type AreaChartProps = CartesianChartBaseProps & {
  series?: NamedSeries[]
  yKey?: string
  color?: string
  stacked?: boolean
  smooth?: boolean
}

/** 面积图（单系列或多系列；支持平行于 X 轴的指标线） */
export function AreaChart({
  data,
  series,
  xKey = "name",
  yKey = "value",
  color,
  stacked = false,
  smooth = true,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  referenceLines,
  xAxisLabel,
  yAxisLabel,
  title,
  description,
  className,
  height,
  emptyText,
  loading,
}: AreaChartProps) {
  const resolved: NamedSeries[] =
    series && series.length > 0 ? series : [{ dataKey: yKey, name: yKey, color }]
  const empty = !loading && data.length === 0

  return (
    <ChartShell
      title={title}
      description={description}
      className={className}
      height={height}
      emptyText={emptyText}
      loading={loading}
      empty={empty}
    >
      <RechartsAreaChart
        data={data}
        margin={{ top: 12, right: 16, left: yAxisLabel ? 8 : 0, bottom: xAxisLabel ? 28 : 0 }}
      >
        {showGrid ? (
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} vertical={false} />
        ) : null}
        <XAxis
          dataKey={xKey}
          tick={CHART_AXIS.tick}
          axisLine={{ stroke: CHART_AXIS.stroke }}
          tickLine={false}
          label={
            xAxisLabel
              ? { value: xAxisLabel, position: "insideBottom", offset: -4, fontSize: 11, fill: "var(--muted-foreground)" }
              : undefined
          }
        />
        <YAxis
          tick={CHART_AXIS.tick}
          axisLine={false}
          tickLine={false}
          width={yAxisLabel ? 48 : 40}
          label={
            yAxisLabel
              ? { value: yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }
              : undefined
          }
        />
        {showTooltip ? <Tooltip {...CHART_TOOLTIP_STYLE} /> : null}
        {showLegend && resolved.length > 1 ? <Legend /> : null}
        <ChartReferenceLines lines={referenceLines} />
        {resolved.map((s, i) => {
          const fill = chartColor(i, s.color)
          return (
            <Area
              key={s.dataKey}
              type={smooth ? "monotone" : "linear"}
              dataKey={s.dataKey}
              name={s.name || s.dataKey}
              stroke={fill}
              fill={fill}
              fillOpacity={0.18}
              strokeWidth={2}
              stackId={stacked ? "stack" : undefined}
            />
          )
        })}
      </RechartsAreaChart>
    </ChartShell>
  )
}
