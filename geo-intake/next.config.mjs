import createNextIntlPlugin from "next-intl/plugin"

/** @type {import('next').NextConfig} */
const geoApiUrl = process.env.GEO_API_URL?.replace(/\/$/, "")

/** 局域网 IP 访问 dev 时，HMR WebSocket 须加入白名单，否则握手返回 403 */
function getAllowedDevOrigins() {
  const origins = new Set()
  for (const value of (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",")) {
    const host = value.trim()
    if (host) origins.add(host)
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).hostname)
    } catch {
      // ignore invalid URL
    }
  }
  return [...origins]
}

/** 公网/跨境仅代理只写提交；邀请校验在 submit 时由 geo-api 用 inviteToken 完成。 */
const proxyRewrites = geoApiUrl
  ? [
      { source: "/api/intake/submit", destination: `${geoApiUrl}/api/intake/submit` },
      { source: "/api/channel-intake/submit", destination: `${geoApiUrl}/api/channel-intake/submit` },
    ]
  : []

const nextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  output: "standalone",
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return {
      beforeFiles: proxyRewrites,
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ]
  },
}

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")

export default withNextIntl(nextConfig)
