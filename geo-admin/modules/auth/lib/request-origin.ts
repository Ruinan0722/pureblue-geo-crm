/** 从当前 HTTP 请求解析对外访问地址（支持局域网 IP / localhost） */
export function resolveRequestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http"
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  const url = new URL(req.url)
  return url.origin
}

export function resolveFeishuRedirectUri(req: Request): string {
  return `${resolveRequestOrigin(req)}/api/auth/feishu/callback`
}
