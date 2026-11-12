"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { buildPageItems, DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"

type ListPaginationProps = {
  total: number
  page: number
  pageSize?: number
  onPageChange: (page: number) => void
  loading?: boolean
  /** 追加在「共 N 条…」后的说明，例如筛选状态 */
  hint?: string
  label?: string
}

export function ListPagination({
  total,
  page,
  pageSize = DEFAULT_LIST_PAGE_SIZE,
  onPageChange,
  loading = false,
  hint,
  label = "条",
}: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const rangeFrom = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeTo = Math.min(currentPage * pageSize, total)
  const pageItems = buildPageItems(currentPage, totalPages)

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === currentPage || loading) return
    onPageChange(next)
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-xs text-muted-foreground">
        共 {total} {label}
        {total > 0 ? `，当前 ${rangeFrom}-${rangeTo}` : ""}
        ，第 {currentPage}/{totalPages} 页
        {hint ? hint : ""}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={currentPage <= 1 || loading}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <span key={`e-${index}`} className="px-1 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === currentPage ? "default" : "outline"}
              size="sm"
              className="min-w-8"
              disabled={loading}
              onClick={() => goToPage(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={currentPage >= totalPages || loading}
          onClick={() => goToPage(currentPage + 1)}
        >
          下一页
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
