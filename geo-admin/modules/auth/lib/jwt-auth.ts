import { jwtVerify } from "jose"
import type { NextRequest } from "next/server"
import { JWT_COOKIE } from "./constants"

export async function verifyAccessToken(token: string): Promise<{ userId: string } | null> {
  const secret = process.env.JWT_SECRET_KEY
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: [process.env.JWT_ALGORITHM ?? "HS256"],
    })
    if (payload.typ !== "access") return null
    const userId = payload.sub
    if (!userId || typeof userId !== "string") return null
    return { userId }
  } catch {
    return null
  }
}

export function getAccessTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(JWT_COOKIE)?.value ?? null
}
