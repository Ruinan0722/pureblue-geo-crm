"use client"

import { useCallback, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/shared/lib/utils"

export type SortDir = "asc" | "desc"

export type SortState<K extends string = string> = {
  key: K | null
  dir: SortDir
}

/** 点击表头：新列升序；同列在升序/降序间切换 */
export function useTableSort<K extends string>(initial?: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial ?? { key: null, dir: "asc" })

  const toggleSort = useCallback((key: K) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" }
    })
  }, [])

  return { sort, toggleSort, setSort }
}

export function compareSortValues(a: unknown, b: unknown): number {
  const emptyA = a == null || a === ""
  const emptyB = b == null || b === ""
  if (emptyA && emptyB) return 0
  if (emptyA) return 1
  if (emptyB) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true, sensitivity: "base" })
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  getters: Partial<Record<K, (row: T) => unknown>>,
): T[] {
  if (!sort.key) return rows
  const get = getters[sort.key]
  if (!get) return rows
  const mul = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((left, right) => mul * compareSortValues(get(left), get(right)))
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onToggle,
  className,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onToggle: (key: K) => void
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <th className={cn("min-w-max whitespace-nowrap px-4 py-3 font-medium", className)}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex whitespace-nowrap items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{label}</span>
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden />
        )}
        <span className="sr-only">{active ? (sort.dir === "asc" ? "升序" : "降序") : "可排序"}</span>
      </button>
    </th>
  )
}
