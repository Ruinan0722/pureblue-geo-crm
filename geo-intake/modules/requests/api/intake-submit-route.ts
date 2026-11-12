import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/intake/submit"

/** 未配置 GEO_API_URL 时的占位；正式环境由 next.config rewrite 到 geo-api。 */
export async function POST() {
  return misconfiguredGeoApiProxy(API)
}
