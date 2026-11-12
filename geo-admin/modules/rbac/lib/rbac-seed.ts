/**
 * RBAC 种子展示常量（geo-api 已接管目录/角色/部门规则的初始化与同步）。
 * 前端不再直连 MySQL 执行 DDL / 写入；发版对齐 seed 走 geo-api POST /api/rbac/sync-identity。
 */
import { cookies } from "next/headers"
import { ADMIN_LEVEL_PERMISSIONS } from "@/modules/rbac/lib/rbac-seed-data"
import { jwtCookieName } from "@/modules/auth/lib/dev-jwt"

export { ADMIN_LEVEL_PERMISSIONS }

export function getDataScopeLabels(): Record<string, string> {
  return {
    own: "仅本人",
    department: "部门及下属",
    all: "全部数据",
  }
}

/** 冷启动初始化已由 geo-api 负责（seed_rbac / ensure_initialized）；此处仅保留兼容空实现。 */
export async function ensureRbacInitialized(): Promise<void> {
  return
}

/** 按代码种子恢复系统角色：转调 geo-api，避免前端直连 MySQL。 */
export async function syncIdentityRolesMysql(): Promise<void> {
  const base = (process.env.GEO_API_URL || "").replace(/\/$/, "")
  const store = await cookies()
  const token = store.get(jwtCookieName())?.value
  if (!base) throw new Error("GEO_API_URL 未配置")
  const res = await fetch(`${base}/api/rbac/sync-identity`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `${jwtCookieName()}=${token}` } : {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg =
      body && typeof body === "object" && typeof (body as { error?: string }).error === "string"
        ? (body as { error: string }).error
        : `同步失败（${res.status}）`
    throw new Error(msg)
  }
}
