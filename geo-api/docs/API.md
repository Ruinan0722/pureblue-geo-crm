# GEO CRM API 接口约定

> 版本：v1.1（更新 2026-08-07）  
> 服务：geo-api（FastAPI）  
> 基础路径：`/api/v1`（正式） / `/api`（兼容现有 Next.js 前端，**双前缀长期并存**）  
> 阶段：见 [`docs/README.md`](../../docs/README.md)；Mark 对接签名见 [`docs/modules/mark-crm-integration-api.md`](../../docs/modules/mark-crm-integration-api.md)；权限模型见 [`docs/modules/auth-rbac-data-scope.md`](../../docs/modules/auth-rbac-data-scope.md)

---

## 1. 通用约定

### 1.1 请求格式

| 项 | 约定 |
|----|------|
| Content-Type | `application/json`（POST/PATCH 请求体） |
| 字符编码 | UTF-8 |
| 时间字段 | 响应为字符串 `YYYY-MM-DD HH:MM:SS`（迁移期兼容前端） |

### 1.2 响应格式

- **JSON 字段名统一 camelCase**（如 `feishuOpenId`、`staffUserId`）
- 成功：HTTP 2xx + 业务数据
- 失败：HTTP 4xx/5xx + `{ "error": "错误说明" }`（结构化候选放 `detail`）

### 1.3 HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 202 | 已受理（异步/入站集成接口） |
| 204 | 删除成功（无响应体） |
| 400 | 参数错误 / 业务校验失败 |
| 401 | 未登录或会话过期 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 幂等键冲突 / 材料版本冲突 |
| 422 | 业务校验失败（部分集成接口） |
| 502 | 上游服务失败（如飞书通讯录） |

### 1.4 版本与路径

```
正式：  GET /api/v1/requests
兼容：  GET /api/requests          ← 与前端路径并存
文档：  GET /api/docs
健康：  GET /api/health
版本：  GET /api/version           ← 部署版本（Git tag / APP_VERSION）
```

`GET /api/version` 返回 `{ "version": "<tag 或 dev>" }`；geo-admin 另有静态 `public/version.json` 供软刷新探测。

---

## 2. 鉴权模型（JWT）

内部员工统一使用 **JWT Access Token**（算法 `HS256`），Web / App / 脚本 **同一套签发与校验逻辑**。

### 2.1 三种身份

| 身份 | 适用场景 | 凭证 |
|------|----------|------|
| **内部员工** | admin / App / 脚本 | JWT（Cookie 或 Bearer） |
| **外部平台** | 官网 / 36氪 / Mark 入站 | `X-Platform-Code` + `X-Timestamp` + `X-Nonce` + `X-Signature`（见 Mark 对接文档） |
| **客户提交** | geo-intake 最终提交 | JSON body 中的 `inviteToken`（专用只写接口） |

### 2.2 JWT 结构

```json
{
  "sub": "user_uuid",
  "role": "sales",
  "typ": "access",
  "iat": 1710000000,
  "exp": 1710604800
}
```

| 字段 | 说明 |
|------|------|
| `sub` | 用户 ID（users.id） |
| `role` | 登录时角色快照（运行时权限以 RBAC 表重算） |
| `typ` | 固定 `access` |
| `exp` | 过期时间（默认 7 天） |

签发：`app/core/jwt.py` · 算法：`JWT_ALGORITHM`（默认 HS256）· 密钥：`JWT_SECRET_KEY`

### 2.3 飞书登录（Web 浏览器）

```mermaid
sequenceDiagram
    participant Browser as 浏览器
    participant API as geo-api
    participant Feishu as 飞书 OAuth
    participant DB as MySQL

    Browser->>API: GET /api/auth/feishu
    API->>Browser: 302 飞书授权页
    Feishu->>API: GET /api/auth/feishu/callback?code=xxx
    API->>Feishu: code 换用户信息
    API->>DB: upsert users + 角色绑定
    API->>Browser: 签发 JWT<br/>Set-Cookie: geo_access_token=eyJ...
    Browser->>API: GET /api/auth/me（自动带 Cookie）
    API->>Browser: 200 user + permissions + roles
```

### 2.4 飞书登录（App / 多端）

原生端用飞书 SDK 拿到 `code` 后直接调：

```http
POST /api/auth/feishu/token
Content-Type: application/json

{ "code": "飞书授权码" }
```

响应：

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 604800,
  "user": { "id": "...", "name": "张三", "role": "sales", ... }
}
```

### 2.5 后续 API 请求如何鉴权

**方式 A：Authorization Bearer（App / 脚本 / 推荐）**

```http
GET /api/requests HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**方式 B：HttpOnly Cookie（Web 浏览器）**

```http
GET /api/requests HTTP/1.1
Cookie: geo_access_token=eyJhbGciOiJIUzI1NiIs...
```

解析顺序：`Cookie: geo_access_token` → `Authorization: Bearer` → 验签 JWT → 用 `sub` 查 users 表加载最新角色/权限。

### 2.6 客户邀请鉴权（非 JWT）

客户填报端用 `geo_invite_token` Cookie，与员工 JWT 无关；最终写库走 `/api/intake/submit`（body 内 `inviteToken`）。

### 2.7 登出

```http
POST /api/auth/logout
```

- Web：服务端清除 `geo_access_token` Cookie
- App：客户端删除本地 token（JWT 无状态，服务端不维护黑名单）

### 2.8 权限模型

登录后 `GET /api/auth/me` 返回 `user` + `permissions` + `roles`；权限以 MySQL RBAC 表为运行时权威，前端不自算权限。细粒度权限码与数据范围见 `docs/modules/auth-rbac-data-scope.md`。

---

## 3. 接口清单（按模块）

> 除特别注明外，路径前缀均为 `/api`（与 `/api/v1` 并存）。鉴权列「员工 JWT」表示需登录；细粒度权限在服务层校验。

### 3.1 Auth `/api/auth`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/feishu` | 无 | Web：跳转飞书 OAuth |
| GET | `/feishu/callback` | 无 | Web：回调，Set-Cookie JWT |
| POST | `/feishu/token` | 无 | App：code 换 JWT（JSON） |
| GET | `/me` | 可选 | 当前用户 + 权限（未登录返回 `user: null`） |
| POST | `/logout` | 可选 | 清除 Cookie |

### 3.2 Requests `/api/requests`

员工内网 CRUD。**公网客户最终提交请用 3.3，勿对 ALB 暴露本资源的 GET/PATCH。**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/requests` | 员工 JWT | 按 data_scope 列需求；支持 keyword/状态/来源/国家等筛选 |
| GET | `/requests/stats` | 员工 JWT | 需求统计卡片 |
| POST | `/requests` | 员工 JWT | 代客/内网创建，返回完整 `RequestRecord` |
| GET | `/requests/{id}` | 员工 JWT | 详情 |
| PATCH | `/requests/{id}` | 员工 JWT | 改数据/状态/跟进人 |
| POST | `/requests/export/excel` | 员工 JWT + `request:export` | 勾选 ids 批量导出 1 个 `.xlsx`（服务端校验数据范围） |
| POST | `/requests/export/pdf` | 员工 JWT + `request:export` | 勾选 ids 批量导出 1 个 `.pdf`（服务端校验数据范围） |

批量导出请求体：`{ "ids": ["req-1", "req-2"] }`（1～200 条）；响应为附件流
（`Content-Disposition: attachment; filename*=UTF-8''需求导出-....xlsx|.pdf`）。

### 3.3 Intake 只写提交 `/api/intake/submit`

海外/国内客户在邀请链路上**最终提交**时使用（柔佛独立 intake → 公网 → 北京 geo-api）。

**公网 / ALB 只放行本 POST**（不要暴露 `/api/health`、`/api/invites/resolve/*` 或整包 `/api/*`）。

写库前强制验真并幂等：

1. `inviteToken` 须为库内真实 token（格式校验 + 存在性）
2. 邀请未撤销，且归属销售账号在职
3. 表单字段业务校验通过后才插入
4. **同一邀请仅一笔 `submitted`**：重复提交返回原受理号且 `reused: true`（事务内行锁防并发双写）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/intake/submit` | body.`inviteToken`（必填） | 验真 + 幂等后写入；**不**返回完整需求单 |

请求体：

```json
{
  "inviteToken": "…",
  "data": { },
  "status": "submitted"
}
```

成功响应（201）：

```json
{ "code": "GEO-20260714-1234", "reused": false }
```

### 3.4 Invites `/api/invites`

固定链接（2026-08 起）：每位销售自动拥有国内/海外各一条固定邀请链接，
token 由确定性规则生成（`staff-{userId}-overseas|domestic`），链接永久稳定；
不提供生成/撤销/删除/查看全部，销售与管理员的列表都只返回本人固定链接。

| 方法 | 路径 | 鉴权 | 权限 |
|------|------|------|------|
| GET | `/invites` | 员工 | `invite:manage`；自动配发并返回本人固定链接（完整可复制 URL） |
| GET | `/invites/resolve/{token}` | 无 | 客户入口校验 |

已移除：`POST /invites`（手动生成）、`GET /invites/{id}`、`POST /invites/{id}/reveal`、
`PATCH /invites/{id}`（撤销）、`DELETE /invites/{id}`（删除）。
权限码 `invite:create`、`invite:view_all` 已从目录移除。

### 3.5 Users `/api/users`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/users/directory` | 员工 | 通讯录目录（@提及/负责人下拉；按权限过滤） |
| GET | `/users/sales-colleagues` | 员工 | 销售部成员（飞书通讯录快照） |
| GET | `/users/direct-manager` | 员工 | 按签订人姓名查飞书直属上级（合同编辑自动带入） |

### 3.6 Checkin `/api/checkin`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/checkin` | 员工 | 创建打卡记录（`arrive`/`leave`，GPS + 附件） |
| GET | `/checkin` | 员工 | 打卡记录列表 |
| GET | `/checkin/active-visit` | 员工 | 当前进行中的拜访会话 |
| GET | `/checkin/stats` | 员工 | 打卡统计 |
| POST | `/checkin/attachments` | 员工 | 上传现场照片（multipart） |
| GET | `/checkin/attachments/{attachment_id}` | 员工 | 下载附件（按归属校验） |
| DELETE | `/checkin/attachments/{attachment_id}` | 员工 | 删除附件 |

### 3.7 CRM `/api/crm` 与子资源

#### 3.7.1 汇总与附件

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/crm/bootstrap` | 员工 | 首屏一次性加载（用户权限 + 各实体列表/统计） |
| GET | `/crm/workbench` | 员工 | 工作台统计（今日待跟进/超 14 天/商机等） |
| POST | `/crm/attachments` | 员工 | 上传 CRM 附件（multipart，按实体权限校验） |
| GET | `/crm/attachments/{attachment_id}` | 员工 | 下载附件（按父实体访问权校验） |
| DELETE | `/crm/attachments/{attachment_id}` | 员工 | 删除附件 |

#### 3.7.2 线索 `/leads`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/leads` | 员工 | 线索列表（来源/状态/负责人等筛选） |
| GET | `/leads/stats` | 员工 | 线索统计卡 |
| GET | `/leads/{lead_id}` | 员工 | 详情 |
| POST | `/leads` | 员工 | 创建线索（含一级/二级来源、会议下拉） |
| PATCH | `/leads/{lead_id}` | 员工 | 更新（细粒度写权限） |
| GET | `/leads/{lead_id}/convert-candidates` | 员工 | 转客户前查重候选 |
| POST | `/leads/{lead_id}/convert` | 员工 | 线索转客户（同名挂靠/部分重名提示；建本人对接池） |

#### 3.7.3 客户 / 对接池 / 联系人

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/customers` | 员工 | 公司主档列表（联系人状态聚合列） |
| GET | `/customers/stats` | 员工 | 客户统计 |
| GET | `/customers/duplicate-check` | 员工 | 建客户前查重（公司名/信用代码） |
| POST | `/customers/batch-assign-owner` | 员工 | 批量改派负责人（可指派集合校验 + 审计） |
| GET | `/customers/{customer_id}` | 员工 | 公司主档详情 |
| POST | `/customers` | 员工 | 自拓建档（来源固定「自拓」，回填线索 + 建池） |
| PATCH | `/customers/{customer_id}` | 员工 | 更新主档（细粒度写权限） |
| GET | `/customers/{customer_id}/coverages` | 员工 | 该公司对接池列表 |
| POST | `/customers/{customer_id}/coverages` | 员工 | 建立本人对接池 |
| GET | `/coverages/{coverage_id}` | 员工 | 对接池详情（联系人/跟进/状态） |
| PATCH | `/coverages/{coverage_id}` | 员工 | 更新对接池（经营状态/联系人等） |
| POST | `/customers/{customer_id}/contacts` | 员工 | 客户内新增联系人（复用线索表单，回填线索 + 同步联系人表） |

#### 3.7.4 商机 / 合同

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/opportunities` | 员工 | 商机列表（金额/概率/阶段停滞天数筛选） |
| GET | `/opportunities/{opportunity_id}` | 员工 | 详情 |
| POST | `/opportunities` | 员工 | 创建商机（需求绑定） |
| PATCH | `/opportunities/{opportunity_id}` | 员工 | 更新（阶段闸门/回滚校验）；仅持 `opportunities:assign_advisor` 的用户只能更新售前顾问（须为解决方案部成员） |
| GET | `/contracts` | 员工 | 合同列表（金额区间筛选） |
| GET | `/contracts/{contract_id}` | 员工 | 详情 |
| POST | `/contracts` | 员工 | 创建合同 |
| PATCH | `/contracts/{contract_id}` | 员工 | 更新/签署（签约自动建项） |

#### 3.7.5 审计 / 通知 / 来源选项 / Mark 材料

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/crm/audit` | 员工 | 审计列表（按实体访问权过滤） |
| POST | `/crm/audit` | 员工 | 写审计（内部/改派等） |
| GET | `/crm/notifications/ws-ticket` | 员工 | WebSocket 连接票据 |
| GET | `/crm/notifications` | 员工 | 站内通知列表 |
| POST | `/crm/notifications` | 员工 | 创建通知（内部） |
| POST | `/crm/notifications/read-all` | 员工 | 全部已读 |
| POST | `/crm/notifications/{notification_id}/read` | 员工 | 单条已读 |
| GET | `/lead-source-options` | 员工 | 线索二级来源选项（会议等） |
| POST | `/lead-source-options` | 员工 | `lead_source_options:manage`；新增选项 |
| PATCH | `/lead-source-options/{option_id}` | 员工 | `lead_source_options:manage`；更新选项 |
| DELETE | `/lead-source-options/{option_id}` | 员工 | `lead_source_options:manage`；删除选项（必填原因，软删审计） |
| GET | `/crm/mark-materials/{file_id}` | 员工 | 查看 Mark 材料文件 |
| POST | `/crm/mark-materials/{file_id}/retry` | 员工 | 重新加入下载队列 |

### 3.8 Projects `/api/projects`

需登录；权限 `section:projects`（写操作另需 write 权限）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 列表；`view=active\|archive`，筛选 `keyword/stage/health/riskLevel/renewalWarning/mineOnly` |
| GET | `/projects/stats` | 统计卡片 |
| POST | `/projects/ensure-from-contract/{contract_id}` | ops 补建（幂等） |
| GET | `/projects/{project_id}` | 详情（含计算字段） |
| PATCH | `/projects/{project_id}` | 更新（字段按角色裁剪） |
| GET | `/projects/{project_id}/notes` | 过程记录；可选 `kind` |
| POST | `/projects/{project_id}/notes` | 新增记录 |
| DELETE | `/projects/{project_id}/notes/{note_id}` | 删除记录 |

签约自动建项由 CRM 合同服务在 `signed`（及辅触发）时调用，不单独暴露给普通前端。

### 3.9 RBAC 管理 `/api/rbac`

员工 JWT；管理操作需 `section:settings` + 管理层级校验（超管不可被降权等）。详见 `docs/engineering/geo-api-single-backend.md`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/rbac/permissions` | 权限目录 |
| GET | `/rbac/meta` | 部门规则 / data_scope 文案 / 超管配置 |
| GET | `/rbac/roles` | 角色列表 |
| GET | `/rbac/roles/by-code/{code}` | 按角色码查询 |
| GET | `/rbac/roles/{role_id}` | 角色详情（含权限） |
| POST | `/rbac/roles` | 新建角色 |
| PATCH | `/rbac/roles/{role_id}` | 更新角色/权限 |
| DELETE | `/rbac/roles/{role_id}` | 删除角色 |
| GET | `/rbac/users` | 管理端用户列表（含角色/覆盖/锁定） |
| GET | `/rbac/users/{user_id}` | 用户 RBAC 详情 |
| PUT | `/rbac/users/{user_id}/roles` | 设置角色（单身份收敛） |
| PUT | `/rbac/users/{user_id}/overrides` | 设置权限覆盖 |
| PATCH | `/rbac/users/{user_id}/lock` | 角色锁定/解锁 |
| PATCH | `/rbac/users/{user_id}/data-scope` | 数据范围覆盖 |
| POST | `/rbac/users/{user_id}/role-toggle` | 切换用户角色 |
| POST | `/rbac/grant` | 直接授权（通讯录检索 + 授予） |
| GET | `/rbac/directory/search` | 通讯录搜索 |
| POST | `/rbac/directory/resolve-departments` | 部门解析 |
| POST | `/rbac/directory/upsert-profile` | 成员资料维护 |
| PATCH | `/rbac/users/{user_id}/directory` | 更新用户部门/负责人 |
| POST | `/rbac/sync-identity` | 按代码种子强制对齐系统角色/部门映射（发版后执行） |

### 3.10 Release Notes `/api/release-notes`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/release-notes/{version}` | 无 | 按版本取更新说明（不强制登录，避免首屏鉴权竞态） |
| PUT | `/release-notes` | 管理员 | upsert 更新说明（发版脚本写入） |

### 3.11 Mark 集成 `/api/integrations`

签名/防重放契约见 [`docs/modules/mark-crm-integration-api.md`](../../docs/modules/mark-crm-integration-api.md)。

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/integrations/leads` | 平台签名 | 官网/36氪/Mark 统一入站创建线索（202） |
| POST | `/integrations/mark/leads/{crm_lead_id}/materials` | 平台签名（仅 mark） | Mark 通知 S3 PDF 地址，CRM 异步下载归档（202） |

### 3.12 Internal `/api/internal`

内部服务接口，需 `X-Internal-Token`；不对公网开放。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/internal/cache/invalidate` | 缓存失效（RBAC/用户/组织写后调用） |
| POST | `/internal/rbac/sync-member-profiles` | 成员资料同步（`sync-member-profiles-to-db.ts` 改调） |

---

## 4. 环境变量（鉴权与集成相关）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET_KEY` | 签名密钥（生产必须修改） |
| `JWT_ALGORITHM` | 默认 `HS256` |
| `JWT_ACCESS_TOKEN_EXPIRE_SECONDS` | 访问令牌 TTL：生产固定 86400（1 天）；开发、Staging、测试固定 604800（7 天）；与环境策略不一致时拒绝启动 |
| `JWT_COOKIE` | Web Cookie 名，默认 `geo_access_token` |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_REDIRECT_URI` | 飞书 OAuth |
| `FEISHU_TENANT_KEY` | 可选，限制本公司租户 |
| `ADMIN_FEISHU_OPEN_IDS` | 管理员 open_id 白名单 |
| `SUPER_ADMIN_FEISHU_OPEN_ID` | 唯一超级管理员 open_id（优先） |
| `ADMIN_PORTAL_URL` | 登录成功后跳转地址 |
| `REDIS_INTERNAL_TOKEN` | geo-admin → geo-api internal 接口共享 token |
| `MARK_SHARED_SECRET_*` | 官网/36氪/Mark 各自 HMAC 密钥（见 Mark 对接文档） |
| `MARK_REVIEW_CALLBACK_URL` / `MARK_REVIEW_CALLBACK_SECRET` | CRM → Mark 审核回传地址与签名密钥 |

---

## 5. Nginx 反代示例（管理端 → geo-api）

将前端 `/api/*` 代理到 geo-api，Cookie 同域传递：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Cookie $http_cookie;
}
```

通知 WebSocket（管理端）须直连 geo-api 并带 `Upgrade`：

```nginx
location /api/crm/notifications/ws {
    proxy_pass http://127.0.0.1:8000/api/crm/notifications/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

飞书后台「重定向 URL」需改为：

```
https://<admin-domain>/api/auth/feishu/callback
```

---

## 6. 多端接入示例

### Web（fetch）

```javascript
// 浏览器同域：登录后 Cookie 自动携带，credentials 设为 include
const res = await fetch("/api/requests", { credentials: "include" });
```

### App / 脚本（Bearer）

```javascript
const res = await fetch("https://api.example.com/api/requests", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### 登录拿 token（App）

```javascript
const { accessToken, expiresIn, user } = await fetch("/api/auth/feishu/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: feishuCode }),
}).then((r) => r.json());
// 本地持久化 accessToken，过期前重新登录
```

---

## 附：端点统计（2026-08-07）

| 模块 | 端点数 |
|------|--------|
| auth | 5 |
| requests | 5 |
| intake | 1 |
| invites | 7 |
| users | 3 |
| checkin | 7 |
| crm | 45 |
| projects | 8 |
| rbac | 21 |
| release-notes | 2 |
| integrations（Mark） | 2 |
| internal | 2 |
| **合计** | **108** |
