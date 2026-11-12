/** 按实体缓存审计列表，供 Tab 角标与历史列表共用，避免重复请求与计数不一致。 */

import { fetchAuditRecords } from "@/modules/audit/services/audit-api"
import type { AuditRecord } from "@/modules/audit/context/audit-provider"

/**
 * 模块级缓存只在当前 SPA 会话内存活，且只随“新访问的实体”增长。
 * 加上容量上限并按访问顺序淘汰，避免长时间不刷新页面时缓存无限膨胀。
 */
const MAX_CACHED_ENTITIES = 50

const remoteAuditCache = new Map<string, AuditRecord[]>()
const remoteAuditListeners = new Map<string, Set<() => void>>()
const remoteAuditInflight = new Map<string, Promise<AuditRecord[]>>()

/** 写入/命中时把实体移到最新位置，超出容量则淘汰最久未访问的实体。 */
function touchCache(entityId: string, items: AuditRecord[]) {
  remoteAuditCache.delete(entityId)
  remoteAuditCache.set(entityId, items)
  while (remoteAuditCache.size > MAX_CACHED_ENTITIES) {
    const oldest = remoteAuditCache.keys().next().value
    if (oldest === undefined) break
    remoteAuditCache.delete(oldest)
  }
}

export function getCachedEntityAudits(entityId: string): AuditRecord[] | undefined {
  return remoteAuditCache.get(entityId)
}

export function subscribeEntityAudits(entityId: string, listener: () => void) {
  let set = remoteAuditListeners.get(entityId)
  if (!set) {
    set = new Set()
    remoteAuditListeners.set(entityId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) remoteAuditListeners.delete(entityId)
  }
}

function notify(entityId: string) {
  remoteAuditListeners.get(entityId)?.forEach((fn) => fn())
}

export function loadEntityAudits(entityId: string, { force = false }: { force?: boolean } = {}) {
  if (!force) {
    const inflight = remoteAuditInflight.get(entityId)
    if (inflight) return inflight
    const cached = remoteAuditCache.get(entityId)
    if (cached) {
      // 命中缓存也刷新访问顺序，保证 LRU 淘汰的是“最久没看”的实体
      touchCache(entityId, cached)
      return Promise.resolve(cached)
    }
  }
  const task = fetchAuditRecords({ entityId, limit: 500 })
    .then((items) => {
      touchCache(entityId, items)
      notify(entityId)
      return items
    })
    .catch((err) => {
      // 失败不清空已有缓存
      throw err
    })
    .finally(() => {
      remoteAuditInflight.delete(entityId)
    })
  remoteAuditInflight.set(entityId, task)
  return task
}

/** 写入审计后刷新相关实体缓存 */
export function invalidateEntityAuditCache(...entityIds: Array<string | undefined | null>) {
  const unique = [...new Set(entityIds.map((id) => (id || "").trim()).filter(Boolean))]
  for (const id of unique) {
    remoteAuditCache.delete(id)
    void loadEntityAudits(id, { force: true }).catch(() => undefined)
  }
}
