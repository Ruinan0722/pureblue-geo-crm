/** 管理端列表统一每页条数 */
export const DEFAULT_LIST_PAGE_SIZE = 10

export function buildPageItems(current: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: Array<number | "ellipsis"> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(totalPages - 1, current + 1)
  if (start > 2) items.push("ellipsis")
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < totalPages - 1) items.push("ellipsis")
  items.push(totalPages)
  return items
}

export function paginateSlice<T>(
  items: T[],
  page: number,
  pageSize: number = DEFAULT_LIST_PAGE_SIZE,
): {
  pageItems: T[]
  total: number
  totalPages: number
  currentPage: number
  rangeFrom: number
  rangeTo: number
} {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * pageSize
  return {
    pageItems: items.slice(start, start + pageSize),
    total,
    totalPages,
    currentPage,
    rangeFrom: total === 0 ? 0 : start + 1,
    rangeTo: Math.min(start + pageSize, total),
  }
}
