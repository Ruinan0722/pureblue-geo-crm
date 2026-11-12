"use client"

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react"
import { createPortal } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { useStaffNames } from "@/modules/crm/hooks/use-directory-options"

/** 从正文中解析已 @ 的成员（长名优先，避免短名误伤） */
export function extractMentions(text: string, options: readonly string[] = []): string[] {
  return findMentionRanges(text, options).map((r) => r.name).filter((name, i, arr) => arr.indexOf(name) === i)
}

type MentionRange = { start: number; end: number; name: string }

function findMentionRanges(text: string, options: readonly string[]): MentionRange[] {
  const sorted = [...options].sort((a, b) => b.length - a.length)
  const ranges: MentionRange[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== "@") {
      i += 1
      continue
    }
    let matched: MentionRange | null = null
    for (const name of sorted) {
      const token = `@${name}`
      if (text.startsWith(token, i)) {
        // 后面是结尾、空白或标点时才视为完整 mention，避免半截匹配
        const after = text[i + token.length]
        if (after === undefined || /[\s,，。；;!！?？、]/.test(after)) {
          matched = { start: i, end: i + token.length, name }
          break
        }
      }
    }
    if (matched) {
      ranges.push(matched)
      i = matched.end
    } else {
      i += 1
    }
  }
  return ranges
}

function mentionAtCaret(text: string, caret: number, options: readonly string[]): MentionRange | null {
  return (
    findMentionRanges(text, options).find((r) => caret > r.start && caret <= r.end) ?? null
  )
}

function mentionEndingAt(text: string, caret: number, options: readonly string[]): MentionRange | null {
  return findMentionRanges(text, options).find((r) => caret === r.end) ?? null
}

/** 合同等场景：下拉多选勾选成员（非沟通 @）；默认从 MySQL 通讯录拉取 */
export function MemberPicker({
  value,
  onChange,
  options,
  label = "成员（可多选）",
  placeholder = "请选择或搜索成员",
  emptyText = "无匹配成员",
  disabled,
}: {
  value: string[]
  onChange: (value: string[]) => void
  options?: string[]
  label?: string
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const { names: directoryNames } = useStaffNames()
  const resolved = options ?? directoryNames
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  /** 用户是否已改动输入；未改动前不按已选文案过滤，避免只剩当前项 */
  const [filtering, setFiltering] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const selectedSet = useMemo(() => new Set(value), [value])
  const displayText = value.join(", ")
  const displayValue = open ? query : displayText

  useEffect(() => {
    if (open && !filtering) setQuery(displayText)
  }, [displayText, open, filtering])

  const filtered = useMemo(() => {
    if (!open || !filtering) return resolved
    const q = query.trim().toLowerCase()
    if (!q) return resolved
    return resolved.filter((name) => name.toLowerCase().includes(q))
  }, [resolved, query, open, filtering])

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
  }, [open, value.length])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closeList()
    }
    function onKey(e: globalThis.KeyboardEvent) {
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
    setQuery(displayText)
    setFiltering(false)
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function toggle(member: string) {
    const next = selectedSet.has(member) ? value.filter((item) => item !== member) : [...value, member]
    onChange(next)
    // 勾选后回填已选名单，并退出筛选态（与单选下拉选中后展示文案一致）
    setQuery(next.join(", "))
    setFiltering(false)
  }

  const panel =
    open && coords
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
            className="z-[80] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
            data-member-picker-panel=""
          >
            <ul id={listId} role="listbox" aria-multiselectable className="max-h-56 overflow-y-auto overscroll-contain p-1">
              {resolved.length === 0 ? (
                <li className="px-2 py-2 text-center text-xs text-muted-foreground">
                  暂无成员（请确认通讯录已同步）
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-2 py-2 text-center text-xs text-muted-foreground">{emptyText}</li>
              ) : (
                filtered.map((member, index) => {
                  const selected = selectedSet.has(member)
                  return (
                    <li key={`${member}-${index}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          selected ? "bg-primary/10 text-primary" : "hover:bg-accent",
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggle(member)}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card",
                          )}
                          aria-hidden
                        >
                          {selected && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{member}</span>
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
    <div>
      {label ? <label className="mb-1 block text-xs text-muted-foreground">{label}</label> : null}
      <div ref={rootRef} className="relative">
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
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            autoComplete="off"
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
                const first = filtered[0]
                if (first) toggle(first)
              }
            }}
            className={cn(
              "min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted-foreground",
              !open && !displayText && "text-muted-foreground",
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
    </div>
  )
}

type MentionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string
  onChange: (value: string) => void
  onMentionsChange?: (mentions: string[]) => void
  options?: string[]
}

const EDITOR_TEXT_CLASS =
  "whitespace-pre-wrap break-words text-sm leading-5 md:text-sm px-2.5 py-2 min-h-16 w-full"

/**
 * 飞书式 @：输入 @ 弹出成员；选中后 @姓名 作为整体；↑↓ 选择成员
 */
export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  options,
  className,
  rows = 3,
  placeholder = "输入内容，使用 @ 提及成员…",
  onKeyDown,
  disabled,
  ...rest
}: MentionTextareaProps) {
  const { names: directoryNames } = useStaffNames()
  const resolvedOptions = options ?? directoryNames
  const ref = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [atStart, setAtStart] = useState<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(0)
  const openRef = useRef(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? resolvedOptions.filter((name) => name.toLowerCase().includes(q)) : resolvedOptions
  }, [resolvedOptions, query])

  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  openRef.current = open
  activeIndexRef.current = activeIndex

  const highlightNodes = useMemo(() => {
    const ranges = findMentionRanges(value, resolvedOptions)
    if (!ranges.length) return [{ type: "text" as const, text: value }]
    const nodes: { type: "text" | "mention"; text: string }[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) nodes.push({ type: "text", text: value.slice(cursor, range.start) })
      nodes.push({ type: "mention", text: value.slice(range.start, range.end) })
      cursor = range.end
    }
    if (cursor < value.length) nodes.push({ type: "text", text: value.slice(cursor) })
    return nodes
  }, [value, resolvedOptions])

  function syncMentionsFrom(text: string) {
    onMentionsChange?.(extractMentions(text, resolvedOptions))
  }

  function detectAt(text: string, caret: number, resetIndex: boolean) {
    const before = text.slice(0, caret)
    const simple = before.match(/@([^\s@]*)$/)
    if (!simple) {
      setOpen(false)
      setAtStart(null)
      setQuery("")
      return
    }

    const token = simple[0]
    const start = caret - token.length
    const nextQuery = simple[1] ?? ""

    // 已是完整 @姓名 原子时不再弹层
    if (resolvedOptions.some((name) => token === `@${name}`)) {
      setOpen(false)
      setAtStart(null)
      setQuery("")
      return
    }

    setAtStart(start)
    setQuery((prev) => {
      if (resetIndex || prev !== nextQuery) {
        activeIndexRef.current = 0
        setActiveIndex(0)
      }
      return nextQuery
    })
    setOpen(true)
  }

  function applyText(next: string, caret?: number) {
    onChange(next)
    syncMentionsFrom(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      if (typeof caret === "number") el.setSelectionRange(caret, caret)
      detectAt(next, typeof caret === "number" ? caret : el.selectionStart, true)
    })
  }

  function handleChange(next: string) {
    onChange(next)
    syncMentionsFrom(next)
    const caret = ref.current?.selectionStart ?? next.length
    detectAt(next, caret, true)
  }

  function insertMention(name: string) {
    if (atStart === null || !ref.current) return
    const caret = ref.current.selectionStart
    let before = value.slice(0, atStart)
    let after = value.slice(caret)
    // 前后各固定补两个空格（去掉原有空白再补齐）
    if (before.length > 0) before = before.replace(/\s*$/, "") + "  "
    const insertion = `@${name}`
    after = after.length > 0 ? "  " + after.replace(/^\s*/, "") : "  "
    const next = `${before}${insertion}${after}`
    const pos = before.length + insertion.length + (after.startsWith("  ") ? 2 : 0)
    setOpen(false)
    setAtStart(null)
    setQuery("")
    applyText(next, pos)
    ref.current.focus()
  }

  function deleteRange(start: number, end: number) {
    const next = value.slice(0, start) + value.slice(end)
    applyText(next, start)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const list = filteredRef.current

    // —— 下拉打开时：方向键只改高亮，不触发 textarea 光标移动 / 不重开 detect ——
    if (openRef.current && list.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => {
          const next = (i + 1) % list.length
          activeIndexRef.current = next
          return next
        })
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => {
          const next = (i - 1 + list.length) % list.length
          activeIndexRef.current = next
          return next
        })
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        e.stopPropagation()
        const name = list[activeIndexRef.current]
        if (name) insertMention(name)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        return
      }
    }

    const el = ref.current
    if (!el) {
      onKeyDown?.(e)
      return
    }

    const start = el.selectionStart
    const end = el.selectionEnd

    // —— @姓名 作为整体：退格 / 删除 ——
    if (e.key === "Backspace" && start === end) {
      const ending = mentionEndingAt(value, start, resolvedOptions)
      if (ending) {
        e.preventDefault()
        // 若后面紧跟空格且空格在光标处已越过，仅删 mention；光标在 mention 末尾时删 mention
        deleteRange(ending.start, ending.end)
        return
      }
      const inside = mentionAtCaret(value, start, resolvedOptions)
      if (inside) {
        e.preventDefault()
        deleteRange(inside.start, inside.end)
        return
      }
    }

    if (e.key === "Delete" && start === end) {
      const ranges = findMentionRanges(value, resolvedOptions)
      const ahead = ranges.find((r) => r.start === start)
      if (ahead) {
        e.preventDefault()
        deleteRange(ahead.start, ahead.end)
        return
      }
      const inside = mentionAtCaret(value, start + 1, resolvedOptions)
      if (inside) {
        e.preventDefault()
        deleteRange(inside.start, inside.end)
        return
      }
    }

    // —— 光标左右移动时跳过整块 mention ——
    if (e.key === "ArrowLeft" && start === end && !e.shiftKey && !openRef.current) {
      const inside = mentionAtCaret(value, start, resolvedOptions)
      if (inside && start > inside.start) {
        e.preventDefault()
        el.setSelectionRange(inside.start, inside.start)
        return
      }
    }
    if (e.key === "ArrowRight" && start === end && !e.shiftKey && !openRef.current) {
      const inside = mentionAtCaret(value, start + 1, resolvedOptions) || mentionAtCaret(value, start, resolvedOptions)
      if (inside && start < inside.end) {
        e.preventDefault()
        el.setSelectionRange(inside.end, inside.end)
        return
      }
    }

    // 点击落在 mention 中间时，选中整块（mousedown/click 另处理）；这里处理选区被拖进中间的情况

    onKeyDown?.(e)
  }

  function handleSelect() {
    const el = ref.current
    if (!el || openRef.current) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start !== end) return
    const inside = mentionAtCaret(value, start, resolvedOptions)
    if (inside && start > inside.start && start < inside.end) {
      el.setSelectionRange(inside.start, inside.end)
    }
  }

  useLayoutEffect(() => {
    if (!open || !listRef.current) return
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  function syncScroll() {
    if (backdropRef.current && ref.current) {
      backdropRef.current.scrollTop = ref.current.scrollTop
      backdropRef.current.scrollLeft = ref.current.scrollLeft
    }
  }

  const minHeightStyle = { minHeight: `${Math.max(rows, 2) * 1.25 + 1}rem` } satisfies CSSProperties

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {/* 高亮层：普通文字 + 整体样式的 @成员 */}
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(EDITOR_TEXT_CLASS, "pointer-events-none absolute inset-0 z-0 overflow-auto text-foreground")}
          style={minHeightStyle}
        >
          {value ? (
            highlightNodes.map((node, i) =>
              node.type === "mention" ? (
                <span
                  key={i}
                  className="rounded-sm bg-primary/15 font-medium text-primary shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                >
                  {node.text}
                </span>
              ) : (
                <span key={i}>{node.text}</span>
              ),
            )
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          {/* 末尾占位，避免空行高度塌陷 */}
          <span>{"\n"}</span>
        </div>
        <textarea
          {...rest}
          ref={ref}
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder=""
          className={cn(
            EDITOR_TEXT_CLASS,
            "relative z-10 resize-y border-0 bg-transparent text-transparent caret-foreground outline-none",
            "selection:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          style={minHeightStyle}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          onSelect={handleSelect}
          onClick={() => {
            handleSelect()
            const el = ref.current
            if (!el) return
            detectAt(el.value, el.selectionStart, false)
          }}
          onKeyUp={(e) => {
            // 方向键在下拉打开时已处理，避免 keyUp 重置高亮
            if (openRef.current && ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) return
            const el = ref.current
            if (!el) return
            detectAt(el.value, el.selectionStart, e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150)
          }}
        />
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-md ring-1 ring-black/5"
          role="listbox"
          aria-label="选择要 @ 的成员"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">无匹配成员</p>
          ) : (
            <ul ref={listRef} className="max-h-48 overflow-y-auto py-1">
              {filtered.map((name, index) => (
                <li key={`${name}-${index}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertMention(name)
                    }}
                    onMouseEnter={() => {
                      activeIndexRef.current = index
                      setActiveIndex(index)
                    }}
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                      {name.slice(0, 1)}
                    </span>
                    <span className="font-medium">@{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            ↑↓ 选择 · Enter 确认 · Esc 关闭 · 退格删除整块 @成员
          </p>
        </div>
      )}
    </div>
  )
}

export function MentionTags({ mentions }: { mentions?: string[] }) {
  if (!mentions?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {mentions.map((member, index) => (
        <span key={`${member}-${index}`} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          @{member}
        </span>
      ))}
    </div>
  )
}
