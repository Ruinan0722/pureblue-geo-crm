import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

/** @deprecated 客户提交已改走 /api/intake/submit；本路由仅保留误配提示。 */
const API = "/api/requests"

export async function POST() {
  return misconfiguredGeoApiProxy(API)
}
