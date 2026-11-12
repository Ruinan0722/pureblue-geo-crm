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
import type { CartesianChartBaseProps, NamedSeries } from "./types"

export type MultiLineChartProps = CartesianChartBaseProps & {
  series: NamedSeries[]
  smooth?: boolean
  showDots?: boolean
}

/** 多系列折线图（对比多条指标趋势；支持平行于 X 轴的指标线） */
export function MultiLineChart({
  data,
  series,
  xKey = "name",
  smooth = true,
  showDots = false,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  referenceLines,
  title,
  description,
  className,
  height,
  emptyText,
  loading,
}: MultiLineChartProps) {
  const empty = !loading && (data.length === 0 || series.length === 0)

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
      <RechartsLineChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        {showGrid ? (
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_AXIS.gridStroke} vertical={false} />
        ) : null}
        <XAxis dataKey={xKey} tick={CHART_AXIS.tick} axisLine={{ stroke: CHART_AXIS.stroke }} tickLine={false} />
        <YAxis tick={CHART_AXIS.tick} axisLine={false} tickLine={false} width={40} />
        {showTooltip ? <Tooltip {...CHART_TOOLTIP_STYLE} /> : null}
        {showLegend ? <Legend /> : null}
        <ChartReferenceLines lines={referenceLines} />
        {series.map((s, i) => (
          <Line
            key={s.dataKey}
            type={smooth ? "monotone" : "linear"}
            dataKey={s.dataKey}
            name={s.name || s.dataKey}
            stroke={chartColor(i, s.color)}
            strokeWidth={2}
            dot={showDots}
            activeDot={{ r: 4 }}
          />
        ))}
      </RechartsLineChart>
    </ChartShell>
  )
}
