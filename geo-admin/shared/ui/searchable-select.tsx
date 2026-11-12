"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/shared/lib/utils"

export type SearchableSelectOption = {
  value: string
  label: string
  /** 额外匹配关键词（拼音、别名等） */
  keywords?: string
}

export function toSelectOptions(items: readonly string[]): SearchableSelectOption[] {
  return items.map((item) => ({ value: item, label: item }))
}

type SearchableSelectBase = {
  options: SearchableSelectOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  /** 允许输入不在列表中的值并回车确认（仅单选） */
  allowCustom?: boolean
  /** 下拉展开方向；默认 bottom。对话框底部字段建议 top */
  dropdownSide?: "top" | "bottom"
}

type SearchableSelectSingleProps = SearchableSelectBase & {
  multiple?: false
  value: string
  onChange: (value: string) => void
  values?: never
  onValuesChange?: never
}

type SearchableSelectMultiProps = SearchableSelectBase & {
  multiple: true
  values: string[]
  onValuesChange: (values: string[]) => void
  value?: never
  onChange?: never
  allowCustom?: false
}

export type SearchableSelectProps = SearchableSelectSingleProps | SearchableSelectMultiProps

function matchesQuery(option: SearchableSelectOption, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${option.label} ${option.value} ${option.keywords ?? ""}`.toLowerCase()
  return hay.includes(q)
}

function coerceSelectValues(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter((v) => v && v !== "all")
  }
  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t || t === "all") return []
    return t
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((v) => v && v !== "all")
  }
  return []
}

function labelsForValues(options: SearchableSelectOption[], values: unknown): string {
  const map = new Map(options.map((o) => [o.value, o.label]))
  return coerceSelectValues(values)
    .map((v) => map.get(v) ?? v)
    .filter(Boolean)
    .join(", ")
}

/** 可输入筛选的下拉选择（表单 / 筛选栏通用；下拉层 portal 避免被 Dialog 裁切） */
export function SearchableSelect(props: SearchableSelectProps) {
  const {
    options,
    placeholder = "请选择或输入搜索",
    emptyText = "无匹配项",
    disabled,
    className,
    allowCustom = false,
    dropdownSide = "bottom",
  } = props
  const multiple = props.multiple === true
  const singleValue = multiple ? "" : props.value
  const multiValues = multiple ? coerceSelectValues(props.values) : []

  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  /** 用户是否已改动输入；未改动前不按已选文案过滤，避免只剩当前项 */
  const [filtering, setFiltering] = useState(false)
  const [coords, setCoords] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
  } | null>(null)

  const selectedSingle = useMemo(
    () =>
      multiple
        ? null
        : options.find((o) => o.value === singleValue) ??
          (singleValue ? { value: singleValue, label: singleValue } : null),
    [options, singleValue, multiple],
  )

  const selectedSet = useMemo(() => new Set(multiValues), [multiValues])

  const closedDisplay = multiple
    ? labelsForValues(options, multiValues)
    : (selectedSingle?.label ?? "")

  const filtered = useMemo(() => {
    if (!open || !filtering) return options
    const list = options.filter((o) => matchesQuery(o, query))
    if (
      !multiple &&
      selectedSingle &&
      !list.some((o) => o.value === selectedSingle.value) &&
      matchesQuery(selectedSingle, query)
    ) {
      return [selectedSingle, ...list]
    }
    return list
  }, [options, query, selectedSingle, open, filtering, multiple])

  const allFilteredSelected =
    multiple &&
    filtered.length > 0 &&
    filtered.every((o) => selectedSet.has(o.value))

  const displayValue = open ? (filtering ? query : closedDisplay) : closedDisplay

  function updateCoords() {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (dropdownSide === "top") {
      setCoords({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
      })
      return
    }
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
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
  }, [open, dropdownSide])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closeList()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeList()
        inputRef.current?.blur()
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function closeList() {
    setOpen(false)
    setQuery("")
    setFiltering(false)
  }

  function openList() {
    if (disabled || open) return
    setQuery(multiple ? "" : closedDisplay)
    setFiltering(false)
    setOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      // 展开时全选已选文案，便于直接输入搜索覆盖
      if (closedDisplay) inputRef.current?.select()
    })
  }

  function pickSingle(next: string) {
    if (multiple) return
    props.onChange(next)
    closeList()
    inputRef.current?.blur()
  }

  function toggleMulti(next: string) {
    if (!multiple) return
    const exists = selectedSet.has(next)
    const updated = exists ? multiValues.filter((v) => v !== next) : [...multiValues, next]
    props.onValuesChange(updated)
  }

  function toggleSelectAll() {
    if (!multiple) return
    if (allFilteredSelected) {
      const drop = new Set(filtered.map((o) => o.value))
      props.onValuesChange(multiValues.filter((v) => !drop.has(v)))
      return
    }
    const merged = new Set(multiValues)
    for (const o of filtered) merged.add(o.value)
    props.onValuesChange([...merged])
  }

  function commitCustom() {
    const raw = query.trim()
    if (multiple || !allowCustom || !raw) return
    if (!options.some((o) => o.value === raw || o.label === raw)) {
      pickSingle(raw)
    }
  }

  const panel =
    open && coords
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
            }}
            className="z-[80] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
            data-searchable-select-panel=""
          >
            <ul
              id={listId}
              role="listbox"
              aria-multiselectable={multiple || undefined}
              className="max-h-56 overflow-y-auto overscroll-contain p-1"
            >
              {multiple && filtered.length > 0 ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={allFilteredSelected}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium",
                      allFilteredSelected ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={toggleSelectAll}
                  >
                    <Check className={cn("size-3.5 shrink-0", allFilteredSelected ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">
                      {allFilteredSelected ? "取消全选" : "全选"}
                    </span>
                  </button>
                </li>
              ) : null}
              {filtered.length === 0 ? (
                <li className="px-2 py-2 text-center text-xs text-muted-foreground">
                  {!multiple && allowCustom && filtering && query.trim()
                    ? `回车使用「${query.trim()}」`
                    : emptyText}
                </li>
              ) : (
                filtered.map((option) => {
                  const active = multiple ? selectedSet.has(option.value) : option.value === singleValue
                  return (
                    <li key={`${option.value}::${option.label}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          active ? "bg-primary/10 text-primary" : "hover:bg-accent",
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => (multiple ? toggleMulti(option.value) : pickSingle(option.value))}
                      >
                        <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex h-9 w-full items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-sm transition-colors",
          "hover:bg-accent/40",
          open && "ring-2 ring-ring/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          ref={inputRef}
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          title={closedDisplay || undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          onClick={(e) => {
            openList()
            if (open && !filtering && !multiple) e.currentTarget.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setFiltering(true)
            if (!open) setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (multiple) {
                if (filtered[0]) toggleMulti(filtered[0].value)
                return
              }
              if (filtered[0]) pickSingle(filtered[0].value)
              else commitCustom()
            }
            if (multiple && e.key === "Backspace" && !query && multiValues.length > 0) {
              props.onValuesChange(multiValues.slice(0, -1))
            }
          }}
          className={cn(
            "min-w-0 flex-1 truncate bg-transparent py-1.5 outline-none placeholder:text-muted-foreground",
            !open && !closedDisplay && "text-muted-foreground",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={open ? "收起选项" : "展开选项"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (disabled) return
            if (open) {
              closeList()
            } else {
              openList()
              inputRef.current?.focus()
            }
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronsUpDown className="size-3.5" aria-hidden />
        </button>
      </div>
      {panel}
    </div>
  )
}
