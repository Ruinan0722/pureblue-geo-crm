import type { StaffRole } from "@/modules/auth/lib/role-config"

export type DevIdentityGroup = "市场" | "销售链路" | "交付与管理"

export interface DevIdentityLogin {
  role: StaffRole
  name: string
  label: string
  tip: string
  group: DevIdentityGroup
  permissionOverrides?: string[]
}

/**
 * 开发 / Staging 测试身份：登录页与壳内切换器共用。
 * 优先使用真实成员（同名即以其真实身份登录，数据/权限按真实归属）；
 * 无同名真实成员时回退为 dev 占位用户（如 超级测试）。
 */
export const DEV_IDENTITY_LOGINS: DevIdentityLogin[] = [
  {
    role: "marketing_leader",
    name: "演示成员01",
    label: "市场负责人",
    tip: "市场经营链路只读；可编辑线索",
    group: "市场",
  },
  {
    role: "marketing",
    name: "演示成员02",
    label: "市场成员 · 特殊权限",
    tip: "线索、客户与数据看板只读",
    group: "市场",
  },
  {
    role: "marketing",
    name: "演示成员03",
    label: "市场成员",
    tip: "线索、客户与数据看板只读",
    group: "市场",
  },
  { role: "sdr", name: "演示成员04", label: "SDR · 销售部", tip: "线索主路径：新建/跟进/转客户；无客户管理", group: "销售链路" },
  {
    role: "sdr",
    name: "演示成员05",
    label: "SDR · 销售部",
    tip: "线索主路径：新建/跟进/转客户；无客户管理",
    group: "销售链路",
  },
  { role: "sales", name: "演示成员06", label: "销售 · 直销华北(北二)", tip: "客户/商机推进；合同只读", group: "销售链路" },
  {
    role: "sales",
    name: "演示成员07",
    label: "销售 · 直销华北(北一)",
    tip: "对接池隔离：只见本人池的联系人与跟进",
    group: "销售链路",
  },
  {
    role: "sales",
    name: "演示成员08",
    label: "销售 · 渠道华北",
    tip: "对接池隔离：只见本人池的联系人与跟进",
    group: "销售链路",
  },
  {
    role: "sales",
    name: "演示成员09",
    label: "销售 · 直销华东",
    tip: "线索跟进与转客户链路",
    group: "销售链路",
  },
  {
    role: "leader",
    name: "演示成员10",
    label: "销售 Leader",
    tip: "销售部负责人：可见管辖子树内销售的对接池数据",
    group: "销售链路",
  },
  { role: "ops", name: "演示成员11", label: "销售运营", tip: "维护合同与经营数据", group: "交付与管理" },
  { role: "leader", name: "演示成员12", label: "解决方案负责人", tip: "解决方案/售前链路；商机顾问反馈", group: "交付与管理" },
  {
    role: "presales",
    name: "演示成员13",
    label: "解决方案 · 售前顾问",
    tip: "全量商机只读；可分配商机给解决方案成员",
    group: "交付与管理",
  },
  { role: "viewer", name: "演示成员14", label: "客户成功", tip: "交付项目维护与进度跟进", group: "交付与管理" },
  { role: "overseas", name: "演示成员15", label: "海外运营", tip: "海外需求、商机、合同与项目", group: "交付与管理" },
  { role: "admin", name: "演示成员16", label: "管理员", tip: "系统设置与权限管理（创新效能中心·AI效能）", group: "交付与管理" },
  { role: "super_admin", name: "演示成员17", label: "超级管理员", tip: "全目录权限（创新效能中心·AI效能）", group: "交付与管理" },
]

export const DEV_IDENTITY_GROUPS: DevIdentityGroup[] = ["市场", "销售链路", "交付与管理"]

export const DEV_SALES_NAMES = DEV_IDENTITY_LOGINS.filter((i) =>
  ["sales", "leader", "ops", "admin"].includes(i.role),
).map((i) => i.name)
