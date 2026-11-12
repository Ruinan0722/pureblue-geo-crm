"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { chinaDateISO } from "@/shared/lib/datetime"

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const

export type DateRangeValue = {
  from: string
  to: string
}

type DateRangePickerProps = {
  from: string
  to: string
  onChange: (next: DateRangeValue) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  clearable?: boolean
  "aria-label"?: string
}

function parseISODate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const y = Number(m[1])
  const month = Number(m[2])
  const d = Number(m[3])
  if (!y || month < 1 || month > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, month - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== month - 1 || dt.getDate() !== d) return null
  return { y, m: month, d }
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function formatDisplay(iso: string): string {
  const parsed = parseISODate(iso)
  if (!parsed) return iso
  return `${parsed.y}/${parsed.m}/${parsed.d}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

function leadingBlanksMondayFirst(y: number, m: number): number {
  const jsDay = new Date(y, m - 1, 1).getDay()
  return (jsDay + 6) % 7
}

function clampViewMonth(iso: string | undefined, fallback: { y: number; m: number }) {
  const parsed = iso ? parseISODate(iso) : null
  if (parsed) return { y: parsed.y, m: parsed.m }
  return fallback
}

function orderRange(a: string, b: string): DateRangeValue {
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

function formatRangeLabel(from: string, to: string): string {
  const hasFrom = Boolean(from && parseISODate(from))
  const hasTo = Boolean(to && parseISODate(to))
  if (hasFrom && hasTo) {
    if (from === to) return formatDisplay(from)
    return `${formatDisplay(from)} – ${formatDisplay(to)}`
  }
  if (hasFrom) return `${formatDisplay(from)} – …`
  return ""
}

/** 单个日期范围勾选：先点起点，再点终点；下拉 portal 避免被 Dialog / 筛选区裁切 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "选择日期范围",
  disabled,
  className,
  clearable = true,
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [hoverDay, setHoverDay] = useState<string | null>(null)

  const today = chinaDateISO()
  const todayParsed = parseISODate(today) ?? { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1 }
  const [view, setView] = useState(() => clampViewMonth(from || to || undefined, { y: todayParsed.y, m: todayParsed.m }))

  useEffect(() => {
    if (!open) return
    setDraftFrom(from)
    setDraftTo(to)
    setHoverDay(null)
    setView(clampViewMonth(from || to || undefined, { y: todayParsed.y, m: todayParsed.m }))
  }, [open, from, to, todayParsed.y, todayParsed.m])

  function updateCoords() {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const panelWidth = Math.max(rect.width, 288)
    let left = rect.left
    if (left + panelWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - panelWidth - 8)
    }
    const below = rect.bottom + 4
    const approxHeight = 360
    const top = below + approxHeight > window.innerHeight - 8 ? Math.max(8, rect.top - approxHeight - 4) : below
    setCoords({ top, left, width: panelWidth })
  }

  useLayoutEffect(() => {
    if (!open) return
    updateCoords()
    function onReposition() {
      updateCoords()
    }
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePanel()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel()
    }
    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onKey)
    }
    // closePanel 读最新 draftFrom/draftTo
     
  }, [open, draftFrom, draftTo])

  const cells = useMemo(() => {
    const { y, m } = view
    const blanks = leadingBlanksMondayFirst(y, m)
    const total = daysInMonth(y, m)
    const list: Array<{ iso: string; day: number } | null> = []
    for (let i = 0; i < blanks; i++) list.push(null)
    for (let d = 1; d <= total; d++) {
      list.push({ iso: toISO(y, m, d), day: d })
    }
    while (list.length % 7 !== 0) list.push(null)
    return list
  }, [view])

  const selectingEnd = Boolean(draftFrom && !draftTo)
  const previewRange = useMemo(() => {
    if (draftFrom && draftTo) return orderRange(draftFrom, draftTo)
    if (draftFrom && hoverDay) return orderRange(draftFrom, hoverDay)
    return null
  }, [draftFrom, draftTo, hoverDay])

  function shiftMonth(delta: number) {
    setView((current) => {
      const date = new Date(current.y, current.m - 1 + delta, 1)
      return { y: date.getFullYear(), m: date.getMonth() + 1 }
    })
  }

  function commitRange(next: DateRangeValue) {
    setDraftFrom(next.from)
    setDraftTo(next.to)
    setHoverDay(null)
    onChange(next)
    setOpen(false)
  }

  function pick(iso: string) {
    // 已有完整区间时重新选起点；仅选了起点时点第二次作为终点（同日=单日）
    if (!draftFrom || draftTo) {
      setDraftFrom(iso)
      setDraftTo("")
      setHoverDay(null)
      return
    }
    commitRange(orderRange(draftFrom, iso))
  }

  function clear() {
    setDraftFrom("")
    setDraftTo("")
    setHoverDay(null)
    onChange({ from: "", to: "" })
    setOpen(false)
  }

  /** 点外面关闭时：若只选了起点，按单日提交，避免筛选项看起来选了但未写入 */
  function closePanel() {
    if (draftFrom && !draftTo) {
      commitRange({ from: draftFrom, to: draftFrom })
      return
    }
    setOpen(false)
  }

  const hasValue = Boolean(from && parseISODate(from)) || Boolean(to && parseISODate(to))
  const label = formatRangeLabel(from, to)

  const panel =
    open && coords
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
            className="z-[80] overflow-hidden rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md"
            data-date-picker-panel=""
            role="dialog"
            aria-label="选择日期范围"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftMonth(-1)}
                aria-label="上个月"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-medium tabular-nums">
                {view.y}年{view.m}月
              </span>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftMonth(1)}
                aria-label="下个月"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {selectingEnd ? "再点一次结束日（同日=查当天）" : "请选择开始日期"}
            </p>

            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="py-1 text-center text-[11px] font-medium text-muted-foreground">
                  {weekday}
                </div>
              ))}
              {cells.map((cell, idx) => {
                if (!cell) return <div key={`empty-${idx}`} className="h-9" />
                const inRange =
                  previewRange != null && cell.iso >= previewRange.from && cell.iso <= previewRange.to
                const isStart = previewRange != null && cell.iso === previewRange.from
                const isEnd = previewRange != null && cell.iso === previewRange.to
                const isEdge = isStart || isEnd
                const isToday = cell.iso === today
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => {
                      if (selectingEnd) setHoverDay(cell.iso)
                    }}
                    onMouseLeave={() => {
                      if (selectingEnd) setHoverDay(null)
                    }}
                    onClick={() => pick(cell.iso)}
                    className={cn(
                      "inline-flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                      inRange && !isEdge && "bg-primary/10 text-foreground",
                      isEdge && "bg-primary text-primary-foreground hover:bg-primary",
                      !inRange && "hover:bg-accent",
                      !isEdge && isToday && "font-semibold text-primary ring-1 ring-inset ring-primary/30",
                    )}
                  >
                    {cell.day}
                  </button>
                )
              })}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setView({ y: todayParsed.y, m: todayParsed.m })
                  pick(today)
                }}
              >
                今天
              </button>
              {clearable ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clear}
                >
                  清除
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
        }}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm transition-colors",
          "hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60",
          open && "ring-2 ring-ring/30",
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", !hasValue && "text-muted-foreground")}>
          {hasValue ? label : placeholder}
        </span>
        {clearable && hasValue && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除日期范围"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              clear()
            }}
          >
            <X className="size-3.5" />
          </span>
        ) : null}
      </button>
      {panel}
    </div>
  )
}
