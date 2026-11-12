"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react"
import { cn } from "@/shared/lib/utils"

export type TreeFilterNode = {
  value: string
  label: string
  children: { value: string; label: string }[]
}

function TriCheckbox({
  checked,
  label,
  onChange,
  className,
}: {
  checked: boolean
  label: string
  onChange: () => void
  className?: string
}) {
  return (
    <label className={cn("flex min-w-0 cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border-border accent-primary"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  )
}

/**
 * 通用「一级 + 二级」勾选树筛选（线索来源、客户行业等共用）。
 * - 勾选二级时默认同时选中对应一级；
 * - `primary` 只包含「整类选中」的一级（无二级或全部二级已选）；
 *   二级部分选中时只按具体二级匹配，避免一级整类被意外放大。
 */
export function TreeCheckboxFilter({
  tree,
  primary,
  secondary,
  onValuesChange,
  searchPlaceholder,
  allPlaceholder,
  emptyText = "无匹配项",
  loading = false,
  onOpenChange,
  className,
}: {
  tree: TreeFilterNode[]
  primary: string[]
  secondary: string[]
  onValuesChange: (primary: string[], secondary: string[]) => void
  searchPlaceholder: string
  allPlaceholder: string
  emptyText?: string
  loading?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const primarySet = useMemo(() => new Set(primary), [primary])
  const detailSet = useMemo(() => new Set(secondary), [secondary])

  function isParentChecked(node: TreeFilterNode): boolean {
    if (node.children.length === 0) {
      return primarySet.has(node.value)
    }
    return primarySet.has(node.value) || node.children.some((child) => detailSet.has(child.value))
  }

  function toggleParent(node: TreeFilterNode) {
    if (node.children.length === 0) {
      onValuesChange(
        primarySet.has(node.value)
          ? primary.filter((v) => v !== node.value)
          : [...primary, node.value],
        secondary,
      )
      return
    }
    // 一级勾选 = 整类选中：带出全部二级并计入整类匹配
    if (isParentChecked(node)) {
      const remaining = new Set(secondary)
      for (const child of node.children) remaining.delete(child.value)
      onValuesChange(
        primary.filter((v) => v !== node.value),
        [...remaining],
      )
      return
    }
    const merged = new Set(secondary)
    for (const child of node.children) merged.add(child.value)
    onValuesChange(
      primary.includes(node.value) ? primary : [...primary, node.value],
      [...merged],
    )
  }

  function toggleExpand(value: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function toggleChild(node: TreeFilterNode, child: TreeFilterNode["children"][number]) {
    const has = detailSet.has(child.value)
    if (has) {
      // 取消二级后一级退出整类匹配，仅保留其余二级的精确匹配
      onValuesChange(
        primary.filter((v) => v !== node.value),
        secondary.filter((v) => v !== child.value),
      )
      return
    }
    // 勾选二级只勾选二级本身（一级仅联动展示为选中，不扩大为整类匹配）
    onValuesChange(primary, [...secondary, child.value])
  }

  const filteredTree = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tree
    return tree.flatMap((node) => {
      const parentHit =
        node.label.toLowerCase().includes(q) || node.value.toLowerCase().includes(q)
      const children = parentHit
        ? node.children
        : node.children.filter(
            (c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q),
          )
      return parentHit || children.length > 0 ? [{ ...node, children }] : []
    })
  }, [tree, query])

  const summary = useMemo(() => {
    const parts: string[] = []
    // 整类选中的一级会覆盖其全部二级；同值二级出现在多个一级下时避免重复展示
    const coveredDetails = new Set<string>()
    for (const node of tree) {
      if (primarySet.has(node.value)) {
        for (const child of node.children) coveredDetails.add(child.value)
      }
    }
    for (const node of tree) {
      if (primarySet.has(node.value)) {
        // 整类选中（点击一级 / 旧缓存）：只展示一级
        parts.push(node.label)
      } else {
        const selected = node.children
          .filter((c) => detailSet.has(c.value))
          .filter((c) => !coveredDetails.has(c.value))
          .map((c) => c.label)
        // 勾选二级：展示为「一级-二级」
        for (const label of selected) parts.push(`${node.label}-${label}`)
      }
    }
    return parts.join("，")
  }, [tree, primary, secondary])

  const allSelected =
    tree.length > 0 &&
    tree.every((node) =>
      node.children.length === 0
        ? primarySet.has(node.value)
        : node.children.every((c) => detailSet.has(c.value)),
    )

  const searching = query.trim().length > 0

  function toggleSelectAll() {
    if (allSelected) {
      onValuesChange([], [])
      return
    }
    onValuesChange(
      tree.map((node) => node.value),
      tree.flatMap((node) => node.children.map((c) => c.value)),
    )
  }

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
  }, [open, tree])

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
  }, [open])

  function closePanel() {
    setOpen(false)
    setQuery("")
    setExpanded(new Set())
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
            <div className="border-b border-border p-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-primary hover:bg-accent"
                >
                  {allSelected ? "取消全选" : "全选"}
                </button>
              </div>
            </div>
            <div role="listbox" aria-multiselectable="true" id={listId} className="max-h-72 overflow-y-auto overscroll-contain p-2">
              {loading ? (
                <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
                  加载中…
                </div>
              ) : filteredTree.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  {emptyText}
                </div>
              ) : (
                filteredTree.map((node) => {
                  const isExpanded = expanded.has(node.value)
                  const showChildren = isExpanded || searching
                  return (
                    <div key={node.value} className="mb-0.5">
                      <div className="flex items-center gap-1 rounded-md hover:bg-accent">
                        {node.children.length > 0 ? (
                          <button
                            type="button"
                            aria-label={isExpanded ? "收起二级" : "展开二级"}
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpand(node.value)}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronRight className="size-3.5" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span className="size-6 shrink-0" />
                        )}
                        <TriCheckbox
                          checked={isParentChecked(node)}
                          label={node.label}
                          onChange={() => toggleParent(node)}
                          className="min-w-0 flex-1 py-1.5 pr-2 font-medium"
                        />
                      </div>
                      {showChildren && node.children.length > 0 ? (
                        <div className="ml-5 border-l border-border pl-3">
                          {node.children.map((child) => (
                            <TriCheckbox
                              key={child.value}
                              checked={detailSet.has(child.value)}
                              label={child.label}
                              onChange={() => toggleChild(node, child)}
                              className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })
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
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => {
          const next = !open
          setOpen(next)
          onOpenChange?.(next)
        }}
        className={cn(
          "flex h-9 w-full items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-left text-sm transition-colors",
          "hover:bg-accent/40",
          open && "ring-2 ring-ring/30",
        )}
        title={summary || undefined}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            summary ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {summary || allPlaceholder}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {panel}
    </div>
  )
}
