"use client"

import { ChartShell } from "./chart-shell"
import { chartColor } from "./theme"
import type { ChartShellProps } from "./types"
import { cn } from "@/shared/lib/utils"

export type GaugeChartProps = ChartShellProps & {
  /** 当前值 */
  value: number
  /** 目标值；不传则按 100 视为满分（百分比场景） */
  target?: number
  /** 单位后缀，如 %、万 */
  unit?: string
  /** 进度弧颜色 */
  color?: string
  /** 中心主文案下方的说明 */
  caption?: string
}

/**
 * 半环仪表盘：目标达成 / 赢单率等单一比例指标。
 * 使用 SVG，不依赖 Recharts ResponsiveContainer。
 */
export function GaugeChart({
  value,
  target = 100,
  unit = "",
  color,
  caption,
  title,
  description,
  className,
  height = 220,
  emptyText = "暂无指标",
  loading,
}: GaugeChartProps) {
  const safeTarget = target > 0 ? target : 100
  const ratio = Math.max(0, value / safeTarget)
  const capped = Math.min(1, ratio)
  const displayPct = Math.round(capped * 100)
  const stroke = color ?? chartColor(0)
  const empty = !loading && !Number.isFinite(value)
  // 有自定义 caption 时不再叠「达成 xx%」（百分比场景会与主值重复）
  const subLabel =
    caption ?? (target !== 100 ? `目标 ${formatValue(target)}${unit}` : `达成 ${displayPct}%`)

  const r = 72
  const cx = 100
  const cy = 92
  // 半环：从 180°（左）顺时针到 0°（右）；进度按比例缩短终点角
  const endAngle = 180 - capped * 180

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
      <div className="flex h-full flex-col items-center justify-center gap-1">
        <svg viewBox="0 0 200 124" className="h-[min(100%,11rem)] w-full max-w-[16rem]" aria-hidden>
          <path
            d={describeArc(cx, cy, r, 180, 0)}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={14}
            strokeLinecap="round"
          />
          {capped > 0 ? (
            <path
              d={describeArc(cx, cy, r, 180, endAngle)}
              fill="none"
              stroke={stroke}
              strokeWidth={14}
              strokeLinecap="round"
            />
          ) : null}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            fill="currentColor"
            className="text-foreground"
            style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
          >
            {formatValue(value)}
            {unit ? (
              <tspan style={{ fontSize: 14, fontWeight: 500 }} dx={2}>
                {unit}
              </tspan>
            ) : null}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fill="currentColor"
            className="text-muted-foreground"
            style={{ fontSize: 11 }}
          >
            {subLabel}
          </text>
        </svg>
        {ratio > 1 ? <p className={cn("text-[11px] text-emerald-600")}>已超额完成</p> : null}
      </div>
    </ChartShell>
  )
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return Number.isInteger(n) ? String(n) : n.toLocaleString("zh-CN", { maximumFractionDigits: 1 })
}

/** 0°=三点钟方向，逆时针为正（标准极坐标约定） */
function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad),
  }
}

/** 从上半圆左侧(180°)扫到右侧(0°)，顺时针 */
function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, startAngle)
  const end = polarToCartesian(cx, cy, radius, endAngle)
  const sweep = ((startAngle - endAngle + 360) % 360)
  const largeArc = sweep > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}
