"use client"

import { Cell, Legend, Pie, PieChart as RechartsPieChart, Tooltip } from "recharts"
import { ChartShell } from "./chart-shell"
import { CHART_TOOLTIP_STYLE, chartColor } from "./theme"
import type { ChartDatum, ChartShellProps } from "./types"

export type PieChartProps = ChartShellProps & {
  data: ChartDatum[]
  nameKey?: string
  valueKey?: string
  /** 环图内半径比例 0~1；0 为实心饼图，默认 0.58 环图 */
  innerRadiusRatio?: number
  showLegend?: boolean
  showTooltip?: boolean
  /** 扇区上显示名称与数值 */
  showLabels?: boolean
}

type Slice = { name: string; value: number; fill: string }

/**
 * 饼图 / 环图：适合占比构成（客户状态、线索来源、输单原因等）。
 */
export function PieChart({
  data,
  nameKey = "name",
  valueKey = "value",
  innerRadiusRatio = 0.58,
  showLegend = true,
  showTooltip = true,
  showLabels = false,
  title,
  description,
  className,
  height = 280,
  emptyText = "暂无构成数据",
  loading,
}: PieChartProps) {
  const slices: Slice[] = data
    .map((row, i) => {
      const raw = Number(row[valueKey])
      const value = Number.isFinite(raw) && raw > 0 ? raw : 0
      return {
        name: String(row[nameKey] ?? ""),
        value,
        fill: typeof row.fill === "string" ? row.fill : chartColor(i),
      }
    })
    .filter((s) => s.value > 0)

  const empty = !loading && slices.length === 0
  const total = slices.reduce((s, x) => s + x.value, 0)
  const clampedInner = Math.min(0.85, Math.max(0, innerRadiusRatio))

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
      <RechartsPieChart margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        {showTooltip ? (
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={(value, name) => {
              const n = typeof value === "number" ? value : Number(value)
              const pct = total > 0 && Number.isFinite(n) ? Math.round((n / total) * 100) : 0
              return [`${n}（${pct}%）`, name]
            }}
          />
        ) : null}
        {showLegend ? <Legend verticalAlign="bottom" height={36} /> : null}
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="46%"
          innerRadius={`${clampedInner * 100}%`}
          outerRadius="72%"
          paddingAngle={slices.length > 1 ? 2 : 0}
          stroke="var(--card)"
          strokeWidth={2}
          label={
            showLabels
              ? ({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`
              : false
          }
        >
          {slices.map((s, i) => (
            <Cell key={`${s.name}-${i}`} fill={s.fill} />
          ))}
        </Pie>
      </RechartsPieChart>
    </ChartShell>
  )
}
