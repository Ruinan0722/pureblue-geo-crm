/**
 * 图表组件（Recharts + 主题 chart token）。
 *
 * 类型：折线 / 多折线 / 柱状（含分组、堆叠、横向）/ 面积 / 漏斗 / 饼·环 / 仪表盘。
 */

export { ChartShell } from "./chart-shell"
export { LineChart, type LineChartProps } from "./line-chart"
export { MultiLineChart, type MultiLineChartProps } from "./multi-line-chart"
export { BarChart, type BarChartProps } from "./bar-chart"
export { FunnelChart, FUNNEL_PALETTE, type FunnelChartProps } from "./funnel-chart"
export { AreaChart, type AreaChartProps } from "./area-chart"
export { PieChart, type PieChartProps } from "./pie-chart"
export { GaugeChart, type GaugeChartProps } from "./gauge-chart"
export { CHART_COLOR_VARS, CHART_AXIS, CHART_TOOLTIP_STYLE, chartColor } from "./theme"
export type {
  ChartDatum,
  NamedSeries,
  ChartReferenceLine,
  ChartShellProps,
  CartesianChartBaseProps,
} from "./types"
export { ChartReferenceLines } from "./reference-lines"
