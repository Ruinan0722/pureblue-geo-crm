import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ version: string }> },
) {
  const { version } = await ctx.params
  return misconfiguredGeoApiProxy(`/api/release-notes/${version}`)
}
