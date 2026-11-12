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

type SearchableSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

function matchesQuery(option: SearchableSelectOption, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${option.label} ${option.value} ${option.keywords ?? ""}`.toLowerCase()
  return hay.includes(q)
}

/** 可输入筛选的下拉选择 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "请选择或输入搜索",
  emptyText = "无匹配项",
  disabled,
  className,
}: SearchableSelectProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  /** 用户是否已改动输入；未改动前不按已选文案过滤，避免只剩当前项 */
  const [filtering, setFiltering] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? (value ? { value, label: value } : null),
    [options, value],
  )

  const filtered = useMemo(() => {
    if (!open || !filtering) return options
    const list = options.filter((o) => matchesQuery(o, query))
    if (selected && !list.some((o) => o.value === selected.value) && matchesQuery(selected, query)) {
      return [selected, ...list]
    }
    return list
  }, [options, query, selected, open, filtering])

  const displayValue = open ? query : (selected?.label ?? "")

  function updateCoords() {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
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
  }, [open])

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
    const label = selected?.label ?? ""
    setQuery(label)
    setFiltering(false)
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function pick(next: string) {
    onValueChange(next)
    closeList()
    inputRef.current?.blur()
  }

  const panel =
    open && coords
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
            className="z-[80] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
            data-searchable-select-panel=""
          >
            <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto overscroll-contain p-1">
              {filtered.length === 0 ? (
                <li className="px-2 py-2 text-center text-xs text-muted-foreground">{emptyText}</li>
              ) : (
                filtered.map((option) => {
                  const active = option.value === value
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
                        onClick={() => pick(option.value)}
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
          "flex h-8 w-full items-center gap-1 rounded-lg border border-input bg-transparent px-2 text-sm transition-colors dark:bg-input/30",
          "hover:bg-accent/40",
          open && "border-ring ring-3 ring-ring/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          ref={inputRef}
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          onFocus={openList}
          onClick={(e) => {
            openList()
            if (open && !filtering) e.currentTarget.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setFiltering(true)
            if (!open) setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (filtered[0]) pick(filtered[0].value)
            }
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-muted-foreground",
            !open && !selected && "text-muted-foreground",
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
