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

// ===== 商机阶段（9 正阶段 + demand/solution/quote 旧合并兼容值） =====
export type OppStage =
  | "contact"
  | "demand_research"
  | "demand_diagnosis"
  | "solution_confirm"
  | "business_negotiation"
  | "bidding"
  | "signing"
  | "won"
  | "lost"
  // 旧合并值兼容
  | "demand"
  // 旧合并值兼容
  | "solution"
  // 旧合并值兼容
  | "quote"

export const OPP_STAGES: OppStage[] = [
  "contact",
  "demand_research",
  "demand_diagnosis",
  "solution_confirm",
  "business_negotiation",
  "bidding",
  "signing",
  "won",
  "lost",
]

export const OPP_STAGE_META: Record<OppStage, { label: string; tone: string }> = {
  contact: { label: "初步接触", tone: "muted" },
  demand_research: { label: "需求调研", tone: "info" },
  demand_diagnosis: { label: "需求诊断", tone: "info" },
  solution_confirm: { label: "方案确认", tone: "info" },
  business_negotiation: { label: "商务谈判", tone: "warning" },
  bidding: { label: "招投标阶段", tone: "warning" },
  signing: { label: "签署中", tone: "warning" },
  won: { label: "已签订", tone: "success" },
  lost: { label: "输单", tone: "neutral" },
  // 历史遗留/兼容值
  demand: { label: "需求诊断", tone: "info" },
  // 历史遗留/兼容值
  solution: { label: "方案确认", tone: "info" },
  // 历史遗留/兼容值
  quote: { label: "商务谈判", tone: "warning" },
}

// ===== 合同状态（与飞书 1:1；void 仅保留系统作废兼容） =====
export type ContractStatus =
  | "pending"
  | "signed"
  | "terminated"
  | "closed"
  // 系统作废兼容（非飞书值）
  | "void"

export const CONTRACT_STATUSES: ContractStatus[] = [
  "pending",
  "signed",
  "terminated",
  "closed",
  "void",
]

export const CONTRACT_STATUS_META: Record<ContractStatus, { label: string; tone: string }> = {
  pending: { label: "待签订", tone: "muted" },
  signed: { label: "已签订", tone: "success" },
  terminated: { label: "签订后终止", tone: "danger" },
  closed: { label: "已关闭", tone: "neutral" },
  // 历史遗留/兼容值
  void: { label: "已作废", tone: "danger" },
}

// ===== 合同遗留 projectStatus（签约侧遗留状态，不与 Project.stage 双写） =====
export type ProjectStatus =
  | "not_started"
  | "ongoing"
  | "completed"
  | "closed"

export const PROJECT_STATUSES: ProjectStatus[] = [
  "not_started",
  "ongoing",
  "completed",
  "closed",
]

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: string }> = {
  not_started: { label: "未开始", tone: "muted" },
  ongoing: { label: "进行中", tone: "info" },
  completed: { label: "已完成", tone: "success" },
  closed: { label: "已关闭", tone: "neutral" },
}

// ===== 交付项目阶段（Project.stage，交付执行权威阶段） =====
export type ProjectStage =
  | "pending_start"
  | "active"
  | "completed"
  | "paused"

export const PROJECT_STAGES: ProjectStage[] = [
  "pending_start",
  "active",
  "completed",
  "paused",
]

export const PROJECT_STAGE_META: Record<ProjectStage, { label: string; tone: string }> = {
  pending_start: { label: "待启动", tone: "muted" },
  active: { label: "执行中", tone: "info" },
  completed: { label: "已完结", tone: "success" },
  paused: { label: "已延期", tone: "danger" },
}

// ===== 交付项目健康度 =====
export type ProjectHealth =
  | "healthy"
  | "watch"
  | "unhealthy"

export const PROJECT_HEALTHS: ProjectHealth[] = [
  "healthy",
  "watch",
  "unhealthy",
]

export const PROJECT_HEALTH_META: Record<ProjectHealth, { label: string; tone: string }> = {
  healthy: { label: "健康", tone: "success" },
  watch: { label: "一般", tone: "warning" },
  unhealthy: { label: "不健康", tone: "danger" },
}

// ===== 交付项目风险等级 =====
export type ProjectRisk =
  | "low"
  | "medium"
  | "high"

export const PROJECT_RISKS: ProjectRisk[] = [
  "low",
  "medium",
  "high",
]

export const PROJECT_RISK_META: Record<ProjectRisk, { label: string; tone: string }> = {
  low: { label: "低", tone: "success" },
  medium: { label: "中", tone: "warning" },
  high: { label: "高", tone: "danger" },
}

// ===== 交付项目记录类型（跟进记录 kind） =====
export type ProjectNoteKind =
  | "weekly"
  | "communication"
  | "execution"
  | "risk"
  | "next_step"
  | "other"

export const PROJECT_NOTE_KINDS: ProjectNoteKind[] = [
  "weekly",
  "communication",
  "execution",
  "risk",
  "next_step",
  "other",
]

export const PROJECT_NOTE_KIND_META: Record<ProjectNoteKind, string> = {
  weekly: "周报",
  communication: "客户沟通",
  execution: "执行进展",
  risk: "风险记录",
  next_step: "下一步计划",
  other: "其他",
}

// ===== 客户状态（5 正状态 + potential/following/lost 旧值兼容展示） =====
export type CustomerStatus =
  | "awaiting_contact"
  | "connected"
  | "opportunity_following"
  | "cooperating"
  | "stopped"
  // 旧值兼容展示（读取时请 normalizeCustomerStatus）
  | "potential"
  // 旧值兼容展示（读取时请 normalizeCustomerStatus）
  | "following"
  // 旧值兼容展示（读取时请 normalizeCustomerStatus）
  | "lost"

export const CUSTOMER_STATUSES: CustomerStatus[] = [
  "awaiting_contact",
  "connected",
  "opportunity_following",
  "cooperating",
  "stopped",
]

export const CUSTOMER_STATUS_META: Record<CustomerStatus, { label: string; tone: string }> = {
  awaiting_contact: { label: "待建联", tone: "muted" },
  connected: { label: "已建联", tone: "info" },
  opportunity_following: { label: "商机跟进", tone: "warning" },
  cooperating: { label: "已合作", tone: "success" },
  stopped: { label: "停止跟进", tone: "neutral" },
  // 历史遗留/兼容值
  potential: { label: "待建联", tone: "muted" },
  // 历史遗留/兼容值
  following: { label: "已建联", tone: "info" },
  // 历史遗留/兼容值
  lost: { label: "停止跟进", tone: "neutral" },
}

// ===== 线索状态 =====
export type LeadStatus =
  | "untouched"
  | "touched"
  | "converted"
  | "invalid"

export const LEAD_STATUS_META: Record<LeadStatus, { label: string; tone: string }> = {
  untouched: { label: "未触达", tone: "muted" },
  touched: { label: "已触达", tone: "info" },
  converted: { label: "已转客户", tone: "success" },
  invalid: { label: "无效线索", tone: "neutral" },
}

// ===== 线索等级（与飞书 1:1，含代理/海外，不合并到 A–D） =====
export type LeadLevel =
  | "A"
  | "B"
  | "C"
  | "D"
  | "代理"
  | "海外"

export const LEAD_LEVELS: LeadLevel[] = [
  "A",
  "B",
  "C",
  "D",
  "代理",
  "海外",
]

export const LEAD_LEVEL_META: Record<LeadLevel, string> = {
  A: "A 级",
  B: "B 级",
  C: "C 级",
  D: "D 级",
  代理: "代理",
  海外: "海外",
}

// ===== 跟进状态 =====
export type FollowState =
  | "need"
  | "no_need"
  | "converted"

export const FOLLOW_STATE_META: Record<FollowState, { label: string }> = {
  need: { label: "需要跟进" },
  no_need: { label: "无需跟进" },
  converted: { label: "已转为客户" },
}

// ===== 跟进方式 =====
export type FollowType =
  | "online"
  | "offline"

export const FOLLOW_TYPE_OPTIONS: Array<{ value: FollowType; label: string }> = [
  { value: "online", label: "线上沟通" },
  { value: "offline", label: "线下拜访" },
]

// ===== 线索一级来源（13 个） =====
export const LEAD_SOURCES = [
  "渠道资料单",
  "渠道伙伴",
  "机构引荐",
  "线上投放",
  "三方会议",
  "自办会议",
  "官网注册",
  "热线电话",
  "内容营销",
  "数据采买",
  "名单外呼",
  "自拓",
  "其他来源",
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

// 机构引荐 · 二级（可后续增补）
export const LEAD_SOURCE_INSTITUTIONS = [
  "ToBCGO",
] as const

// 内容营销 · 二级（渠道识别）
export const LEAD_SOURCE_CONTENT_CHANNELS = [
  "小红书",
  "公众号",
  "抖音",
  "视频号",
] as const

// 官网注册 · 二级（官网首页 / Mark / 36氪入口）
export const LEAD_SOURCE_WEBSITE_ENTRIES = [
  "官网首页",
  "Mark",
  "36氪",
] as const

// 会议类一级来源（三方会议/自办会议共用会议二级交互）
export const MEETING_PRIMARY_SOURCES = [
  "三方会议",
  "自办会议",
] as const

// 历史写法 → 标准一级来源（导入/筛选兼容）
export const LEGACY_LEAD_SOURCE_MAP: Record<string, LeadSource> = {
  "机构推荐": "机构引荐",
  "线下会议": "自办会议",
  "官网": "官网注册",
  "官网首页": "官网注册",
  "landing page": "官网注册",
  "Landing page": "官网注册",
  "Landing Page": "官网注册",
  "36Kr": "官网注册",
  "36kr": "官网注册",
  "36氪": "官网注册",
  "Mark": "官网注册",
  "mark": "官网注册",
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

// ===== 纯展示/选项常量（后端无校验清单，统一单源） =====
export const REGIONS = [
  "华东区",
  "华南区",
  "华北区",
  "海外",
] as const

export const CHANNEL_TYPES = [
  "广告代理",
  "个人",
  "媒体",
  "数字营销与SEO/GEO",
  "SaaS/营销科技经销商",
  "行业协会与商会",
] as const

export const CHANNEL_LEVELS = [
  "重点合作",
  "继续跟进",
  "一般合作",
  "暂不考虑",
  "生态伙伴",
  "黑名单",
  "Mark合作",
] as const

export const CHANNEL_AGENCY_TYPES = [
  "服务",
  "产品",
] as const

export const CHANNEL_OPPORTUNITY_STAGES = [
  "需求确认",
  "商务沟通",
  "签署中",
  "赢单",
] as const

export const CHANNEL_CONTRACT_STATUSES = [
  "否",
  "是",
  "准备签约",
  "走入库流程了",
] as const

export const CHANNEL_REGIONS: Record<string, string[]> = {
  华北区: ["北京", "黑龙江", "吉林", "辽宁", "内蒙古", "天津", "河北", "山东", "山西", "陕西"],
  华南区: ["广东", "广西壮族自治区", "海南", "香港特别行政区", "澳门特别行政区", "贵州", "四川", "湖南", "湖北"],
  华东区: ["江西", "福建", "安徽", "浙江", "江苏", "上海"],
}

export const INDUSTRIES: Record<string, string[]> = {
  工业制造: ["机械 / 设备", "电子", "化工", "建材", "纺织", "包装", "汽车零部件"],
  科技互联网: ["IT / 软件", "SaaS", "云计算", "AI", "大数据", "通信", "互联网服务", "企业服务"],
  商贸零售: ["快消", "美妆", "服饰", "商超", "便利店", "电商", "母婴", "家居"],
  医疗健康: ["医疗器械", "药品", "医院", "诊所", "医美", "体检", "生物科技"],
  金融: ["银行", "保险", "证券", "支付", "企业金融", "FinTech"],
  教育: ["K12", "高教", "职教", "教培", "教育装备", "在线教育"],
  地产建筑: ["房产", "建筑", "工程", "装修", "物业", "建材"],
  文旅餐饮: ["酒店", "餐饮", "旅游", "景区", "文娱", "传媒广告"],
  农林牧渔: ["农业", "农资", "畜牧", "水产", "食品加工"],
  政府与公共事业: ["政务", "公安", "交通", "能源", "水利", "环保", "科研"],
}

export const COMPANY_NATURES = [
  "有限责任公司",
  "股份有限公司",
  "外商投资企业",
  "个人独资企业",
] as const

export const PROJECT_TYPES = [
  "监测",
  "排名优化",
  "词条优化",
] as const

export const OPT_PERIODS = [
  "3 个月",
  "6 个月",
  "12 个月",
] as const

export const LOST_REASON_OPTIONS = {
  预算与价格原因: ["客户预算不足", "客户认为价格过高", "客户采购计划暂缓", "预算周期不匹配"],
  采购与决策原因: ["客户决策变更", "客户内部推进停滞", "长时间未反馈", "客户回复不及时", "客户采购计划取消"],
  产品与方案原因: ["产品能力不满足", "方案不满足客户需求", "不满足招标需求", "不支持客户所在行业", "客户 KPI 需求与我方方案不匹配"],
  服务与响应原因: ["服务支撑不足", "未能及时响应客户需求", "客户认为服务效果不理想", "客户对交付保障有顾虑"],
  竞品原因: ["客户选择竞品", "竞品报价更低", "竞品截单", "竞品中标", "客户已有固定供应商"],
  招投标原因: ["未中标", "招标文件需求不匹配", "内定供应商", "投标时间错过", "不满足招标资质要求"],
  客户需求不匹配: ["客户目标与我方服务主张不一致", "客户需求超出当前服务范围", "客户行业暂不支持", "客户只做咨询了解，无明确采购意向"],
  项目暂停或取消: ["项目暂停", "项目取消", "客户内部优先级调整", "市场节点已错过"],
  商机质量问题: ["非真实商机", "为匹配顾问需求而创建", "线索质量不足", "客户无明确需求", "重复商机"],
  其他原因: ["其他原因"],
} as const

export const CONTRACT_TYPES = [
  "新签",
  "续签",
  "增购",
] as const

export const SIGN_TYPES = [
  "线上电子签",
  "线下纸质签",
] as const

export const CONTRACT_SOURCES = [
  "市场",
  "机构推荐",
  "自己联系",
  "个人渠道资源",
  "渠道介绍",
  "KA",
  "渠道伙伴",
  "官网",
  "知乎",
  "蓝标",
  "阿里汇川",
  "瀚海",
  "市场投放",
  "展会",
  "自主开发",
  "生态推荐",
] as const

export const PROJECT_TYPE_OPTIONS = [
  "品牌曝光",
  "舆情消除",
  "词条优化",
  "数据监控",
] as const

export const PROJECT_PLATFORM_OPTIONS = [
  "DeepSeek",
  "豆包",
  "元宝",
  "千问",
  "其他",
] as const

// ===== 填报端表单值清单（国内代客填报 / 客户填报共用） =====
export const DOMESTIC_AI_PLATFORM_OPTIONS = [
  "豆包",
  "DeepSeek",
  "元宝",
  "千问",
] as const

export const DOMESTIC_OPTIMIZE_PERIODS = [
  { value: "3", label: "3 个月" },
  { value: "6", label: "6 个月" },
  { value: "12", label: "12 个月" },
  { value: "custom", label: "自定义" },
] as const

export const DOMESTIC_OPTIMIZATION_GOALS = [
  { value: "recommend_60", label: "推荐率 ≥ 60%" },
  { value: "top3_60", label: "前三推荐率 ≥ 60%" },
  { value: "priority_60", label: "优先推荐率 ≥ 60%" },
  { value: "content", label: "内容优化" },
  { value: "sentiment", label: "舆情" },
] as const

export const OPTIMIZATION_GOAL_VALUES = [
  "source",
  "recommend",
  "top3",
  "priority",
] as const
