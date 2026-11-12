ARG NODE_IMAGE=docker.1ms.run/library/node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
# 北京 ECS 访问 deb.debian.org 极慢；切阿里云 HTTP（slim 镜像无 CA，不能用 HTTPS apt）
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
# 北京 ECS 无法访问 registry.npmmirror.com（IPv4/IPv6 均超时）；npmjs.org 可达但极慢
# （实测 16MB 包 30s+）。默认用腾讯云 npm 镜像（实测 <0.3s），可用
# --build-arg NPM_REGISTRY=... 覆盖；华为云 mirrors.huaweicloud.com/repository/npm 亦可。
ARG NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/
COPY package.json package-lock.json* ./
RUN npm config set registry ${NPM_REGISTRY} \
  && if [ -f package-lock.json ]; then npm ci; else npm i; fi

FROM base AS builder
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CUSTOMER_PORTAL_URL
ARG NEXT_PUBLIC_AMAP_KEY
ARG NEXT_PUBLIC_AMAP_SECURITY_CODE
ARG NEXT_PUBLIC_APP_VERSION=dev
ARG NEXT_PUBLIC_GEO_ENV=production
ARG GEO_API_URL=http://geo-api:8000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CUSTOMER_PORTAL_URL=$NEXT_PUBLIC_CUSTOMER_PORTAL_URL \
    NEXT_PUBLIC_AMAP_KEY=$NEXT_PUBLIC_AMAP_KEY \
    NEXT_PUBLIC_AMAP_SECURITY_CODE=$NEXT_PUBLIC_AMAP_SECURITY_CODE \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_PUBLIC_GEO_ENV=$NEXT_PUBLIC_GEO_ENV \
    GEO_API_URL=$GEO_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Shanghai
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# 业务库仅为 MySQL（DATABASE_URL）；勿再使用 SQLite DATABASE_PATH
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
