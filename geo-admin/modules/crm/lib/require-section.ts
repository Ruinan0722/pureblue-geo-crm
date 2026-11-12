import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { JWT_COOKIE } from "@/modules/auth/lib/constants"
import { verifyAccessToken } from "@/modules/auth/lib/jwt-auth"
import type { SectionKey } from "@/modules/auth/lib/permissions"

/**
 * CRM 薄页面登录守卫（轻量）。
 *
 * 故意不做 MySQL / RBAC 全量解析：侧栏切换时每次 `getAuth()` 都会打库，
 * 导致 RSC 长时间无 HTML → 主内容区白屏。登录态由 middleware + JWT 校验；
 * 板块权限由 AppShell（AuthProvider 已缓存的 permissions）拦截，业务数据由 geo-api 强制鉴权。
 * 因此本函数只保证「已登录」，不保证「有该 section」。
 */
export async function requireCrmSection(_section: SectionKey): Promise<void> {
  const store = await cookies()
  const token = store.get(JWT_COOKIE)?.value
  if (!token) redirect("/login")
  const verified = await verifyAccessToken(token)
  if (!verified) redirect("/login")
}
