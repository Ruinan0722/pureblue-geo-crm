import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

export async function PUT(_req: Request) {
  return misconfiguredGeoApiProxy("/api/release-notes")
}
