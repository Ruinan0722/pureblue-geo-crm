ARG NODE_IMAGE=docker.1ms.run/library/node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
# 切阿里云 HTTP Debian（slim 无 CA，HTTPS apt 会证书失败）+ npmmirror
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g; s|https://mirrors.aliyun.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g; s|https://mirrors.aliyun.com|http://mirrors.aliyun.com|g' /etc/apt/sources.list; \
  fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json* ./
RUN npm config set registry ${NPM_REGISTRY} \
  && if [ -f package-lock.json ]; then npm ci; else npm i; fi

FROM base AS builder
ARG GEO_API_URL=https://geocrm.pressgo.cn
ARG NEXT_PUBLIC_INTAKE_SUBMIT_URL=/api/intake/submit
ARG NEXT_PUBLIC_APP_URL=https://geocrm.aiuhua.com
ARG NEXT_PUBLIC_ADMIN_PORTAL_URL=https://crm.example.invalid/login
ENV GEO_API_URL=$GEO_API_URL
ENV NEXT_PUBLIC_INTAKE_SUBMIT_URL=$NEXT_PUBLIC_INTAKE_SUBMIT_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_ADMIN_PORTAL_URL=$NEXT_PUBLIC_ADMIN_PORTAL_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 运行阶段只需要 Node.js 和 standalone 产物。不要继承安装了
# python3/make/g++ 的构建层，避免把整套编译工具带入生产镜像。
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Shanghai
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# intake 的 SQLite 仅用于提交前本地备份，业务权威数据仍在 geo-api + MySQL。
# 生产必须挂载宿主机目录到 /app/data，否则替换容器会丢失备份。
ENV INTAKE_BACKUP_DATABASE_PATH=/app/data/intake-submissions.sqlite3
# 提交仍走同源 /api/intake/submit，由 next.config rewrite 服务端代理到 GEO_API_URL
#（浏览器直连跨域会被网关 CORS 预检 405；服务端转发无此问题）
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
