import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/customers/batch-assign-owner"

export async function POST() {
  return misconfiguredGeoApiProxy(API)
}
