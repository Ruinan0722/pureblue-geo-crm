"use client"

import { ReferenceLine } from "recharts"
import type { ChartReferenceLine } from "./types"

/** 渲染平行于 X 轴的指标线 */
export function ChartReferenceLines({ lines }: { lines?: ChartReferenceLine[] }) {
  if (!lines?.length) return null
  return (
    <>
      {lines.map((line, index) => (
        <ReferenceLine
          key={`ref-y-${line.y}-${line.label ?? index}`}
          y={line.y}
          stroke={line.color || "var(--destructive)"}
          strokeDasharray={line.strokeDasharray ?? "6 4"}
          strokeWidth={line.strokeWidth ?? 1.5}
          ifOverflow="extendDomain"
          label={
            line.label
              ? {
                  value: line.label,
                  position: "insideTopRight",
                  fill: line.color || "var(--destructive)",
                  fontSize: 11,
                }
              : undefined
          }
        />
      ))}
    </>
  )
}
