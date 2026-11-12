import { NextResponse } from "next/server"

/** 业务 API 应由 next.config rewrite 代理到 geo-api；若命中本地 route 说明代理未生效 */
export function misconfiguredGeoApiProxy(apiPath: string) {
  return NextResponse.json(
    { error: `配置错误：${apiPath} 应由 GEO_API_URL 代理到 geo-api` },
    { status: 500 },
  )
}
