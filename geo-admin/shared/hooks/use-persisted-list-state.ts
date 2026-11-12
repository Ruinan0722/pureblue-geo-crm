"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { readJson, writeJson } from "@/shared/lib/storage"

export type ListApplied<Q> = { query: Q; page: number }

function isValidApplied<Q>(value: unknown): value is ListApplied<Q> {
  if (!value || typeof value !== "object") return false
  const v = value as ListApplied<Q>
  return typeof v.page === "number" && v.page >= 1 && v.query != null && typeof v.query === "object"
}

/**
 * 列表筛选 + 分页持久化到 sessionStorage。
 * 进入详情再返回列表时恢复页码与筛选，避免总是回到第 1 页。
 */
export function usePersistedListApplied<Q extends Record<string, unknown>>(
  storageKey: string,
  emptyQuery: Q,
): {
  draft: Q
  setDraft: Dispatch<SetStateAction<Q>>
  applied: ListApplied<Q>
  setApplied: Dispatch<SetStateAction<ListApplied<Q>>>
  /** 完成恢复前为 false，避免先用默认第 1 页请求接口 */
  listStateReady: boolean
} {
  const [draft, setDraft] = useState<Q>(emptyQuery)
  const [applied, setApplied] = useState<ListApplied<Q>>({ query: emptyQuery, page: 1 })
  const [listStateReady, setListStateReady] = useState(false)

  useEffect(() => {
    setListStateReady(false)
    const stored = readJson<ListApplied<Q>>("session", storageKey, {
      sanitize: (raw) => (isValidApplied<Q>(raw) ? raw : null),
    })
    if (stored) {
      // 与当前默认字段合并，避免旧缓存缺 key 导致筛选控件异常
      const query = { ...emptyQuery, ...stored.query }
      const page = Number.isFinite(stored.page) && stored.page >= 1 ? Math.floor(stored.page) : 1
      setApplied({ query, page })
      setDraft(query)
    } else {
      // 身份切换后 storageKey 会变化；没有该身份的缓存时必须恢复默认条件，
      // 避免沿用上一身份的筛选导致“数据不可见”。
      setApplied({ query: emptyQuery, page: 1 })
      setDraft(emptyQuery)
    }
    setListStateReady(true)
    // emptyQuery 为模块常量，不纳入 deps
     
  }, [storageKey])

  useEffect(() => {
    if (!listStateReady) return
    writeJson("session", storageKey, applied)
  }, [applied, listStateReady, storageKey])

  return { draft, setDraft, applied, setApplied, listStateReady }
}
