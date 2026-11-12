/** 图表公共类型（后续业务页直接复用，无需改组件源码） */

export type ChartDatum = Record<string, string | number | null | undefined>

export type NamedSeries = {
  /** 对应 data 中的字段名 */
  dataKey: string
  /** 图例 / Tooltip 名称 */
  name?: string
  /** 覆盖默认色板 */
  color?: string
}

/**
 * 平行于 X 轴的指标线 / 参考线（y = 常量）。
 * 常用于目标、均值、警戒线。
 */
export type ChartReferenceLine = {
  /** Y 轴取值 */
  y: number
  /** 线旁标签，如「月目标」 */
  label?: string
  /** 描边色，默认 destructive / muted */
  color?: string
  /** 虚线样式，默认 "6 4" */
  strokeDasharray?: string
  strokeWidth?: number
}

export type ChartShellProps = {
  title?: string
  description?: string
  className?: string
  /** 图表区域高度，默认 280 */
  height?: number | string
  /** 无数据时展示；默认「暂无数据」 */
  emptyText?: string
  loading?: boolean
}

export type CartesianChartBaseProps = ChartShellProps & {
  data: ChartDatum[]
  /** X 轴字段，默认 name */
  xKey?: string
  /** X 轴标题 */
  xAxisLabel?: string
  /** Y 轴标题 */
  yAxisLabel?: string
  /** 是否显示网格 */
  showGrid?: boolean
  /** 是否显示图例 */
  showLegend?: boolean
  /** 是否显示 Tooltip */
  showTooltip?: boolean
  /** 平行于 X 轴的指标线（可多条） */
  referenceLines?: ChartReferenceLine[]
}
