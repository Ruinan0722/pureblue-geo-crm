import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/projects"

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}
