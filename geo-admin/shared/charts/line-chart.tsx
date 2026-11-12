"use client"

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartShell } from "./chart-shell"
import { ChartReferenceLines } from "./reference-lines"
import { CHART_AXIS, CHART_TOOLTIP_STYLE, chartColor } from "./theme"
import type { CartesianChartBaseProps } from "./types"

export type LineChartProps = CartesianChartBaseProps & {
  /** Y 轴字段，默认 value */
  yKey?: string
  /** 折线颜色 */
  color?: string
  /** 曲线平滑 */
  smooth?: boolean
  /** 显示数据点 */
  showDots?: boolean
}

/** 单系列折线图（支持平行于 X 轴的指标线） */
export function LineChart({
  data,
  xKey = "name",
  yKey = "value",
  color,
  smooth = true,
  showDots = false,
  showGrid = true,
  showLegend = false,
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
}: LineChartProps) {
  const empty = !loading && data.length === 0
  const stroke = chartColor(0, color)

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
      <RechartsLineChart
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
        {showLegend ? <Legend /> : null}
        <ChartReferenceLines lines={referenceLines} />
        <Line
          type={smooth ? "monotone" : "linear"}
          dataKey={yKey}
          stroke={stroke}
          strokeWidth={2}
          dot={showDots}
          activeDot={{ r: 4 }}
        />
      </RechartsLineChart>
    </ChartShell>
  )
}
