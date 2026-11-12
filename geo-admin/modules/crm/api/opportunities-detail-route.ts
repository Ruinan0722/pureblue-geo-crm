import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/opportunities"

export async function PATCH() {
  return misconfiguredGeoApiProxy(API)
}

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}
