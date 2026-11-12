# geo-admin — 内部管理端

独立 Next.js 项目，供内部人员使用：飞书登录、CRM（线索/客户/商机/合同）、需求管理、邀请链接、代填表单、位置打卡；交付项目管理已在 Staging 上线（v1.1.0-staging.21+），随下次生产 tag 上线。

与客户填报端 **完全独立**：各自有 `package.json`、`node_modules`、源码目录，可单独部署、单独迭代。

## 模块化

目录约定、分层职责与新增功能检查清单见 **[ARCHITECTURE.md](./ARCHITECTURE.md)**（与 [geo-api/ARCHITECTURE.md](../geo-api/ARCHITECTURE.md) 对齐）。

## 端口

- 开发：`47821`
- 生产：国内 ECS，域名 `crm.example.invalid`

## 启动

```bash
cd geo-admin
# 配置见 .secrets/local/geo-admin.env（或运行 ./scripts/secrets-install-local.sh）
npm install
npm run dev
```

或从仓库根目录：`./scripts/start-local-dev.sh`

## 环境变量

| 变量 | 说明 |
|------|------|
| `GEO_API_URL` | geo-api 地址，本地 `http://localhost:8000` |
| `JWT_SECRET_KEY` | 须与 `.secrets/local/geo-api.env` 一致 |
| `NEXT_PUBLIC_APP_URL` | 本服务地址 |
| `NEXT_PUBLIC_CUSTOMER_PORTAL_URL` | 客户填报端地址（生成邀请链接用） |
| `REDIS_INTERNAL_TOKEN` | 调 geo-api `/api/internal/cache/invalidate` 的共享 token |
| `FEISHU_*` | 飞书 OAuth |

## 与客户端关系

- 业务数据经 **geo-api** 读写 MySQL
- 邀请链接指向 **geo-intake**（`NEXT_PUBLIC_CUSTOMER_PORTAL_URL`）
- 修改本项目 **不会** 影响 geo-intake 的代码与部署
