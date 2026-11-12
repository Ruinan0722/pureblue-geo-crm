const FEISHU_BASE = "https://open.feishu.cn/open-apis"
const FEISHU_AUTH_BASE = "https://accounts.feishu.cn/open-apis"

export interface FeishuUserInfo {
  open_id: string
  name: string
  avatar_url?: string
  tenant_key: string
}

interface TokenData extends FeishuUserInfo {
  access_token: string
}

let cachedTenantToken: { token: string; expiresAt: number } | null = null

function requireFeishuConfig() {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  const redirectUri = process.env.FEISHU_REDIRECT_URI
  if (!appId || !appSecret || !redirectUri) {
    throw new Error("飞书应用未配置")
  }
  return { appId, appSecret, redirectUri }
}

function requireFeishuApp() {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error("飞书应用未配置")
  }
  return { appId, appSecret }
}

/** 浏览器 OAuth 授权登录：跳转飞书授权页（非扫码，已登录飞书账号时通常一键授权） */
export function getFeishuAuthorizeUrl(state: string) {
  const { appId, redirectUri } = requireFeishuConfig()
  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "contact:user.base:readonly contact:user.department:readonly",
  })
  return `${FEISHU_AUTH_BASE}/authen/v1/authorize?${params}`
}

export async function getTenantAccessToken(): Promise<string> {
  const { appId, appSecret } = requireFeishuApp()

  if (cachedTenantToken && cachedTenantToken.expiresAt > Date.now()) {
    return cachedTenantToken.token
  }

  const res = await fetch(`${FEISHU_BASE}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const json = (await res.json()) as {
    code: number
    msg: string
    app_access_token?: string
    expire?: number
  }
  if (json.code !== 0 || !json.app_access_token) {
    throw new Error(json.msg || "获取飞书 app_access_token 失败")
  }

  const ttlSec = json.expire && json.expire > 60 ? json.expire - 60 : 7200 - 60
  cachedTenantToken = {
    token: json.app_access_token,
    expiresAt: Date.now() + ttlSec * 1000,
  }
  return json.app_access_token
}

async function fetchUserInfo(userAccessToken: string): Promise<FeishuUserInfo> {
  const res = await fetch(`${FEISHU_BASE}/authen/v1/user_info`, {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
    },
  })
  const json = (await res.json()) as {
    code: number
    msg: string
    data?: FeishuUserInfo
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "获取飞书用户信息失败")
  }
  return json.data
}

/** 浏览器 OAuth：授权回调 code 换用户信息（v2 token + user_info） */
export async function exchangeBrowserOAuthCode(code: string): Promise<FeishuUserInfo> {
  const { appId, appSecret, redirectUri } = requireFeishuConfig()

  const res = await fetch(`${FEISHU_BASE}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const json = (await res.json()) as {
    code: number
    msg: string
    access_token?: string
  }
  if (json.code !== 0 || !json.access_token) {
    throw new Error(json.msg || "飞书登录失败")
  }
  return fetchUserInfo(json.access_token)
}

/** 飞书客户端内 H5 免登：requestAccess 返回的 code */
export async function exchangeFeishuH5Code(code: string): Promise<FeishuUserInfo> {
  const appAccessToken = await getTenantAccessToken()

  const res = await fetch(`${FEISHU_BASE}/authen/v1/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
    }),
  })
  const json = (await res.json()) as {
    code: number
    msg: string
    data?: TokenData
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "飞书登录失败")
  }
  return {
    open_id: json.data.open_id,
    name: json.data.name,
    avatar_url: json.data.avatar_url,
    tenant_key: json.data.tenant_key,
  }
}

export function getFeishuAppId() {
  return requireFeishuApp().appId
}

export function assertTenantAllowed(tenantKey: string) {
  const expected = process.env.FEISHU_TENANT_KEY
  if (!expected) return
  if (tenantKey !== expected) {
    throw new Error("仅本公司飞书账号可登录")
  }
}

export function isFeishuConfigured() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_REDIRECT_URI)
}
