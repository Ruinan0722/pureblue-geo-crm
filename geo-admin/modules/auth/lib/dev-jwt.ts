import { SignJWT } from "jose"

import { getGeoEnv } from "@/shared/lib/geo-env"

const JWT_COOKIE = process.env.JWT_COOKIE ?? "geo_access_token"

export function jwtCookieName(): string {
  return JWT_COOKIE
}

export async function createDevAccessToken(userId: string, role: string): Promise<string> {
  const secret = process.env.JWT_SECRET_KEY
  if (!secret) {
    throw new Error("JWT_SECRET_KEY 未配置")
  }
  const algorithm = process.env.JWT_ALGORITHM ?? "HS256"
  const env = getGeoEnv()
  const expectedExpiresIn = env === "production" ? 60 * 60 * 24 : 60 * 60 * 24 * 7
  const expiresIn = Number(process.env.JWT_ACCESS_TOKEN_EXPIRE_SECONDS ?? expectedExpiresIn)
  if (expiresIn !== expectedExpiresIn) {
    throw new Error(
      `${env} 环境 JWT_ACCESS_TOKEN_EXPIRE_SECONDS 必须为 ${expectedExpiresIn} 秒`,
    )
  }
  return new SignJWT({ role, typ: "access" })
    .setSubject(userId)
    .setProtectedHeader({ alg: algorithm })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(new TextEncoder().encode(secret))
}

export function jwtCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  }
}
