/** @type {import('next').NextConfig} */
const geoApiUrl = process.env.GEO_API_URL?.replace(/\/$/, "")

/** 局域网 IP 访问 dev 时，HMR WebSocket 须加入白名单，否则握手返回 403 */
function getAllowedDevOrigins() {
  const origins = new Set(["127.0.0.1", "localhost"])
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

/** 仅代理 geo-api 负责的业务 API；飞书 OAuth 走本地转发（附带 X-Forwarded-Host） */
const proxyRewrites = geoApiUrl
  ? [
      { source: "/api/channel-intake/:path*", destination: `${geoApiUrl}/api/channel-intake/:path*` },
      { source: "/api/auth/logout", destination: `${geoApiUrl}/api/auth/logout` },
      { source: "/api/auth/feishu", destination: `${geoApiUrl}/api/auth/feishu` },
      { source: "/api/auth/feishu/:path*", destination: `${geoApiUrl}/api/auth/feishu/:path*` },
      { source: "/api/requests", destination: `${geoApiUrl}/api/requests` },
      { source: "/api/requests/:path*", destination: `${geoApiUrl}/api/requests/:path*` },
      { source: "/api/rbac", destination: `${geoApiUrl}/api/rbac` },
      { source: "/api/rbac/:path*", destination: `${geoApiUrl}/api/rbac/:path*` },
      { source: "/api/users", destination: `${geoApiUrl}/api/rbac/users` },
      { source: "/api/users/grant", destination: `${geoApiUrl}/api/rbac/grant` },
      { source: "/api/users/directory/search", destination: `${geoApiUrl}/api/rbac/directory/search` },
      { source: "/api/users/directory/departments", destination: `${geoApiUrl}/api/rbac/directory/departments` },
      { source: "/api/users/directory/department-children", destination: `${geoApiUrl}/api/rbac/directory/department-children` },
      { source: "/api/users/directory/members", destination: `${geoApiUrl}/api/rbac/directory/members` },
      { source: "/api/users/directory/meta", destination: `${geoApiUrl}/api/rbac/directory/meta` },
      { source: "/api/users/directory/profile", destination: `${geoApiUrl}/api/rbac/directory/upsert-profile` },
      { source: "/api/users/:id/directory", destination: `${geoApiUrl}/api/rbac/users/:id/directory` },
      { source: "/api/internal/cache/invalidate", destination: `${geoApiUrl}/api/internal/cache/invalidate` },
      { source: "/api/checkin", destination: `${geoApiUrl}/api/checkin` },
      { source: "/api/checkin/:path*", destination: `${geoApiUrl}/api/checkin/:path*` },
      { source: "/api/crm/bootstrap", destination: `${geoApiUrl}/api/crm/bootstrap` },
      { source: "/api/crm/workbench", destination: `${geoApiUrl}/api/crm/workbench` },
      { source: "/api/crm/attachments", destination: `${geoApiUrl}/api/crm/attachments` },
      { source: "/api/crm/attachments/:path*", destination: `${geoApiUrl}/api/crm/attachments/:path*` },
      { source: "/api/crm/mark-materials/:path*", destination: `${geoApiUrl}/api/crm/mark-materials/:path*` },
      { source: "/api/crm/audit", destination: `${geoApiUrl}/api/crm/audit` },
      { source: "/api/crm/audit/:path*", destination: `${geoApiUrl}/api/crm/audit/:path*` },
      { source: "/api/crm/follow-up-comments", destination: `${geoApiUrl}/api/crm/follow-up-comments` },
      { source: "/api/crm/notifications", destination: `${geoApiUrl}/api/crm/notifications` },
      { source: "/api/crm/notifications/:path*", destination: `${geoApiUrl}/api/crm/notifications/:path*` },
      { source: "/api/leads", destination: `${geoApiUrl}/api/leads` },
      { source: "/api/leads/:path*", destination: `${geoApiUrl}/api/leads/:path*` },
      { source: "/api/lead-source-options", destination: `${geoApiUrl}/api/lead-source-options` },
      { source: "/api/lead-source-options/:path*", destination: `${geoApiUrl}/api/lead-source-options/:path*` },
      { source: "/api/customers", destination: `${geoApiUrl}/api/customers` },
      { source: "/api/customers/:path*", destination: `${geoApiUrl}/api/customers/:path*` },
      { source: "/api/channels", destination: `${geoApiUrl}/api/channels` },
      { source: "/api/channels/:path*", destination: `${geoApiUrl}/api/channels/:path*` },
      { source: "/api/public-pool", destination: `${geoApiUrl}/api/public-pool` },
      { source: "/api/public-pool/:path*", destination: `${geoApiUrl}/api/public-pool/:path*` },
      { source: "/api/coverages", destination: `${geoApiUrl}/api/coverages` },
      { source: "/api/coverages/:path*", destination: `${geoApiUrl}/api/coverages/:path*` },
      { source: "/api/opportunities", destination: `${geoApiUrl}/api/opportunities` },
      { source: "/api/opportunities/:path*", destination: `${geoApiUrl}/api/opportunities/:path*` },
      { source: "/api/contracts", destination: `${geoApiUrl}/api/contracts` },
      { source: "/api/contracts/:path*", destination: `${geoApiUrl}/api/contracts/:path*` },
      { source: "/api/payment-plans", destination: `${geoApiUrl}/api/payment-plans` },
      { source: "/api/payment-plans/:path*", destination: `${geoApiUrl}/api/payment-plans/:path*` },
      { source: "/api/projects", destination: `${geoApiUrl}/api/projects` },
      { source: "/api/projects/:path*", destination: `${geoApiUrl}/api/projects/:path*` },
      { source: "/api/release-notes", destination: `${geoApiUrl}/api/release-notes` },
      { source: "/api/release-notes/:path*", destination: `${geoApiUrl}/api/release-notes/:path*` },
      { source: "/api/invites", destination: `${geoApiUrl}/api/invites` },
      { source: "/api/invites/:path*", destination: `${geoApiUrl}/api/invites/:path*` },
      { source: "/api/users/sales-colleagues", destination: `${geoApiUrl}/api/users/sales-colleagues` },
      { source: "/api/users/directory", destination: `${geoApiUrl}/api/users/directory` },
      { source: "/api/users/direct-manager", destination: `${geoApiUrl}/api/users/direct-manager` },
    ]
  : []

const nextConfig = {
  // 日常访问使用预编译目录，与开发模式隔离，避免访问时现场编译。
  distDir: process.env.CRM_NEXT_DIST_DIR || ".next",
  allowedDevOrigins: getAllowedDevOrigins(),
  output: "standalone",
  images: {
    unoptimized: true,
  },
  // 打卡多图上传经 rewrite/middleware 缓冲时默认 10MB 会静默截断
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  async rewrites() {
    return {
      beforeFiles: proxyRewrites,
    }
  },
  async headers() {
    // 生产 chunk 文件名带内容哈希，可长期 immutable。
    // next dev 下路径常稳定（如 app/requests/page.js）；若仍发 immutable，
    // 切分支/改码后浏览器会一直用旧包（表现为邀请「国内/海外」Tab 丢失等）。
    // 开发态不覆盖 /_next/static，交给 Next 默认缓存策略。
    const headers = [
      {
        source: "/version.json",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ]
    if (process.env.NODE_ENV !== "development") {
      headers.splice(1, 0, {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      })
    }
    return headers
  },
}

export default nextConfig
