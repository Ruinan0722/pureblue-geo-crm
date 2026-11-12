# geo-admin 前端模块化规范

> 与 [geo-api/ARCHITECTURE.md](../geo-api/ARCHITECTURE.md) 对齐：按业务域分包，入口层尽量薄。  
> 最后更新：2026-08-07（single-backend：RBAC/用户管理已迁 geo-api）

---

## 1. 设计原则

1. **业务域在 `modules/<domain>/`**：页面、组件、hooks、API 处理、领域工具都放在该域内，禁止在 `app/` 堆业务实现。
2. **`app/` 只做薄入口**：路由鉴权、re-export 页面 / route handlers；复杂逻辑下沉到模块。
3. **横切能力在 `shared/`**：通用 UI（shadcn）、日期/工具函数、geo-api 代理提示等。
4. **数据读写以 geo-api 为准**：业务 CRUD、RBAC/用户管理全部经 `GEO_API_URL`（HTTP）；本地 Next `app/api` 仅保留仍须在本进程执行的能力（开发态测身份登录、逆地理等）。
5. **依赖方向单向**：`app` → `modules` → `shared`；模块之间谨慎依赖（优先通过 `shared` 或明确的 public export）。

---

## 2. 顶层目录

```
geo-admin/
├── app/                 # Next.js App Router：薄页面与 API 入口
├── modules/             # 业务域（真相源）
│   ├── auth/
│   ├── audit/
│   ├── checkin/
│   ├── crm/
│   ├── invites/
│   ├── intake/
│   ├── rbac/
│   ├── requests/
│   ├── settings/
│   └── shell/
├── shared/              # 跨域 UI / lib / types
├── config/              # 配置文件（如飞书部门映射）
├── middleware.ts        # → modules/auth/admin-middleware
└── next.config.mjs      # GEO_API_URL rewrite 等
```

---

## 3. 单模块推荐结构

以 `checkin` 为范本（分层最完整）：

```
modules/<domain>/
├── index.ts             # 对外 barrel（页面/组件/类型的稳定导出）
├── pages/               # 页面壳（标题区 + 挂载主视图）
├── components/          # 展示与交互，少写业务编排
├── hooks/               # 客户端编排（状态、副作用、调用 services）
├── services/            # 浏览器侧 IO：fetch、上传、第三方 SDK 封装
├── api/                 # Next Route Handler 实现（由 app/api 再导出）
├── lib/                 # 纯逻辑与领域类型（无 React）
├── utils/               # 更底层工具（可选；与 lib 勿重复堆叠）
└── types/               # 仅模块私有声明文件（如 *.d.ts）
```

| 层 | 职责 | 禁止 |
|----|------|------|
| `pages/` | 布局壳、组合主组件 | 直接 `fetch`、复杂业务 |
| `components/` | UI、本地交互状态 | 散落调多个后端接口（应走 hook/service） |
| `hooks/` | 流程编排、权限后的数据加载 | 承载大型 JSX |
| `services/` | HTTP / 存储 / SDK，返回数据或抛错 | 依赖具体 UI 组件 |
| `api/` | Route Handler：校验、转发、读环境变量 | 把 UI 逻辑塞进 route |
| `lib/` | 类型、纯函数、常量 | `window` / React hooks（确需客户端时可放 `utils/` 并注明） |

其他模块可按复杂度裁剪：例如 `invites` 可无独立 `hooks/`；`rbac` 以 `api/` + `lib/` 为主、UI 在 `settings`。

---

## 4. App Router 接线约定

### 页面

```ts
// app/checkin/page.tsx —— 薄入口
import { redirect } from "next/navigation"
import { CheckinPage } from "@/modules/checkin"
import { getAuth } from "@/modules/auth/lib/get-auth"
import { userCanAccessSection } from "@/modules/auth/lib/permissions"

export default async function Page() {
  const auth = await getAuth()
  if (auth.kind !== "user") redirect("/login")
  if (!userCanAccessSection(auth.user, "checkin")) redirect("/requests")
  return <CheckinPage />
}
```

### API

```ts
// app/api/geocode/reverse/route.ts
export const runtime = "nodejs"
export { GET } from "@/modules/checkin/api/reverse-geocode-route"
```

已被 `next.config.mjs` rewrite 到 geo-api 的路径（如 `/api/checkin`、`/api/requests`）：本地 `modules/*/api/*-route.ts` 仅作**未配置 GEO_API_URL 时的误配提示**，不要在 stub 里再写一套业务。

---

## 5. 模块清单与边界

| 模块 | 职责 | 主要对外出口 |
|------|------|----------------|
| `auth` | 登录态、JWT Cookie、飞书代理、权限工具 | `index`、`get-auth`、`permissions` |
| `shell` | 主导航壳 | `AppShell` |
| `crm` | 线索/客户/商机/合同/工作台/看板（geo-api 权威；经 rewrite） | `HomePage`、`CrmProvider`、`crm-api` |
| `projects` | 交付项目管理（P1～P2 已落地；缺口见 `docs/modules/projects.md`） | `ProjectsPage`、详情/归档、BFF `app/api/projects` |
| `audit` | CRM 操作审计（MySQL `crm_audit_records`，经 geo-api） | `AuditProvider`、`EntityAuditHistory` |
| `requests` | 需求单列表/详情/导出 | `RequestsPage`、`RequestsProvider` |
| `invites` | 邀请链接面板 | `InvitePanel` |
| `intake` | 内部代填表单 | `IntakeForm` 等 |
| `checkin` | 外勤打卡、附件、团队记录 | `CheckinPage` |
| `rbac` | 角色权限 **HTTP 客户端**（走 geo-api `/api/rbac/*`；写后由 geo-api 进程内失效缓存）与前端种子目录 | `lib/*`（无页面 barrel） |
| `settings` | 设置页 UI（消费 rbac；飞书通讯录选人） | `SettingsPage` |

**允许的跨模块引用示例**：`settings` → `rbac` + `auth`；`checkin` → `auth/permissions`；`shell` → `auth`。

**避免**：`requests` 直接 import `checkin` 内部 hooks；共享形态应升到 `shared/` 或经明确 API。

---

## 6. 打卡域（checkin）数据流

```
定位(utils/geolocation)
  → 逆地理(services/amap → /api/geocode 或高德 JS)
  → 上传附件(services/checkin-attachments → geo-api)
  → 创建记录(services/checkin-api → geo-api /api/checkin)
  → 拜访态以服务端 active-visit + 个人记录推导为准
```

附件二进制在 **geo-api 本地目录**；库表 `checkin_records.attachments` 存链接与元数据。前端不再使用 IndexedDB 附件存储。

---

## 7. 新增功能检查清单

1. 是否落在正确 `modules/<domain>/`，而不是新建散落目录？  
2. `app/` 是否只增加薄 page / route re-export？  
3. 客户端请求是否集中在 `services/`（或该域既有 data layer）？  
4. 类型是否放在该域 `lib/types`（或 `shared/types`），避免重复 barrel？  
5. 若走 geo-api：是否只需 rewrite，而不是复制一份 Next 业务 API？  
6. 废弃文件是否删除（禁止长期保留 `@deprecated` 空壳）？  

---

## 8. 相关文档

- 后端分层：[geo-api/ARCHITECTURE.md](../geo-api/ARCHITECTURE.md)  
- 阶段总览 / 部署：[`docs/README.md`](../docs/README.md)、[`docs/ops/deploy.md`](../docs/ops/deploy.md)
- 项目管理 / Redis：[`docs/modules/projects.md`](../docs/modules/projects.md)、[`docs/modules/redis-cache.md`](../docs/modules/redis-cache.md)
- 本应用启动：[README.md](./README.md)
