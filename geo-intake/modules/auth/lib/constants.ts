/** 遗留 session cookie 名，仅用于清除旧版登录态 */
export const SESSION_COOKIE = "geo_session"
export const JWT_COOKIE = process.env.JWT_COOKIE ?? "geo_access_token"
export const INVITE_COOKIE = "geo_invite_token"

export type AuthState = { kind: "customer"; inviteToken: string } | { kind: "anonymous" }
