"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { SlidersHorizontal, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  muted: "bg-secondary text-secondary-foreground ring-border",
  info: "bg-accent text-accent-foreground ring-accent-foreground/15",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-red-100 text-red-700 ring-red-300",
}

// 通用状态徽章：传入标签与色调
export function Pill({ label, tone = "neutral", className }: { label: string; tone?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone] ?? TONE_CLASSES.neutral,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  )
}

// 顶部数据卡片
export function StatCards({
  items,
  cols = 4,
  dense = false,
}: {
  items: { label: string; value: string | number; tone?: string; hint?: string }[]
  cols?: 3 | 4 | 5 | 6
  /** 紧凑模式：用于列表/看板页顶部，压缩纵向占用，突出下方内容 */
  dense?: boolean
}) {
  const colClass = {
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "lg:grid-cols-5",
    6: "lg:grid-cols-6",
  }[cols]
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", colClass)}>
      {items.map((s) => (
        <div
          key={s.label}
          className={cn("rounded-xl border border-border bg-card", dense ? "px-3 py-2.5" : "p-4")}
        >
          <p className={cn("text-muted-foreground", dense ? "text-[11px]" : "text-xs")}>{s.label}</p>
          <p
            className={cn(
              "mt-1 font-semibold tabular-nums",
              dense ? "text-lg" : "text-2xl",
              s.tone ?? "text-foreground",
            )}
          >
            {s.value}
          </p>
          {s.hint && (
            <p className={cn("mt-0.5 text-muted-foreground", dense ? "text-[10px]" : "text-[11px]")}>{s.hint}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// 页面头部
export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <header className="border-b border-border bg-card/60 px-5 py-5 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  )
}

// 筛选胶囊组
export function FilterChips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent/40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 筛选栏下拉：可输入搜索，样式与列表页统一；multiple 时多选，展示为逗号分隔 */
export function FilterSelect({
  value,
  onChange,
  values,
  onValuesChange,
  multiple = false,
  options,
  className,
  disabled,
  placeholder = "请选择或输入搜索",
}: {
  value?: string
  onChange?: (v: string) => void
  values?: string[] | string
  onValuesChange?: (v: string[]) => void
  multiple?: boolean
  options: { value: string; label: string }[]
  className?: string
  disabled?: boolean
  placeholder?: string
}) {
  if (multiple) {
    const normalized = Array.isArray(values)
      ? values
      : typeof values === "string" && values && values !== "all"
        ? [values]
        : []
    return (
      <SearchableSelect
        multiple
        values={normalized}
        onValuesChange={onValuesChange ?? (() => undefined)}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
      />
    )
  }
  return (
    <SearchableSelect
      value={value ?? ""}
      onChange={onChange ?? (() => undefined)}
      options={options}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
    />
  )
}

/** 气泡内的字段块：标签 + 控件 */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

/** 统一筛选网格：紧凑多列，减少纵向占用 */
export function FilterGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6", className)}>
      {children}
    </div>
  )
}

/** 区间筛选字段（最低—最高）：与其它筛选控件等宽等高，样式统一 */
export function RangeFilterField({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  minPlaceholder = "最低",
  maxPlaceholder = "最高",
  minProps,
  maxProps,
}: {
  label: string
  minValue: string
  maxValue: string
  onMinChange: (v: string) => void
  onMaxChange: (v: string) => void
  minPlaceholder?: string
  maxPlaceholder?: string
  minProps?: Omit<React.ComponentProps<typeof Input>, "className" | "value" | "onChange" | "placeholder">
  maxProps?: Omit<React.ComponentProps<typeof Input>, "className" | "value" | "onChange" | "placeholder">
}) {
  return (
    <FilterField label={label}>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          className="h-9 min-w-0 flex-1 px-2"
          placeholder={minPlaceholder}
          value={minValue}
          onChange={(e) => onMinChange(e.target.value)}
          {...minProps}
        />
        <span className="shrink-0 text-xs text-muted-foreground">—</span>
        <Input
          type="number"
          className="h-9 min-w-0 flex-1 px-2"
          placeholder={maxPlaceholder}
          value={maxValue}
          onChange={(e) => onMaxChange(e.target.value)}
          {...maxProps}
        />
      </div>
    </FilterField>
  )
}

/**
 * 统一「筛选」入口：点击后展开气泡，按字段细筛。
 * activeCount > 0 时按钮显示角标；可搭配下方已选标签展示。
 */
export function FilterPopover({
  activeCount = 0,
  onReset,
  children,
  align = "end",
}: {
  activeCount?: number
  onReset?: () => void
  children: ReactNode
  align?: "start" | "end"
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (rootRef.current?.contains(target as Node)) return
      // SearchableSelect 下拉挂到 body，点击时不算「外部」
      if (target?.closest?.("[data-searchable-select-panel]")) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="gap-1.5"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? titleId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal className="size-4" />
        筛选
        {activeCount > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
            {activeCount}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p id={titleId} className="text-sm font-medium">
              筛选条件
            </p>
            <div className="flex items-center gap-1">
              {onReset && activeCount > 0 && (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={onReset}
                >
                  清空
                </button>
              )}
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="关闭筛选"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </div>
  )
}

/** 已生效筛选项标签，可单独移除 */
export function ActiveFilterTags({
  tags,
}: {
  tags: { key: string; label: string; onClear: () => void }[]
}) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <button
          key={tag.key}
          type="button"
          onClick={tag.onClear}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-secondary"
          title="点击清除该条件"
        >
          {tag.label}
          <X className="size-3 opacity-60" />
        </button>
      ))}
    </div>
  )
}

// 详情信息行
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-0 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-sm">{children}</dd>
    </div>
  )
}

// 空状态
export function EmptyState({ text }: { text: string }) {
  return <div className="py-16 text-center text-sm text-muted-foreground">{text}</div>
}
