import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/leads/stats"

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}
