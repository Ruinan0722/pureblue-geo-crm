import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/customers"

export async function PATCH() {
  return misconfiguredGeoApiProxy(API)
}
