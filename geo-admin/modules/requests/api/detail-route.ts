import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/requests"

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}

export async function PATCH() {
  return misconfiguredGeoApiProxy(API)
}
