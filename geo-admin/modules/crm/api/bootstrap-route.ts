import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/crm/bootstrap"

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}
