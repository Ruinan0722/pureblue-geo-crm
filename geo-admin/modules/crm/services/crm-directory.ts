/** CRM 通知 / 通讯录：读写 geo-api → MySQL。 */

import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import type { CrmNotification } from "@/modules/crm/lib/crm-data"

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

function normalizeNotification(raw: Record<string, unknown>): CrmNotification {
  return {
    id: String(raw.id || ""),
    targetName: String(raw.targetName ?? raw.target_name ?? ""),
    actor: String(raw.actor || ""),
    message: String(raw.message || ""),
    href: String(raw.href || ""),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
    read: Boolean(raw.read ?? raw.isRead ?? raw.is_read),
  }
}

export async function fetchNotifications(limit = 100): Promise<CrmNotification[]> {
  const res = await fetch(`/api/crm/notifications?limit=${limit}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) throw new Error(await readError(res, "加载通知失败"))
  const data = (await res.json()) as { items?: unknown[] }
  const items = Array.isArray(data.items) ? data.items : []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map(normalizeNotification)
}

export async function fetchNotificationWsTicket(): Promise<{ ticket: string; expiresIn: number }> {
  const res = await fetch("/api/crm/notifications/ws-ticket", {
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) throw new Error(await readError(res, "获取通知通道失败"))
  const data = (await res.json()) as { ticket?: string; expiresIn?: number; expires_in?: number }
  const ticket = String(data.ticket || "")
  if (!ticket) throw new Error("获取通知通道失败")
  return {
    ticket,
    expiresIn: Number(data.expiresIn ?? data.expires_in ?? 60),
  }
}

/** 本地 admin(47821) → api(8000)；生产同域走当前 host。可用 NEXT_PUBLIC_GEO_API_WS_URL 覆盖。 */
export function buildNotificationWsUrl(ticket: string): string {
  const explicit = process.env.NEXT_PUBLIC_GEO_API_WS_URL?.replace(/\/$/, "")
  const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:"
  let base = explicit
  if (!base && typeof window !== "undefined") {
    const { hostname, port } = window.location
    if (port === "47821" || port === "3000" || hostname === "localhost" || hostname === "127.0.0.1") {
      base = `${proto}//${hostname}:8000`
    } else {
      base = `${proto}//${window.location.host}`
    }
  }
  if (!base) base = "ws://127.0.0.1:8000"
  return `${base}/api/crm/notifications/ws?ticket=${encodeURIComponent(ticket)}`
}

export async function createNotifications(
  items: Array<{ targetName: string; message: string; href: string }>,
  mentionScope?: MentionScope,
): Promise<CrmNotification[]> {
  if (!items.length) return []
  const res = await fetch("/api/crm/notifications", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mentionScope: mentionScope || undefined,
      items: items.map((item) => ({
        targetName: item.targetName,
        message: item.message,
        href: item.href,
      })),
    }),
  })
  if (!res.ok) throw new Error(await readError(res, "写入通知失败"))
  const data = (await res.json()) as { items?: unknown[] }
  const list = Array.isArray(data.items) ? data.items : []
  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map(normalizeNotification)
}

export async function markNotificationRead(id: string): Promise<CrmNotification> {
  const res = await fetch(`/api/crm/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
    credentials: "include",
  })
  if (!res.ok) throw new Error(await readError(res, "标记已读失败"))
  return normalizeNotification((await res.json()) as Record<string, unknown>)
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await fetch("/api/crm/notifications/read-all", {
    method: "POST",
    credentials: "include",
  })
  if (!res.ok) throw new Error(await readError(res, "全部已读失败"))
}

export type DirectoryMember = { id: string; name: string; role?: string; departmentNames?: string[] }
export type SalesColleague = { id: string; name: string; jobTitle?: string; departmentNames?: string[] }
export type MentionScope = "leads" | "customers" | "requests" | "opportunities"

export type DirectoryQuery = {
  mentionScope?: MentionScope
  /** 角色过滤（OR 部门名） */
  roles?: string[]
  /** 部门名过滤（OR 角色）；匹配 users.department_names */
  departmentNames?: string[]
  /** 仅返回当前登录人的管辖成员（不含本人），用于 Leader 分配下属。 */
  managedOnly?: boolean
  /** 兼容旧客户端；@ 候选现统一返回飞书全组织在职成员。 */
  entityType?: MentionScope
  entityId?: string
}

/** Strict Mode / 并发挂载时合并同 key 的进行中请求，避免重复打网 */
function shareInflight<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = map.get(key)
  if (existing) return existing
  const task = run().finally(() => {
    if (map.get(key) === task) map.delete(key)
  })
  map.set(key, task)
  return task
}

const directoryInflight = new Map<string, Promise<string[]>>()
const directoryMembersInflight = new Map<string, Promise<DirectoryMember[]>>()
const salesColleaguesInflight = new Map<string, Promise<{ names: string[]; departmentLabel: string }>>()

export async function fetchStaffDirectory(
  mentionScopeOrQuery?: MentionScope | DirectoryQuery,
): Promise<string[]> {
  const query: DirectoryQuery =
    typeof mentionScopeOrQuery === "string" || mentionScopeOrQuery == null
      ? { mentionScope: mentionScopeOrQuery }
      : mentionScopeOrQuery
  const params = new URLSearchParams()
  if (query.mentionScope) params.set("mentionScope", query.mentionScope)
  if (query.roles?.length) params.set("roles", query.roles.join(","))
  if (query.departmentNames?.length) params.set("departmentNames", query.departmentNames.join(","))
  if (query.managedOnly) params.set("managedOnly", "true")
  if (query.entityType) params.set("entityType", query.entityType)
  if (query.entityId) params.set("entityId", query.entityId)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return shareInflight(directoryInflight, qs, async () => {
    const res = await fetch(`/api/users/directory${qs}`, { credentials: "include", cache: "no-store" })
    if (!res.ok) throw new Error(await readError(res, "加载通讯录失败"))
    const data = (await res.json()) as { members?: DirectoryMember[] }
    return (data.members ?? []).map((m) => m.name).filter(Boolean)
  })
}

/** 团队协作成员选择器使用：返回人员 ID、姓名、角色和部门，而不是只返回姓名。 */
export async function fetchStaffDirectoryMembers(query: DirectoryQuery = {}): Promise<DirectoryMember[]> {
  const params = new URLSearchParams()
  if (query.mentionScope) params.set("mentionScope", query.mentionScope)
  if (query.roles?.length) params.set("roles", query.roles.join(","))
  if (query.departmentNames?.length) params.set("departmentNames", query.departmentNames.join(","))
  if (query.managedOnly) params.set("managedOnly", "true")
  if (query.entityType) params.set("entityType", query.entityType)
  if (query.entityId) params.set("entityId", query.entityId)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return shareInflight(directoryMembersInflight, qs, async () => {
    const res = await fetch(`/api/users/directory${qs}`, { credentials: "include", cache: "no-store" })
    if (!res.ok) throw new Error(await readError(res, "加载团队成员通讯录失败"))
    const data = (await res.json()) as { members?: DirectoryMember[] }
    return (data.members ?? []).filter((member) => Boolean(member.name))
  })
}

async function loadSalesColleaguesPayload(): Promise<{ names: string[]; departmentLabel: string }> {
  return shareInflight(salesColleaguesInflight, "default", async () => {
    // 默认走飞书销售组织快照（/api/users/sales-colleagues）。
    // 仅当显式 GEO_FEATURE_DEV_SALES_NAMES=true 时才回退测试身份名单（联调旁路）。
    const { isFeatureEnabled } = await import("@/shared/lib/geo-features")
    if (isFeatureEnabled("DEV_SALES_NAMES")) {
      const { DEV_SALES_NAMES } = await import("@/modules/auth/lib/dev-identities")
      return { names: [...DEV_SALES_NAMES], departmentLabel: "本地测试角色" }
    }
    const res = await fetch("/api/users/sales-colleagues", { credentials: "include", cache: "no-store" })
    if (!res.ok) throw new Error(await readError(res, "加载销售同事失败"))
    const data = (await res.json()) as {
      colleagues?: SalesColleague[]
      departmentLabel?: string
      department_label?: string
    }
    return {
      names: (data.colleagues ?? []).map((c) => c.name).filter(Boolean),
      departmentLabel: String(data.departmentLabel || data.department_label || "销售部"),
    }
  })
}

export async function fetchSalesColleagueNames(): Promise<string[]> {
  const data = await loadSalesColleaguesPayload()
  return data.names
}

/** 销售同事 + 部门文案（负责人下拉旁提示） */
export async function fetchSalesColleagues(): Promise<{
  names: string[]
  departmentLabel: string
}> {
  return loadSalesColleaguesPayload()
}

export type DirectManagerResult = {
  name: string
  managerName: string
  managerUserId?: string | null
  source?: string | null
  message?: string
}

/** 按签订人姓名查询飞书直属上级 */
export async function fetchDirectManagerByName(name: string): Promise<DirectManagerResult> {
  const qs = `?name=${encodeURIComponent(name.trim())}`
  const res = await fetch(`/api/users/direct-manager${qs}`, { credentials: "include", cache: "no-store" })
  if (!res.ok) throw new Error(await readError(res, "查询直属上级失败"))
  const data = (await res.json()) as Record<string, unknown>
  return {
    name: String(data.name || name),
    managerName: String(data.managerName ?? data.manager_name ?? ""),
    managerUserId: (data.managerUserId ?? data.manager_user_id ?? null) as string | null,
    source: (data.source as string | null) ?? null,
    message: String(data.message || ""),
  }
}
