/** 统一解析 geo-api（detail）与 Next 本地路由（error）的错误响应 */
export function parseApiErrorMessage(
  body: unknown,
  fallback = "操作失败",
): string {
  if (!body || typeof body !== "object") return fallback
  const record = body as { error?: unknown; detail?: unknown; message?: unknown }

  if (typeof record.error === "string" && record.error.trim()) return record.error

  const detail = record.detail
  if (typeof detail === "string" && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== "object") return ""
        const msg = (item as { msg?: unknown }).msg
        return typeof msg === "string" ? msg : ""
      })
      .filter(Boolean)
    if (parts.length) return parts.join("；")
  }

  if (typeof record.message === "string" && record.message.trim()) return record.message
  return fallback
}
