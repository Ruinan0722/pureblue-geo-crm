"use client"

import { useMemo, useState } from "react"
import { ChartShell } from "./chart-shell"
import { chartColor } from "./theme"
import type { ChartDatum, ChartShellProps } from "./types"
import { cn } from "@/shared/lib/utils"

export type FunnelChartProps = ChartShellProps & {
  data: ChartDatum[]
  /** 阶段名称字段，默认 name */
  nameKey?: string
  /** 数值字段，默认 value */
  valueKey?: string
  /** 数值后缀，如 %、万 */
  valueSuffix?: string
  showTooltip?: boolean
  showLabels?: boolean
  /** 点击某一漏斗层时返回原始数据与阶段序号。 */
  onSelect?: (datum: ChartDatum, index: number) => void
}

type FunnelLayer = {
  name: string
  value: number
  fill: string
  /** 相对顶层的宽度比例 0~1，自上而下递减 */
  widthRatio: number
}

/**
 * 商机阶段漏斗：外形始终「上宽下窄」。
 * 宽度按阶段顺序递减，不跟真实数值挂钩（避免 0/1 分布把图形撑成纺锤形）；
 * 真实数量只体现在文案上。
 *
 * 注意：不用 Recharts ResponsiveContainer（会把自定义 DOM 撑坏，只剩数字）。
 */
export function FunnelChart({
  data,
  nameKey = "name",
  valueKey = "value",
  valueSuffix = "",
  showLabels = true,
  title,
  description,
  className,
  height = 320,
  emptyText = "暂无阶段数据",
  loading,
  onSelect,
}: FunnelChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const layers = useMemo((): FunnelLayer[] => {
    const n = data.length
    if (n === 0) return []
    return data.map((row, i) => {
      const raw = Number(row[valueKey])
      const value = Number.isFinite(raw) && raw > 0 ? raw : 0
      // 顶层 100%，底层约 32%，线性递减
      const widthRatio = n === 1 ? 1 : 1 - (i / (n - 1)) * 0.68
      return {
        name: String(row[nameKey] ?? ""),
        value,
        fill: typeof row.fill === "string" ? row.fill : chartColor(i),
        widthRatio,
      }
    })
  }, [data, nameKey, valueKey])

  const empty = !loading && layers.length === 0
  const maxValue = Math.max(...layers.map((l) => l.value), 0)

  return (
    <ChartShell
      title={title}
      description={description}
      className={className}
      height={height}
      emptyText={emptyText}
      loading={loading}
      empty={empty}
      responsive={false}
    >
      <div className="flex h-full w-full flex-col justify-center gap-1 px-2 py-1">
        {layers.map((layer, index) => (
          <div key={layer.name || layer.fill} className="relative flex w-full items-center gap-3">
            <div className="flex min-w-0 flex-1 justify-center">
              <button
                type="button"
                onClick={() => onSelect?.(data[index]!, index)}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                aria-label={onSelect ? `查看${layer.name}阶段明细` : undefined}
                disabled={!onSelect}
                className={cn(
                  "relative flex h-10 items-center justify-center border-0 text-xs font-medium text-white transition duration-200",
                  onSelect && "cursor-pointer hover:z-10 hover:-translate-y-0.5 hover:scale-[1.025] hover:brightness-105 hover:drop-shadow-lg focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  !onSelect && "cursor-default",
                  layer.value === 0 && maxValue > 0 && "opacity-60",
                )}
                style={{
                  width: `${Math.round(layer.widthRatio * 100)}%`,
                  backgroundColor: layer.fill,
                  clipPath: "polygon(1.5% 0, 98.5% 0, 100% 100%, 0 100%)",
                }}
                title={`${layer.name}：${layer.value}`}
              >
                {showLabels ? (
                  <span className="truncate px-2 drop-shadow-sm">
                    {layer.name}
                    <span className="ml-1.5 tabular-nums opacity-95">
                      {layer.value}
                      {valueSuffix}
                    </span>
                  </span>
                ) : null}
              </button>
            </div>
            {onSelect && activeIndex === index ? <span className="pointer-events-none absolute right-1 z-20 rounded-lg border bg-popover px-2.5 py-1.5 text-[11px] font-medium text-popover-foreground shadow-lg">{layer.name} · {layer.value}{valueSuffix}<span className="ml-1 text-primary">点击查看</span></span> : null}
          </div>
        ))}
      </div>
    </ChartShell>
  )
}

/** 与主题 chart token 对齐的色板（兼容旧导出） */
export { CHART_COLOR_VARS as FUNNEL_PALETTE } from "./theme"
