"use client"

import * as React from "react"
import { Tooltip } from "@base-ui/react/tooltip"
import { cn } from "@/shared/lib/utils"

function Popup({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Popup
      className={cn(
        "z-50 max-w-md whitespace-normal break-words rounded-md border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground shadow-md",
      )}
    >
      {children}
    </Tooltip.Popup>
  )
}

/** 表格单元格全内容提示：内容被截断（truncate）时，悬停或键盘聚焦即显示完整内容。
 * content 为完整文本（提示框展示）；children 为单元格内实际渲染（默认同 content）。 */
export function CellTip({
  content,
  children,
  className,
}: {
  content: string
  children?: React.ReactNode
  className?: string
}) {
  const full = content || "—"
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className={cn("block min-w-0 truncate", className)} />}>
        {children ?? full}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" align="start" sideOffset={4}>
          <Popup>{full}</Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/**
 * 表格级全内容提示：包裹整张表格后，任意单元格内容被截断（scrollWidth > clientWidth）
 * 时，悬停或键盘聚焦即弹出完整内容——无需逐列接入。
 */
export function TableCellTip({ children }: { children: React.ReactNode }) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  const [text, setText] = React.useState("")

  /** 是否操作类单元格（按钮/链接/输入等）：内容自明，无需提示 */
  const isInteractiveCell = (cell: HTMLElement) =>
    Boolean(cell.querySelector("button, a, input, select, textarea"))

  const showForCell = React.useCallback((cell: HTMLElement) => {
    if (isInteractiveCell(cell)) {
      setAnchor(null)
      return
    }
    const t = (cell.textContent || "").trim()
    if (!t) {
      setAnchor(null)
      return
    }
    setAnchor(cell)
    setText(t)
  }, [])

  function handleOver(e: React.MouseEvent) {
    const cell = (e.target as HTMLElement).closest("td")
    if (cell) showForCell(cell as HTMLElement)
  }

  function handleFocus(e: React.FocusEvent) {
    const cell = (e.target as HTMLElement).closest("td")
    if (cell) showForCell(cell as HTMLElement)
  }

  return (
    <div onMouseOver={handleOver} onMouseLeave={() => setAnchor(null)} onFocusCapture={handleFocus}>
      {children}
      <Tooltip.Root
        open={Boolean(anchor)}
        onOpenChange={(open) => {
          if (!open) setAnchor(null)
        }}
      >
        <Tooltip.Portal>
          <Tooltip.Positioner anchor={anchor} side="top" align="start" sideOffset={4}>
            <Popup>{text}</Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  )
}
