"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { chinaDateISO } from "@/shared/lib/datetime"

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const
const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"] as const

type PanelMode = "day" | "month" | "year"

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** YYYY-MM-DD，含当日 */
  min?: string
  /** YYYY-MM-DD，含当日 */
  max?: string
  /** 允许清空已选日期，默认 true */
  clearable?: boolean
  /** 无障碍名称 */
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
  return `${parsed.y}年${parsed.m}月${parsed.d}日`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/** 周一为一周起始时，该月 1 号前的占位格数 */
function leadingBlanksMondayFirst(y: number, m: number): number {
  const jsDay = new Date(y, m - 1, 1).getDay() // 0=Sun … 6=Sat
  return (jsDay + 6) % 7
}

function clampViewMonth(iso: string | undefined, fallback: { y: number; m: number }) {
  const parsed = iso ? parseISODate(iso) : null
  if (parsed) return { y: parsed.y, m: parsed.m }
  return fallback
}

function isDisabledDay(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return true
  if (max && iso > max) return true
  return false
}

function yearStartOfDecade(y: number): number {
  return Math.floor(y / 12) * 12
}

/** 与 SearchableSelect 同风格的日期选择：触发器 + portal 月历，避免 Dialog 裁切 */
export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  disabled,
  className,
  min,
  max,
  clearable = true,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PanelMode>("day")
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const today = chinaDateISO()
  const todayParsed = parseISODate(today) ?? { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1 }

  const [view, setView] = useState(() => clampViewMonth(value || undefined, { y: todayParsed.y, m: todayParsed.m }))

  useEffect(() => {
    if (!open) return
    setMode("day")
    setView(clampViewMonth(value || undefined, { y: todayParsed.y, m: todayParsed.m }))
  }, [open, value, todayParsed.y, todayParsed.m])

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
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (mode !== "day") {
          setMode(mode === "year" ? "month" : "day")
          return
        }
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, mode])

  const cells = useMemo(() => {
    const { y, m } = view
    const blanks = leadingBlanksMondayFirst(y, m)
    const total = daysInMonth(y, m)
    const list: Array<{ iso: string; day: number; inMonth: boolean } | null> = []
    for (let i = 0; i < blanks; i++) list.push(null)
    for (let d = 1; d <= total; d++) {
      list.push({ iso: toISO(y, m, d), day: d, inMonth: true })
    }
    while (list.length % 7 !== 0) list.push(null)
    return list
  }, [view])

  const yearBlockStart = yearStartOfDecade(view.y)
  const yearOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => yearBlockStart + i),
    [yearBlockStart],
  )

  function shiftNav(delta: number) {
    if (mode === "day") {
      setView((current) => {
        const date = new Date(current.y, current.m - 1 + delta, 1)
        return { y: date.getFullYear(), m: date.getMonth() + 1 }
      })
      return
    }
    if (mode === "month") {
      setView((current) => ({ ...current, y: current.y + delta }))
      return
    }
    setView((current) => ({ ...current, y: current.y + delta * 12 }))
  }

  function pick(iso: string) {
    if (isDisabledDay(iso, min, max)) return
    onChange(iso)
    setOpen(false)
  }

  function clear() {
    onChange("")
    setOpen(false)
  }

  function pickMonth(month: number) {
    setView((current) => ({ ...current, m: month }))
    setMode("day")
  }

  function pickYear(year: number) {
    setView((current) => ({ ...current, y: year }))
    setMode("month")
  }

  const hasValue = Boolean(value && parseISODate(value))
  const todayDisabled = isDisabledDay(today, min, max)
  const selectedParsed = value ? parseISODate(value) : null

  const navLabel =
    mode === "day" ? null : mode === "month" ? (
      <button
        type="button"
        className="rounded-md px-2 py-1 text-sm font-medium tabular-nums hover:bg-accent"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMode("year")}
        aria-label="选择年份"
      >
        {view.y}年
      </button>
    ) : (
      <span className="text-sm font-medium tabular-nums">
        {yearBlockStart} – {yearBlockStart + 11}
      </span>
    )

  const panel =
    open && coords
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
            className="z-[80] overflow-hidden rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md"
            data-date-picker-panel=""
            role="dialog"
            aria-label="选择日期"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftNav(-1)}
                aria-label={mode === "year" ? "上一段年份" : mode === "month" ? "上一年" : "上个月"}
              >
                <ChevronLeft className="size-4" />
              </button>

              {mode === "day" ? (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 text-sm font-medium tabular-nums hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setMode("year")}
                    aria-label="选择年份"
                    title="点击快速选年"
                  >
                    {view.y}年
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 text-sm font-medium tabular-nums hover:bg-accent"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setMode("month")}
                    aria-label="选择月份"
                    title="点击快速选月"
                  >
                    {view.m}月
                  </button>
                </div>
              ) : (
                navLabel
              )}

              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => shiftNav(1)}
                aria-label={mode === "year" ? "下一段年份" : mode === "month" ? "下一年" : "下个月"}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {mode === "day" ? (
              <div className="mt-2 grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((label) => (
                  <div key={label} className="py-1 text-center text-[11px] font-medium text-muted-foreground">
                    {label}
                  </div>
                ))}
                {cells.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`empty-${idx}`} className="h-9" />
                  }
                  const selected = cell.iso === value
                  const isToday = cell.iso === today
                  const dayDisabled = isDisabledDay(cell.iso, min, max)
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={dayDisabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(cell.iso)}
                      className={cn(
                        "inline-flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                        dayDisabled && "cursor-not-allowed text-muted-foreground/40",
                        !dayDisabled && !selected && "hover:bg-accent",
                        selected && "bg-primary text-primary-foreground hover:bg-primary",
                        !selected && isToday && "font-semibold text-primary ring-1 ring-inset ring-primary/30",
                      )}
                    >
                      {cell.day}
                    </button>
                  )
                })}
              </div>
            ) : null}

            {mode === "month" ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {MONTH_LABELS.map((label, idx) => {
                  const month = idx + 1
                  const active = view.m === month
                  const selectedHere = selectedParsed?.y === view.y && selectedParsed?.m === month
                  return (
                    <button
                      key={label}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMonth(month)}
                      className={cn(
                        "h-10 rounded-lg text-sm transition-colors",
                        selectedHere && "bg-primary text-primary-foreground",
                        !selectedHere && active && "ring-1 ring-inset ring-primary/40",
                        !selectedHere && "hover:bg-accent",
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : null}

            {mode === "year" ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {yearOptions.map((year) => {
                  const active = view.y === year
                  const selectedHere = selectedParsed?.y === year
                  const isCurrentYear = todayParsed.y === year
                  return (
                    <button
                      key={year}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickYear(year)}
                      className={cn(
                        "h-10 rounded-lg text-sm tabular-nums transition-colors",
                        selectedHere && "bg-primary text-primary-foreground",
                        !selectedHere && active && "ring-1 ring-inset ring-primary/40",
                        !selectedHere && isCurrentYear && "font-semibold text-primary",
                        !selectedHere && "hover:bg-accent",
                      )}
                    >
                      {year}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button
                type="button"
                disabled={todayDisabled}
                className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setView({ y: todayParsed.y, m: todayParsed.m })
                  setMode("day")
                  pick(today)
                }}
              >
                今天
              </button>
              {mode !== "day" ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode(mode === "year" ? "month" : "day")}
                >
                  返回
                </button>
              ) : clearable ? (
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
          {hasValue ? formatDisplay(value) : placeholder}
        </span>
        {clearable && hasValue && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="清除日期"
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
