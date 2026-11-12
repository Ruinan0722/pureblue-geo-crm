# geo-api 架构规范

> 最后更新：2026-08-12（single-backend 收敛后：geo-admin / geo-intake 不再直连 MySQL / Redis）

## 设计原则

1. **按业务域分包**：每个域在 `app/modules/<domain>/` 下自包含，禁止把业务 SQL 写到 `router.py`。
2. **分层固定**：`router → service → repository`，单向依赖，不允许 repository 调用 service。
3. **表结构一处定义**：共享 ORM 主模型在 `app/models/`；模块私有表可放 `app/modules/<domain>/models.py`，Alembic 迁移统一管理。
4. **基础设施仅放 `app/core/`**：数据库、鉴权依赖、异常、工具函数。
5. **禁止**在 `app/` 根目录散落 `utils.py`、`helpers.py`；新工具归入对应模块或 `core/`。
6. **数据所有权唯一**：MySQL / Redis 仅由 geo-api 持有；前端与脚本一律走 HTTP（见 `docs/engineering/geo-api-single-backend.md`）。

## 目录结构

```
geo-api/
├── app/
│   ├── main.py              # 应用入口：挂载路由（/api/v1 + /api 双前缀）、中间件、生命周期
│   ├── config.py            # 环境变量（pydantic-settings）
│   ├── core/                # 基础设施（database / deps / exceptions / jwt / geo_features / redis 等）
│   ├── models/              # SQLAlchemy ORM 主模型（users/requests/crm/projects/rbac/checkin/feishu…）
│   └── modules/             # 业务域
│       ├── auth/            # 飞书登录 / JWT / /api/auth/me
│       ├── users/           # 通讯录目录、销售同事、直属上级
│       ├── invites/         # 邀请链接
│       ├── intake/          # 客户只写提交（/api/intake/submit）
│       ├── requests/        # 需求单
│       ├── crm/             # 线索/客户/对接池/联系人/跟进/商机/合同/通知/审计/来源选项
│       │   ├── service/     # CrmService 聚合 + 域 mixin（base / leads / customers / opportunities / contracts / notifications / workbench）+ helpers_*
│       │   ├── repository/  # 按实体仓储
│       │   └── router.py
│       ├── contracts/       # 合同域 + 状态机/常量唯一权威源 status_catalog.py（生成前端产物，见 README）
│       ├── projects/        # 交付项目
│       ├── checkin/         # 外勤打卡
│       ├── rbac/            # 角色/权限/授权/通讯录管理（/api/rbac/*）
│       ├── release_notes/   # 版本更新说明
│       ├── mark_integration/# 官网/36氪/Mark 入站、S3 材料、审核回传
│       ├── internal/        # 内部接口（缓存失效 / 成员资料同步，X-Internal-Token）
│       └── …
├── alembic/                 # 数据库版本迁移（head 见 033_crm_contacts_follow_ups）
├── scripts/                 # 运维脚本（迁移、导入、seed）
├── tests/                   # 按模块镜像组织；数量以 pytest collection 为准
├── Dockerfile
└── docker-compose.yml
```

## 模块职责

| 层 | 职责 | 禁止 |
|----|------|------|
| `router.py` | 路由、Depends、HTTP 异常转换 | 直接写 SQL、复杂业务 |
| `service.py` | 业务编排、权限、事务边界 | 依赖 FastAPI Request（除 auth ctx） |
| `repository.py` | CRUD、查询 | 权限判断、HTTP 概念 |
| `schemas.py` | API 契约（camelCase 别名兼容前端） | ORM 模型 |

## 跨模块调用

- **允许**：`requests.service` 调用 `invites.repository`（通过 service 更好）
- **推荐**：共享逻辑抽到被调模块的 `service.py`，由调用方 import service
- **禁止**：`requests.router` 直接 import `invites.repository`

## 数据库

表结构、字段说明、索引与同步策略见 [docs/database-schema.md](../docs/database-schema.md)。当前 Alembic head：`056_request_target_customer`。

## API 前缀

所有业务接口同时挂载 `/api/v1/...` 与 `/api/...`（Next 前端路径兼容，**双前缀长期并存**）。

**完整接口约定、飞书登录与鉴权流程**见 [docs/API.md](./docs/API.md)；端点数量以运行时 OpenAPI 为准。

## 与前端关系（single-backend 后）

| 现状 | 说明 |
|------|------|
| geo-admin / geo-intake | 业务 `/api/*` rewrite 或代理到 geo-api；**不再直连 MySQL / Redis** |
| RBAC / 用户管理 | 全部走 geo-api `/api/rbac/*`、`/api/auth/me`（`rbac-repo.ts` 为 HTTP 客户端） |
| 缓存失效 | geo-admin 调 `POST /api/internal/cache/invalidate`，由 geo-api 进程内完成 |
| 例外（本地开发） | 测身份登录（`isDevIdentityEnabled` 时）仍走 geo-admin 本地 mysql-query；staging/生产关闭 |
| Redis | 代码已接入；**北京现网未部署容器**时自动降级（见 `docs/modules/redis-cache.md`） |
| 项目管理 | `modules/projects` 已落地（staging 21+ 已发版）；设计与缺口见 `docs/modules/projects.md` |

阶段总览：[`docs/README.md`](../docs/README.md)。部署：[`docs/ops/deploy.md`](../docs/ops/deploy.md)。
