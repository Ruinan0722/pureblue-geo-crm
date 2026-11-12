# geo-intake — 客户填报端

独立 Next.js 项目，供客户通过销售专属链接填写 **海外 / 国内** GEO 需求。

与内部管理端 **完全独立**：各自有 `package.json`、`node_modules`、源码目录，可单独部署到公网域名。

## 端口

- 开发：`47822`
- 生产：海外 ECS 公网域名（国内变体可同域不同路径）

## 启动

```bash
cd geo-intake
# 配置见 .secrets/local/geo-intake.env
npm install
npm run dev
```

或从仓库根目录：`./scripts/start-local-dev.sh`

## 路由

| 路径 | 说明 |
|------|------|
| `/c/[token]` | 邀请入口，写入 cookie 后跳转填报（按邀请 `geoVariant`） |
| `/intake` | 海外 GEO 需求表单 |
| `/intake/cn` | 国内 GEO 需求表单 |
| `POST /api/requests` | 提交需求（代理到 geo-api） |

## 环境变量

| 变量 | 说明 |
|------|------|
| `GEO_API_URL` | geo-api 地址，本地 `http://localhost:8000` |
| `NEXT_PUBLIC_APP_URL` | 本服务地址 |
| `NEXT_PUBLIC_ADMIN_PORTAL_URL` | 内部登录页（need-link 页引导用） |

## 与内部端关系

- 业务数据经 **geo-api** 读写 MySQL
- **无** 飞书登录、需求列表、邀请管理 API
- 修改本项目 **不会** 影响 geo-admin 的代码与部署
