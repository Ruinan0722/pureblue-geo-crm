"use client"

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartShell } from "./chart-shell"
import { CHART_AXIS, CHART_TOOLTIP_STYLE, chartColor } from "./theme"
import type { CartesianChartBaseProps, NamedSeries } from "./types"

export type BarChartProps = CartesianChartBaseProps & {
  /**
   * 多系列时传入；不传则按单系列 `yKey` 渲染。
   */
  series?: NamedSeries[]
  yKey?: string
  color?: string
  /** 横向条形图 */
  layout?: "vertical" | "horizontal"
  /** 堆叠 */
  stacked?: boolean
  /** 圆角柱 */
  radius?: number
}

/** 条形 / 柱状图（支持单系列、多系列、堆叠、横向） */
export function BarChart({
  data,
  series,
  xKey = "name",
  yKey = "value",
  color,
  layout = "horizontal",
  stacked = false,
  radius = 4,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  xAxisLabel,
  yAxisLabel,
  title,
  description,
  className,
  height,
  emptyText,
  loading,
}: BarChartProps) {
  const resolvedSeries: NamedSeries[] =
    series && series.length > 0 ? series : [{ dataKey: yKey, name: yKey, color }]
  const empty = !loading && data.length === 0
  const isVerticalBars = layout === "vertical"
  const bottom = xAxisLabel ? 28 : 0
  const leftPad = yAxisLabel ? 8 : 0

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
      <RechartsBarChart
        data={data}
        layout={isVerticalBars ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: leftPad, bottom }}
      >
        {showGrid ? (
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} vertical={!isVerticalBars} />
        ) : null}
        {isVerticalBars ? (
          <>
            <XAxis
              type="number"
              tick={CHART_AXIS.tick}
              axisLine={false}
              tickLine={false}
              label={
                yAxisLabel
                  ? { value: yAxisLabel, position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--muted-foreground)" }
                  : undefined
              }
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={CHART_AXIS.tick}
              axisLine={{ stroke: CHART_AXIS.stroke }}
              tickLine={false}
              width={72}
              label={
                xAxisLabel
                  ? { value: xAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }
                  : undefined
              }
            />
          </>
        ) : (
          <>
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
          </>
        )}
        {showTooltip ? <Tooltip {...CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} /> : null}
        {showLegend && resolvedSeries.length > 1 ? <Legend /> : null}
        {resolvedSeries.map((s, i) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name || s.dataKey}
            fill={chartColor(i, s.color)}
            radius={radius}
            stackId={stacked ? "stack" : undefined}
          />
        ))}
      </RechartsBarChart>
    </ChartShell>
  )
}
