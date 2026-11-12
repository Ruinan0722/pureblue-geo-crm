import { misconfiguredGeoApiProxy } from "@/shared/lib/geo-api-proxy"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return misconfiguredGeoApiProxy(`/api/projects/${path.join("/")}`)
}

export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return misconfiguredGeoApiProxy(`/api/projects/${path.join("/")}`)
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return misconfiguredGeoApiProxy(`/api/projects/${path.join("/")}`)
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return misconfiguredGeoApiProxy(`/api/projects/${path.join("/")}`)
}
