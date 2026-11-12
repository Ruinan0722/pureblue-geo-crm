import { cookies } from "next/headers"
import { INVITE_COOKIE } from "./constants"

function shouldUseSecureCookies() {
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL
  if (publicUrl) return publicUrl.startsWith("https://")
  return process.env.NODE_ENV === "production"
}

export async function getInviteTokenFromCookies(): Promise<string | null> {
  const store = await cookies()
  return store.get(INVITE_COOKIE)?.value ?? null
}

export function inviteCookieOptions() {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  }
}
