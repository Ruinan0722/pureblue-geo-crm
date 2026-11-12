# geo-api

海外 GEO 需求系统的 **Python 后端 API**（FastAPI + SQLAlchemy async + MySQL）。

架构规范见 [ARCHITECTURE.md](./ARCHITECTURE.md)，**数据库表结构**见 [docs/database-schema.md](./docs/database-schema.md)，接口约定见 [docs/API.md](./docs/API.md）。

## 目录结构

```
geo-api/
├── app/
│   ├── main.py              # 应用入口
│   ├── config.py            # 环境变量
│   ├── core/                # 基础设施（数据库、鉴权、飞书客户端）
│   ├── models/              # ORM 表定义（唯一来源）
│   └── modules/             # 业务域（auth / users / invites / requests / crm / projects / …）
├── alembic/                 # 数据库迁移
├── scripts/                 # 运维脚本
├── Dockerfile
└── docker-compose.yml       # MySQL + Redis（+ 可选 api 容器）
```

每个业务域固定四层：`router → service → repository → schemas`，禁止在 `app/` 根目录散落业务代码。

## 快速开始

推荐仓库根目录：`./scripts/start-local-dev.sh`（Docker **MySQL + Redis**，本机 uvicorn / Next）。

### 1. 安装依赖

```bash
cd geo-api
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
# 编辑 .secrets/local/geo-api.env 后：./scripts/secrets-install-local.sh
```

Python 依赖只在 `pyproject.toml` 中人工维护，版本必须精确锁定。`requirements.txt` 是直接依赖清单，
`requirements.lock` 是含传递依赖与哈希的部署锁文件，二者均不手工编辑：

```bash
.venv/bin/python scripts/sync_python_dependencies.py       # 修改 pyproject.toml 后重生成
.venv/bin/python scripts/sync_python_dependencies.py --check # CI/本地防漂移校验
```

### 2. 基础设施（Docker）+ 本机 API

```bash
docker compose up -d mysql redis
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# 可选：docker compose up -d api（容器内跑 API；日常本地开发默认不用）
```

健康检查：`GET http://localhost:8000/api/health`  
API 文档：`http://localhost:8000/api/docs`（非 production）

本地完整库 / 测试库切换：`./scripts/use-local-db.sh geo_crm|geo_crm_dev`。

## API 前缀

| 前缀 | 说明 |
|------|------|
| `/api/v1/*` | 版本化接口 |
| `/api/*` | 与 Next 管理端/填报端路径兼容（**双前缀长期并存**） |

主要接口：

- `GET /api/auth/me` — 当前登录用户
- `GET /api/auth/feishu` — Web 飞书登录（回调写 JWT Cookie）
- `POST /api/auth/feishu/token` — App 用 code 换 JWT
- `GET /api/requests` — 需求单列表
- `GET /api/invites` — 邀请链接列表（完整 URL；含 `geoVariant`）
- `GET /api/users/sales-colleagues` — 销售部成员（飞书通讯录）
- `GET /api/invites/resolve/{token}` — 客户邀请链接校验
- `GET /api/crm/bootstrap` — CRM 首屏汇总（线索/客户/商机/合同/工作台）
- `GET/POST/PATCH /api/leads`、`/api/customers`、`/api/opportunities`、`/api/contracts` — CRM 业务 CRUD
- `GET/POST/PATCH/DELETE /api/rbac/*` — RBAC 管理（角色/权限/用户/通讯录）
- `POST /api/integrations/leads` — 官网/36氪/Mark 线索入站（签名鉴权）
- `GET /api/release-notes/{version}` — 版本更新说明
- `GET /api/version` — 部署版本（Git tag / APP_VERSION）

> 完整接口约定见 [docs/API.md](./docs/API.md)；端点数量以运行时 OpenAPI 为准。

## 与前端关系

| 现状 | 说明 |
|------|------|
| 主路径 | 管理端 / 填报端 `/api/*` rewrite 或代理到 geo-api |
| RBAC / 用户管理 | 全部走 geo-api（`/api/rbac/*`、`/api/auth/me`）；geo-admin 不再直连 MySQL / Redis |
| 缓存失效 | geo-admin 调 `POST /api/internal/cache/invalidate`，由 geo-api 进程内完成 |
| 例外 | 本地开发测身份登录（`isDevIdentityEnabled`）仍走 geo-admin 本地 mysql-query；staging/生产关闭 |
| 前缀 | `/api` 与 `/api/v1` 双挂，与前端路径兼容并存 |


## 环境变量

见 [.env.example](./.env.example)。关键项：

- `DATABASE_URL` — `mysql+asyncmy://...`
- `JWT_SECRET_KEY` — JWT 签名密钥（生产必须修改）
- `JWT_ALGORITHM` — 默认 `HS256`
- `FEISHU_SALES_DEPARTMENT_IDS` — 销售部 open_department_id
- `ADMIN_FEISHU_OPEN_IDS` — 超级管理员白名单
- `FEISHU_ORG_SYNC_ENABLED` — 是否开启通讯录定时同步（默认 `true`）
- `FEISHU_ORG_SYNC_INTERVAL_HOURS` — 同步间隔小时数（默认 `3`）
- `CUSTOMER_PORTAL_URL` — 客户填报端 URL（生成邀请链接）
- `REDIS_INTERNAL_TOKEN` — geo-admin 调 internal 接口的共享 token
- `MARK_SHARED_SECRET_*` / `MARK_REVIEW_CALLBACK_URL` — Mark 集成签名与审核回传（见 Mark 对接文档）

## 飞书通讯录定时同步

`geo-api` 进程启动后会在后台按间隔自动执行组织同步（写入 `users` 与 `feishu_sales_contacts`）。多 worker 部署时通过数据库任务锁保证同一时刻只跑一轮。

手动触发（运维 / 调试）：

```bash
python scripts/sync_feishu_sales_contacts.py
```

## 状态机与常量生成（status catalog）

需求/商机/合同/项目/客户/线索/跟进状态与线索来源清单的**唯一权威源**：

```text
geo-api/app/modules/contracts/status_catalog.py
```

前端产物（禁止手改，须提交）：

- `geo-admin/modules/crm/lib/status-catalog.generated.ts`
- `geo-intake/modules/requests/lib/status-catalog.generated.ts`

改动任何状态码、中文文案、tone 或来源清单后，必须重跑生成器并提交产物：

```bash
python3 geo-api/scripts/gen_frontend_status_catalog.py
cd geo-api && .venv/bin/python -m pytest \
  tests/test_status_catalog_generated_up_to_date.py \
  tests/test_request_status_contract_parity.py -q
```

`test_status_catalog_generated_up_to_date.py` 强制“再生成后 diff = 0”，防止手改或绕过生成器；`test_request_status_contract_parity.py` 钉死后端 Literal 与目录一致。

## 质量门禁（本地）

```bash
# 静态检查（全部通过；DTZ/FA100/UP045/B008 等规则的取舍原因见 pyproject.toml）
.venv/bin/ruff check app tests
# 格式检查（存量 100+ 文件未统一格式，暂不强制全仓 --fix）
.venv/bin/ruff format --check app tests
```

错误码 catalog（后端 `app/core/error_codes.py` ↔ 前端镜像）由
`tests/test_error_code_catalog.py` 钉死，新增错误码须同步两处。
