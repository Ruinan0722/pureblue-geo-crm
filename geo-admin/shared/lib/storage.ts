/**
 * 客户端本地/会话存储统一封装。
 *
 * 约定：
 * - 所有浏览器存储读写尽量走本模块，禁止在组件里裸调 localStorage/sessionStorage；
 * - 新 key 一律用 storageKey() 生成：`geo-admin:<namespace>:v<version>[:<id>]`；
 * - 读取时统一 JSON 解析 + 校验 + 可选 TTL，非法/过期自动清除；
 * - 历史 key 通过 migrateFromLegacy() 一次性升级并删除，不长期保留兼容分支。
 *
 * 说明：geo-intake 客户填报草稿刻意用 localStorage 跨会话保留（外部客户可能隔天
 * 回来继续填），与 geo-admin 内 sessionStorage 草稿语义不同，属有意为之。
 */

export type StorageArea = "local" | "session"

export function storageArea(area: StorageArea): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return area === "local" ? window.localStorage : window.sessionStorage
  } catch {
    return null // 隐私模式 / 存储被禁用
  }
}

/** 新 key 统一命名：geo-admin:<namespace>:v<version>[:<id>] */
export function storageKey(namespace: string, version: number, id?: string): string {
  const base = `geo-admin:${namespace}:v${version}`
  return id ? `${base}:${id}` : base
}

export function readRaw(area: StorageArea, key: string): string | null {
  const store = storageArea(area)
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

export function writeRaw(area: StorageArea, key: string, value: string): boolean {
  const store = storageArea(area)
  if (!store) return false
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeRaw(area: StorageArea, key: string): void {
  const store = storageArea(area)
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    // ignore
  }
}

export interface JsonReadOptions<T> {
  /** 可选 TTL：读取时若 savedAt 超过 ttlMs 则清除并视为不存在 */
  ttlMs?: number
  /** 校验/规范化读取值；返回 null 表示无效（自动清除） */
  sanitize?: (raw: unknown) => T | null
  /**
   * sanitize 返回 null 时是否删除该 key。默认 false（非破坏）：
   * 遇到未来版本/未知格式的数据应保留原样，由对应版本的代码负责升级，
   * 避免旧版前端误删新版数据。仅 JSON 无法解析或 TTL 过期时才无条件清除。
   */
  removeInvalid?: boolean
}

export function readJson<T>(
  area: StorageArea,
  key: string,
  options: JsonReadOptions<T> = {},
): T | null {
  const raw = readRaw(area, key)
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    removeRaw(area, key)
    return null
  }
  if (options.ttlMs && typeof parsed === "object" && parsed !== null) {
    const savedAt = (parsed as { savedAt?: unknown }).savedAt
    if (typeof savedAt === "number" && Date.now() - savedAt > options.ttlMs) {
      removeRaw(area, key)
      return null
    }
  }
  const value = options.sanitize ? options.sanitize(parsed) : (parsed as T)
  if (value == null) {
    if (options.removeInvalid) removeRaw(area, key)
    return null
  }
  return value
}

export function writeJson(area: StorageArea, key: string, value: unknown): boolean {
  return writeRaw(area, key, JSON.stringify(value))
}

/** 收集指定前缀下的全部 key（用于按 namespace 清理）。 */
export function collectKeys(area: StorageArea, prefix: string): string[] {
  const store = storageArea(area)
  if (!store) return []
  const keys: string[] = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i)
      if (k && k.startsWith(prefix)) keys.push(k)
    }
  } catch {
    return []
  }
  return keys
}

export function clearKeysByPrefix(area: StorageArea, prefix: string): void {
  for (const key of collectKeys(area, prefix)) removeRaw(area, key)
}

/**
 * 历史 key 一次性迁移：按顺序读取 legacyKeys，命中可解析值时写入新 key 并删除旧 key。
 * 全部未命中返回 null。transform 返回 null 表示该 key 内容不可用（删除）。
 * 新 key 写入失败时保留旧 key，避免数据丢失（下次读取再尝试迁移）。
 */
export function migrateFromLegacy<T>(
  area: StorageArea,
  legacyKeys: string[],
  newKey: string,
  transform: (raw: string) => T | null,
  write: (value: T) => boolean,
): T | null {
  if (typeof window === "undefined") return null
  for (const legacyKey of legacyKeys) {
    const raw = readRaw(area, legacyKey)
    if (raw == null) continue
    const value = transform(raw)
    if (value != null) {
      const written = write(value)
      if (written) removeRaw(area, legacyKey)
      return value
    }
    removeRaw(area, legacyKey)
  }
  return null
}
