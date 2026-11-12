// 本文件由 geo-api/scripts/gen_frontend_status_catalog.py 自动生成，禁止手改。
// 唯一权威源：geo-api/app/modules/contracts/status_catalog.py
// 校验：cd geo-api && .venv/bin/python -m pytest tests/test_status_catalog_generated_up_to_date.py -q
// ===== 需求状态（含历史遗留兼容值，仅保证渲染不崩，不进入筛选/动作） =====
export type RequestStatus =
  | "draft"
  | "submitted"
  // 历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）
  | "supplement"
  | "pending_review"
  | "confirmed"
  | "in_project"
  // 历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）
  | "closed"
  // 历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）
  | "reviewing"
  // 历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）
  | "approved"
  // 历史遗留状态（geo-api 旧枚举兼容，仅保证渲染不崩，不进入筛选/动作）
  | "rejected"

export const STATUS_META: Record<RequestStatus, { label: string; description: string; tone: "neutral" | "info" | "warning" | "success" | "muted" }> = {
  draft: { label: "保存草稿", description: "客户尚未正式提交", tone: "muted" },
  submitted: { label: "客户已提交", description: "客户已通过邀请提交，等待销售确认收到", tone: "info" },
  // 历史遗留/兼容值
  supplement: { label: "待补充", description: "历史遗留状态：当前信息不完整，需要客户补充（不在需求管理中使用）", tone: "warning" },
  pending_review: { label: "待销售确认", description: "信息基本完整，等待销售确认需求", tone: "warning" },
  confirmed: { label: "已确认", description: "需求内容已经销售确认，可独立完成处理", tone: "success" },
  in_project: { label: "已完成", description: "需求处理已完成", tone: "success" },
  // 历史遗留/兼容值
  closed: { label: "已关闭", description: "历史遗留状态：需求取消或不再继续跟进（不在需求管理中使用）", tone: "neutral" },
  // 历史遗留/兼容值
  reviewing: { label: "审核中", description: "历史遗留状态：需求审核中", tone: "warning" },
  // 历史遗留/兼容值
  approved: { label: "已确认", description: "历史遗留状态：需求已确认", tone: "success" },
  // 历史遗留/兼容值
  rejected: { label: "已拒绝", description: "历史遗留状态：需求已拒绝", tone: "neutral" },
}

export const STATUS_ACTIONS: Partial<Record<RequestStatus, { label: string; next: RequestStatus }>> = {
  submitted: { label: "确认收到", next: "pending_review" },
  pending_review: { label: "确认需求", next: "confirmed" },
  confirmed: { label: "完成需求", next: "in_project" },
}

// ===== 需求业务归属（GEO 来源） =====
export type RequestGeoSource =
  | "domestic"
  | "overseas"
  | "mestbo"
  | "manual"

export const REQUEST_GEO_SOURCE_META: Record<RequestGeoSource, { label: string; shortLabel: string; feishuSource: string; codePrefix: string; tone: string }> = {
  domestic: { label: "国内 GEO", shortLabel: "国内", feishuSource: "国内GEO需求", codePrefix: "GEO-CN", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  overseas: { label: "海外 GEO", shortLabel: "海外", feishuSource: "海外GEO需求", codePrefix: "GEO-OV", tone: "border-violet-200 bg-violet-50 text-violet-800" },
  mestbo: { label: "麦思博 GEO", shortLabel: "麦思博", feishuSource: "麦思博GEO需求", codePrefix: "GEO-MS", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  manual: { label: "系统录入", shortLabel: "系统", feishuSource: "", codePrefix: "", tone: "border-border bg-muted/40 text-muted-foreground" },
}

// ===== 国内填报：AI 平台 =====
export const DOMESTIC_AI_PLATFORM_OPTIONS = [
  "豆包",
  "DeepSeek",
  "元宝",
  "千问",
] as const

// ===== 国内填报：优化周期 =====
export const DOMESTIC_OPTIMIZE_PERIODS = [
  { value: "3", label: "3 个月" },
  { value: "6", label: "6 个月" },
  { value: "12", label: "12 个月" },
  { value: "custom", label: "自定义" },
] as const

// ===== 国内填报：优化目标 =====
export const DOMESTIC_OPTIMIZATION_GOALS = [
  { value: "recommend_60", label: "推荐率 ≥ 60%" },
  { value: "top3_60", label: "前三推荐率 ≥ 60%" },
  { value: "priority_60", label: "优先推荐率 ≥ 60%" },
  { value: "content", label: "内容优化" },
  { value: "sentiment", label: "舆情" },
] as const

// ===== 海外填报：优化目标值（label 在 i18n 翻译资源） =====
export const OPTIMIZATION_GOAL_VALUES = [
  "source",
  "recommend",
  "top3",
  "priority",
] as const
