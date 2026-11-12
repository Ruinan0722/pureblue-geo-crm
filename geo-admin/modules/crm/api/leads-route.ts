import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

const API = "/api/leads"

export async function GET() {
  return misconfiguredGeoApiProxy(API)
}

export async function POST() {
  return misconfiguredGeoApiProxy(API)
}
