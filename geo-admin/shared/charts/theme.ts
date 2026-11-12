/** 与 app/globals.css 中 --chart-1 … --chart-5 对齐 */

export const CHART_COLOR_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

export function chartColor(index: number, override?: string): string {
  if (override) return override
  return CHART_COLOR_VARS[index % CHART_COLOR_VARS.length]!
}

/** Cartesian 轴 / 网格默认描边（跟随主题） */
export const CHART_AXIS = {
  stroke: "var(--border)",
  tick: { fill: "var(--muted-foreground)", fontSize: 12 },
  gridStroke: "var(--border)",
} as const

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--card-foreground)",
    fontSize: 12,
    boxShadow: "0 4px 16px color-mix(in oklch, var(--foreground) 8%, transparent)",
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 4 },
  itemStyle: { color: "var(--foreground)" },
} as const
