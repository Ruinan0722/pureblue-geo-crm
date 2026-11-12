/**
 * 统一错误码镜像（禁止手改）
 * 唯一权威源：geo-api/app/core/error_codes.py
 * 校验：cd geo-api && .venv/bin/python -m pytest tests/test_error_code_catalog.py -q
 */

export const ERROR_CODE_HTTP: Record<string, number> = {
  app_error: 400,
  not_found: 404,
  permission_denied: 403,
  unauthorized: 401,
  validation_error: 400,
  conflict: 409,
  invite_limit: 400,
}

export const ERROR_CODE_MESSAGES: Record<string, string> = {
  app_error: "请求处理失败",
  not_found: "资源不存在",
  permission_denied: "无权限执行此操作",
  unauthorized: "请先登录",
  validation_error: "参数无效",
  conflict: "业务冲突",
  invite_limit: "邀请数量已达上限",
}

export type ErrorCode = keyof typeof ERROR_CODE_HTTP

/** 从 API 错误响应中提取错误码（{error, detail?: {code}} 或 {detail: {code}}）。 */
export function errorCodeOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const root = payload as Record<string, unknown>
  const detail = root.detail
  if (detail && typeof detail === "object") {
    const code = (detail as Record<string, unknown>).code
    if (typeof code === "string") return code
  }
  const code = root.code
  return typeof code === "string" ? code : undefined
}
