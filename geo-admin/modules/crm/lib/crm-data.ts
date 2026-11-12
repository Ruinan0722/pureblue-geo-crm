// GEO 客户经营与需求管理平台 —— CRM 数据层
// 线索(Lead) → 客户(Customer) + 联系人(Contact) → 商机(Opportunity) → 合同(Contract)
// 跟进记录(FollowUp) 贯穿线索/客户/商机

// 状态机/常量唯一权威源：geo-api/app/modules/contracts/status_catalog.py
// 本文件仅 re-export 生成产物，禁止手写状态码/label/tone/来源清单。
import {
  CHANNEL_AGENCY_TYPES,
  CHANNEL_CONTRACT_STATUSES,
  CHANNEL_LEVELS,
  CHANNEL_OPPORTUNITY_STAGES,
  CHANNEL_REGIONS,
  CHANNEL_TYPES,
  COMPANY_NATURES,
  CONTRACT_SOURCES,
  CONTRACT_STATUS_META,
  CONTRACT_TYPES,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_META,
  FOLLOW_STATE_META,
  FOLLOW_TYPE_OPTIONS,
  INDUSTRIES,
  LEAD_LEVELS,
  LEAD_LEVEL_META,
  LEAD_SOURCES,
  LEAD_SOURCE_CONTENT_CHANNELS,
  LEAD_SOURCE_INSTITUTIONS,
  LEAD_SOURCE_WEBSITE_ENTRIES,
  LEAD_STATUS_META,
  LEGACY_LEAD_SOURCE_MAP,
  LOST_REASON_OPTIONS,
  MEETING_PRIMARY_SOURCES,
  OPT_PERIODS,
  OPP_STAGES,
  OPP_STAGE_META,
  PROJECT_TYPES,
  PROJECT_STATUS_META,
  REGIONS,
  SIGN_TYPES,
} from "./status-catalog.generated"
import type {
  ContractStatus,
  CustomerStatus,
  FollowState,
  FollowType,
  LeadLevel,
  LeadSource,
  LeadStatus,
  OppStage,
  ProjectStatus,
} from "./status-catalog.generated"

export {
  CHANNEL_AGENCY_TYPES,
  CHANNEL_CONTRACT_STATUSES,
  CHANNEL_LEVELS,
  CHANNEL_OPPORTUNITY_STAGES,
  CHANNEL_REGIONS,
  CHANNEL_TYPES,
  COMPANY_NATURES,
  CONTRACT_SOURCES,
  CONTRACT_STATUS_META,
  CONTRACT_TYPES,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_META,
  FOLLOW_STATE_META,
  FOLLOW_TYPE_OPTIONS,
  INDUSTRIES,
  LEAD_LEVELS,
  LEAD_LEVEL_META,
  LEAD_SOURCES,
  LEAD_SOURCE_CONTENT_CHANNELS,
  LEAD_SOURCE_INSTITUTIONS,
  LEAD_SOURCE_WEBSITE_ENTRIES,
  LEAD_STATUS_META,
  LEGACY_LEAD_SOURCE_MAP,
  LOST_REASON_OPTIONS,
  MEETING_PRIMARY_SOURCES,
  OPT_PERIODS,
  OPP_STAGES,
  OPP_STAGE_META,
  PROJECT_TYPES,
  PROJECT_STATUS_META,
  REGIONS,
  SIGN_TYPES,
}
export type {
  ContractStatus,
  CustomerStatus,
  FollowState,
  FollowType,
  LeadLevel,
  LeadSource,
  LeadStatus,
  OppStage,
  ProjectStatus,
}

// ===== 通用选项 =====
/**
 * 三方会议 · 二级会议名（由 PR 维护；暂无条目时表单改为手填）
 * 增补时在此数组追加即可变为下拉。
 */
export const LEAD_SOURCE_MEETINGS: string[] = []

export type LeadSourceSecondaryMode = "select" | "text" | "none"

export function normalizeLeadSource(raw: unknown): string {
  const s = String(raw || "").trim()
  if (!s) return ""
  if ((LEAD_SOURCES as readonly string[]).includes(s)) return s
  return LEGACY_LEAD_SOURCE_MAP[s] ?? s
}

/** 按一级来源返回二级录入方式（dynamicOptions 为维护端配置的可选二级，如会议/机构） */
export function leadSourceSecondaryConfig(primary: string, dynamicOptions: readonly string[] = LEAD_SOURCE_MEETINGS): {
  mode: LeadSourceSecondaryMode
  options: readonly string[]
  label: string
  placeholder: string
} {
  const source = normalizeLeadSource(primary)
  if (source === "机构引荐") {
    return {
      mode: "select",
      options: Array.from(new Set([...LEAD_SOURCE_INSTITUTIONS, ...dynamicOptions])),
      label: "来源二级（机构）",
      placeholder: "请选择机构",
    }
  }
  if (source === "内容营销") {
    return {
      mode: "select",
      options: LEAD_SOURCE_CONTENT_CHANNELS,
      label: "来源二级（渠道）",
      placeholder: "请选择渠道",
    }
  }
  if (source === "官网注册") {
    return {
      mode: "select",
      options: LEAD_SOURCE_WEBSITE_ENTRIES,
      label: "来源二级（官网入口）",
      placeholder: "请选择入口",
    }
  }
  if ((MEETING_PRIMARY_SOURCES as readonly string[]).includes(source)) {
    return {
      mode: "select",
      options: dynamicOptions,
      label: "来源二级（会议）",
      placeholder: dynamicOptions.length > 0 ? "请选择会议" : "暂无可选会议，请联系市场维护",
    }
  }
  if (source === "其他来源") {
    return {
      mode: "text",
      options: [],
      label: "来源二级",
      placeholder: "请填写具体来源",
    }
  }
  return {
    mode: "none",
    options: [],
    label: "来源二级",
    placeholder: "",
  }
}

export const INDUSTRY_L1 = Object.keys(INDUSTRIES)

/** 统一社会信用代码：18 位数字或英文字母（大小写均可）；空值表示未填写 */
export const CREDIT_CODE_LENGTH = 18
const CREDIT_CODE_PATTERN = /^[0-9A-Za-z]{18}$/

/** 输入时过滤非法字符并截断至 18 位 */
export function sanitizeCreditCodeInput(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").slice(0, CREDIT_CODE_LENGTH)
}

/**
 * 校验统一社会信用代码。
 * @returns 错误文案；通过或为空则返回 null
 */
export function validateCreditCode(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (!CREDIT_CODE_PATTERN.test(value)) {
    return `统一社会信用代码须为 ${CREDIT_CODE_LENGTH} 位数字或英文字母（大小写均可）`
  }
  return null
}

// ===== 线索 =====
/** 历史演示数据曾写入 following；未知状态不得使列表或详情崩溃。 */
export function leadStatusMeta(status: unknown, leadType?: string): { label: string; tone: string } {
  const raw = typeof status === "string" ? status.trim() : ""
  const code = raw === "following" ? "touched" : raw
  const meta = Object.prototype.hasOwnProperty.call(LEAD_STATUS_META, code)
    ? LEAD_STATUS_META[code as LeadStatus]
    : { label: "未知状态", tone: "muted" }
  return leadType === "channel" && code === "converted" ? { ...meta, label: "已转渠道商" } : meta
}

export function leadLevelLabel(level: LeadLevel | string): string {
  if (!level) return "未评级"
  return LEAD_LEVEL_META[level as LeadLevel] ?? `${level} 级`
}

/** 筛选「未评级」的约定值（空等级） */
export const LEAD_LEVEL_UNSET = "__unset__"

/** 展示跟进状态：已转客户 / 无效优先于字段旧值，兼容历史数据 */
export function leadFollowStateLabel(lead: { status: LeadStatus; followState?: FollowState | string; leadType?: string }): string {
  if (lead.status === "converted") return lead.leadType === "channel" ? "已转渠道商" : FOLLOW_STATE_META.converted.label
  if (lead.status === "invalid") return FOLLOW_STATE_META.no_need.label
  const key = (lead.followState || "need") as FollowState
  return FOLLOW_STATE_META[key]?.label ?? FOLLOW_STATE_META.need.label
}

export function followTypeLabel(type?: FollowType): string {
  return FOLLOW_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? ""
}

/** 校验任意字符串是否为合法跟进方式；不合法返回空串（下拉框受控值安全转换） */
export function coerceFollowType(v: string | undefined | null): FollowType | "" {
  return FOLLOW_TYPE_OPTIONS.some((opt) => opt.value === v) ? (v as FollowType) : ""
}

export interface FollowUp {
  id: string
  author: string
  content: string
  date: string
  wechatAdded?: boolean // 是否加企微
  followType?: FollowType // 跟进方式
  contactId?: string // 本次跟进绑定的联系人
  contactName?: string // 联系人名称快照，避免联系人改名后历史失真
  mentions?: string[] // @成员
  nextFollowAt?: string // 下次计划跟进日期
  /** 线索转客户 / 需求绑定自动闭环时带入 */
  origin?: "lead" | "request"
  sourceLeadId?: string
  sourceLeadNoteId?: string
  sourceRequestId?: string
  sourceRequestNoteId?: string
}

/** 取跟进记录中最新的有效日期（只按自然日比较）。 */
export function latestFollowDate(
  notes: Array<Pick<FollowUp, "date"> | null | undefined> | null | undefined,
): string | null {
  const dates = (notes ?? [])
    .map((note) => String(note?.date || "").trim().slice(0, 10).replace(/\//g, "-"))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  return dates.length ? dates.sort().at(-1) || null : null
}

/** 当前日期减去指定日期的自然日数；空值/非法日期返回 null。 */
export function daysSinceDate(value: string | null | undefined): number | null {
  const day = String(value || "").trim().slice(0, 10).replace(/\//g, "-")
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const [, year, month, date] = match
  const target = Date.UTC(Number(year), Number(month) - 1, Number(date))
  if (!Number.isFinite(target)) return null
  const today = new Date()
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.floor((todayUtc - target) / 86_400_000))
}

/** 联系人维度：优先按联系人 id 匹配，兼容旧记录再按联系人名称匹配。 */
export function latestFollowDateForContact(
  notes: FollowUp[] | null | undefined,
  contactId: string,
  contactName?: string,
): string | null {
  const matched = (notes ?? []).filter((note) =>
    note.contactId === contactId || (!note.contactId && Boolean(contactName) && note.contactName === contactName),
  )
  return latestFollowDate(matched)
}

/** 外部导入溯源；UI 只读（飞书 / Mark / 36氪 / 官网 统一线索集成） */
export interface LeadImportMeta {
  feishuRecordId?: string
  feishuLeadNo?: string
  landingpageRaw?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  createdByName?: string
  importedAt: string
  /** 统一线索集成平台：mark | 36kr | website；飞书导入无此字段 */
  platform?: string
  externalRecordId?: string
  operator?: { name?: string } | null
  lastEventId?: string
  occurredAt?: string
}

export interface MarkMaterial {
  id: string
  fileId: string
  fileName: string
  materialVersion: string
  contentType: "application/pdf"
  size: number
  checksum?: string
  status: "pending_download" | "downloading" | "downloaded" | "download_failed" | "expired"
  failureReason?: string
  downloadAttempts: number
  isCurrent: boolean
  generatedAt?: string
  uploadedAt?: string
  url?: string
}

export interface Lead {
  leadType?: "channel"
  industry?: string
  channelType?: string
  signingMethod?: string
  convertedPartnerId?: string
  id: string
  /** 创建日期 YYYY-MM-DD；「今日新增」以此为准 */
  createdAt?: string
  firstContactDate: string // 首次触达日期
  transferDate: string // 转出日期
  source: string
  /** 来源二级（如机构名、企微等） */
  sourceDetail?: string
  companyName: string
  /** 品牌名称；转客户时写入客户 brandName，列表展示对齐「客户 / 品牌」 */
  brandName?: string
  /** 官网 URL */
  website?: string
  /** 第三方提交的需求描述 */
  requirements?: string
  city: string
  region: string
  contactName: string
  contactTitle: string
  /** 联系人所属部门 */
  contactDepartment?: string
  /** 联系人电话（与 contactWechat 至少填一项） */
  contactPhone?: string
  /** 联系人微信（与 contactPhone 至少填一项） */
  contactWechat?: string
  email: string
  sdr: string
  sales: string
  level: LeadLevel
  followState: FollowState // 需要跟进 / 无需跟进 / 已转为客户
  status: LeadStatus
  invalidReason?: string
  /** 线索级是否已加企微 */
  wechatAdded?: boolean
  notes: FollowUp[]
  /** SDR 上传的线索附件；转客户时带入客户 */
  attachments?: CrmAttachment[]
  /** Mark 通过 S3 地址交付、由 CRM 后台归档的 PDF 材料 */
  markMaterials?: MarkMaterial[]
  convertedCustomerId?: string
  /** 外部导入元数据（只读展示） */
  importMeta?: LeadImportMeta
}

// ===== 客户 =====
/** 飞书中文状态 → 系统枚举 */
export const FEISHU_CUSTOMER_STATUS_MAP: Record<string, CustomerStatus> = {
  待建联: "awaiting_contact",
  已建联: "connected",
  商机跟进: "opportunity_following",
  已合作: "cooperating",
  停止跟进: "stopped",
}

export function normalizeCustomerStatus(raw: unknown): CustomerStatus {
  const s = String(raw ?? "").trim()
  // 兼容接口/序列化偶发 camelCase
  const camel: Record<string, CustomerStatus> = {
    awaitingContact: "awaiting_contact",
    opportunityFollowing: "opportunity_following",
  }
  const key = camel[s] || s
  if (!key) return "awaiting_contact"
  if ((CUSTOMER_STATUSES as string[]).includes(key)) return key as CustomerStatus
  if (key in FEISHU_CUSTOMER_STATUS_MAP) return FEISHU_CUSTOMER_STATUS_MAP[key]!
  if (key === "potential") return "awaiting_contact"
  if (key === "following") return "connected"
  if (key === "lost") return "stopped"
  if (key === "cooperating") return "cooperating"
  return "awaiting_contact"
}

/** 列表/详情入库：保留后端空 status（无对接池），勿回落成待建联 */
export function coerceCustomerStatus(raw: unknown): CustomerStatus | "" {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  return normalizeCustomerStatus(raw)
}

/** @通知消息预览：折叠换行并截断，避免消息过长（后端 message 列上限 512）。 */
export function mentionPreview(content: string, max = 120): string {
  const text = String(content ?? "").replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 展示用：永不抛错；空 status 表示「无对接池」 */
export function customerStatusMeta(raw: unknown): { label: string; tone: string } {
  const s = String(raw ?? "").trim()
  if (!s) return { label: "无对接", tone: "muted" }
  const status = normalizeCustomerStatus(raw)
  return CUSTOMER_STATUS_META[status] ?? { label: String(raw || "未知状态"), tone: "muted" }
}

export interface Contact {
  id: string
  name: string
  title: string
  phone: string
  wechat?: string
  email: string
  isPrimary: boolean
  active: boolean
  wechatAdded: boolean
  source?: string
  sourceDetail?: string
  sourceLeadId?: string
  /** 联系人当前状态（待建联/已建联/商机跟进/已合作/停止跟进）；缺省按待建联 */
  status?: string
  /** 新增时间（新建客户 / 添加联系人 / 线索转客户时记录） */
  createdAt?: string
}

export interface Subsidiary {
  id: string // 二级唯一 ID
  name: string
  shortName: string
  creditCode: string
  city: string
}

export interface Customer {
  id: string
  companyUid?: string // 一级公司唯一 ID
  companyName: string
  brandName: string
  /** 官网 URL（线索转客户/自拓建档写入） */
  website?: string
  region: string
  city: string
  industryL1: string
  industryL2: string
  foundedDate: string // 成立时间
  creditCode: string // 统一社会信用代码
  registeredCapital: number // 注册资金（万）
  annualRevenue?: number // 年营业收入（万）
  scale: string // 公司规模（人）
  nature: string // 企业性质
  status: CustomerStatus | ""
  owner: string // 销售负责人
  /** 转客户时的 SDR（可见范围） */
  sdrUserId?: string
  /** 创建人用户 ID（可见范围） */
  createdByUserId?: string
  sdrTransferDate: string
  lastFollowAt: string
  nextFollowAt?: string
  source: string
  sourceDetail?: string
  isKey: boolean // 重点客户
  createdAt: string
  contacts: Contact[]
  subsidiaries?: Subsidiary[]
  notes: FollowUp[]
  /** 客户附件（含线索带入） */
  attachments?: CrmAttachment[]
  /** 列表接口附带：进行中商机数（不含输单） */
  opportunityCount?: number
  /** 列表接口附带：合同数 */
  contractCount?: number
  /** 对接池隔离：本人池 id（可空） */
  myCoverageId?: string | null
  /** 可见对接池（含本人/下属） */
  coverages?: SalesCoverage[]
  /** 公司主档是否可改（leader/ops/admin） */
  canEditMaster?: boolean
  /** 旧档迁移标记 */
  migrationStatus?: "done" | "legacy_shared" | "pending" | string | null
}

/** 销售对接池（公司主档下的经营切片） */
export interface SalesCoverage {
  id: string
  customerId: string
  ownerUserId: string
  ownerName: string
  status: CustomerStatus | string
  clientDept?: string
  contacts: Contact[]
  notes: FollowUp[]
  attachments?: CrmAttachment[]
  lastFollowAt?: string
  nextFollowAt?: string
  isKey?: boolean
  canEdit?: boolean
  sourceLeadId?: string
  sdrName?: string
  sdrTransferDate?: string
}

// ===== 商机 =====
/** 飞书中文阶段 → 系统枚举（禁止合并） */
export const FEISHU_OPP_STAGE_MAP: Record<string, OppStage> = {
  需求调研: "demand_research",
  需求诊断: "demand_diagnosis",
  方案确认: "solution_confirm",
  商务谈判: "business_negotiation",
  招投标阶段: "bidding",
  签署中: "signing",
  已签订: "won",
  输单: "lost",
}

export function normalizeOppStage(raw: unknown): OppStage {
  const key = String(raw || "").trim()
  const camel: Record<string, OppStage> = {
    demandResearch: "demand_research",
    demandDiagnosis: "demand_diagnosis",
    solutionConfirm: "solution_confirm",
    businessNegotiation: "business_negotiation",
  }
  const mapped = camel[key] || key
  if ((OPP_STAGES as string[]).includes(mapped)) return mapped as OppStage
  if (mapped in FEISHU_OPP_STAGE_MAP) return FEISHU_OPP_STAGE_MAP[mapped]!
  if (mapped === "demand") return "demand_diagnosis"
  if (mapped === "solution") return "solution_confirm"
  if (mapped === "quote") return "business_negotiation"
  // 与后端一致：空 → contact；未知非空不强制改成 contact（避免误触发「回退到初步接触」）
  if (!mapped) return "contact"
  return mapped as OppStage
}

/** 展示用：永不抛错 */
export function oppStageMeta(raw: unknown): { label: string; tone: string } {
  const stage = normalizeOppStage(raw)
  return OPP_STAGE_META[stage] ?? { label: String(raw || "未知阶段"), tone: "muted" }
}

/** 看板/流程主路径（不含输单）；用于判断推进或回退 */
export const OPP_FLOW_STAGES: OppStage[] = [
  "contact",
  "demand_research",
  "demand_diagnosis",
  "solution_confirm",
  "business_negotiation",
  "bidding",
  "signing",
  "won",
]

export function isOppStageRollback(from: OppStage, to: OppStage): boolean {
  const fromIdx = OPP_FLOW_STAGES.indexOf(normalizeOppStage(from))
  const toIdx = OPP_FLOW_STAGES.indexOf(normalizeOppStage(to))
  if (fromIdx < 0 || toIdx < 0) return false
  return toIdx < fromIdx
}

// 输单可选阶段（不含 won/lost）由商机阶段 meta 派生，避免中文 label 手写
export const LOST_STAGES = OPP_STAGES.filter((s) => s !== "won" && s !== "lost").map(
  (s) => OPP_STAGE_META[s].label,
)
export type LostReasonL1 = keyof typeof LOST_REASON_OPTIONS
export const LOST_REASONS = Object.keys(LOST_REASON_OPTIONS) as LostReasonL1[]

export interface OpportunityStageHistory {
  stage: OppStage
  enteredAt: string
  leftAt?: string
  /** 进入该阶段时填写的原因 */
  reason?: string
  /** 进入方式：推进 / 回退 */
  changeType?: "advance" | "rollback"
}

export interface OpportunityAttachment {
  id: string
  name: string
  size: number
  uploadedAt: string
  uploadedBy: string
  /** 可访问地址（同域 /api/crm/attachments/...） */
  url?: string
  contentType?: string
  storagePath?: string
  /** 附件用途说明（实现了什么、有什么用） */
  description?: string
  origin?: "lead" | "request"
  sourceRequestId?: string
  sourceRequestAttachmentId?: string
}

/** 线索 / 客户共用附件（真实文件存 geo-api 本地磁盘） */
export interface CrmAttachment {
  id: string
  name: string
  size: number
  uploadedAt: string
  uploadedBy: string
  url?: string
  contentType?: string
  storagePath?: string
  /** 附件用途说明（实现了什么、有什么用） */
  description?: string
  /** 线索转客户 / 需求绑定自动闭环时带入 */
  origin?: "lead" | "request"
  sourceLeadId?: string
  sourceLeadAttachmentId?: string
  sourceRequestId?: string
  sourceRequestAttachmentId?: string
}

export interface Opportunity {
  businessType?: "direct" | "channel" | "strategic_ecosystem"
  partnerId?: string | null
  partnerName?: string | null
  id: string
  name: string // 商机名称
  customerId: string
  subsidiaryId?: string
  subsidiaryName?: string
  brandName: string
  region: string
  /** 国内 / 海外等业务归属 */
  geoSource?: "domestic" | "overseas" | "mestbo" | "manual"
  goal: string // 优化目标（复用 geo-data OPTIMIZATION_GOALS）
  platform: string
  period: string // 优化周期
  amount: number // 商机金额
  probability: number // 成交概率 %
  expectedSignDate: string
  stage: OppStage
  owner: string
  /** 售前顾问（可绑定一人） */
  advisor?: string
  solutionLink?: string
  expectedSolutionDate?: string
  /** 客户成功（可绑定一人） */
  customerSuccess?: string
  projectManagerRequest?: {
    status: "pending" | "assigned"
    applicant: string
    applicantUserId?: string
    appliedAt: string
    reason?: string
    projectManager?: string
    assignedBy?: string
    assignedAt?: string
  }
  projectTypes: string[] // 项目类型（可多选：监测 / 排名优化 / 词条优化）
  primaryContactId: string
  requestIds: string[] // 旧接口兼容字段，始终为空
  notes: FollowUp[] // 销售跟进记录
  advisorNotes: FollowUp[] // 售前顾问反馈记录
  createdAt: string
  lastFollowAt: string
  /** 下次计划跟进日期 YYYY-MM-DD；与客户管理语义一致 */
  nextFollowAt?: string
  stageHistory?: OpportunityStageHistory[]
  attachments?: OpportunityAttachment[]
  // 输单信息
  lostStage?: string
  lostReasonL1?: string
  lostReasonL2?: string
  lostReason?: string
  competitor?: string
}

// ===== 合同 =====
export const FEISHU_CONTRACT_STATUS_MAP: Record<string, ContractStatus> = {
  待签订: "pending",
  已签订: "signed",
  签订后终止: "terminated",
  已关闭: "closed",
}

export function normalizeContractStatus(status: unknown): ContractStatus {
  const s = String(status || "").trim()
  if (s === "signed" || s === "void" || s === "terminated" || s === "closed" || s === "pending") return s
  if (s in FEISHU_CONTRACT_STATUS_MAP) return FEISHU_CONTRACT_STATUS_MAP[s]!
  if (s === "signing") return "pending"
  return "pending"
}

export function normalizeContract(doc: Contract): Contract {
  return {
    ...doc,
    status: normalizeContractStatus(doc.status),
    // 删 JSON 列后若 API 未 compose 子表，attachments 会缺省；避免详情页 .length 崩溃
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
  }
}

/** 完成签署闸门：至少一份合同文件（SOW 不算） */
export function hasContractFileAttachment(attachments: ContractAttachment[] | undefined | null): boolean {
  if (!attachments?.length) return false
  return attachments.some((item) => {
    const kind = String(item.kind || "contract").trim().toLowerCase()
    if (kind === "sow") return false
    return Boolean(String(item.id || item.name || item.url || "").trim())
  })
}
export interface Contract {
  id: string
  code: string // 合同编号
  name: string // 合同名称
  customerId: string
  company: string
  region: string
  city: string
  /** 国内 / 海外等业务归属 */
  geoSource?: "domestic" | "overseas" | "mestbo" | "manual"
  type: string // 合同类型
  signType: string // 签约类型
  /** 合同来源（标准选项） */
  source?: string
  status: ContractStatus
  /** 作废/终止原因（手填） */
  statusReason?: string
  projectStatus: ProjectStatus
  // 签约信息
  signSubject: string // 兼容旧数据的客户签约主体
  ourSignSubject?: string // 我方签约主体
  customerSignSubject?: string // 客户签约主体
  signerContactName?: string
  signerContactPhone?: string
  signerContactAddress?: string
  signerContactEmail?: string
  invoiceInfo?: string
  signer: string // 合同签订人
  owner: string // 兼容旧数据的销售负责人
  owners?: string[] // 销售负责人（多人）
  signerManager: string // 直属上级
  dept: string // 签约部门
  // 金额与周期
  amount: number
  effectiveDate: string
  dualSignDate: string
  validMonths: number
  endDate: string
  /** 合同/SOW 附件（支持真实文件元数据） */
  attachments: ContractAttachment[]
  opportunityId: string
  /** 销售在合同签署前申请项目经理提前介入；分配后即幂等创建待启动项目。 */
  projectManagerRequest?: {
    status: "pending" | "assigned"
    applicant: string
    appliedAt: string
    requestedStartDate?: string
    reason?: string
    projectManager?: string
    assignedBy?: string
    assignedAt?: string
  }
  createdAt: string
}

/** 合同附件：兼容旧 {id,name,kind}，并支持上传后的真实文件字段 */
export interface ContractAttachment {
  id: string
  name: string
  kind?: "contract" | "sow"
  size?: number
  uploadedAt?: string
  uploadedBy?: string
  url?: string
  contentType?: string
  storagePath?: string
  description?: string
}

export type PaymentStatus = "pending" | "partial" | "paid" | "overdue"
export type InvoiceStatus = "uninvoiced" | "invoiced"

export interface PaymentAttachment {
  id: string
  name: string
  size?: number
  url?: string
  contentType?: string
  storagePath?: string
  description?: string
}

/** 合同的一期回款计划；状态与未收金额由服务端计算。 */
export interface PaymentPlan {
  id: string
  contractId: string
  contractCode?: string
  contractName?: string
  contractAmount?: number
  company?: string
  salesOwner?: string
  periodIndex: number
  periodName: string
  plannedAmount: number
  plannedDate: string
  invoiceStatus: InvoiceStatus
  invoiceDate?: string
  invoiceAmount?: number | null
  invoiceAttachment?: PaymentAttachment | null
  actualPaymentDate?: string
  actualAmount: number
  receiptAttachment?: PaymentAttachment | null
  paymentStatus: PaymentStatus
  outstandingAmount: number
  createdBy?: string
  updatedBy?: string
  createdAt?: string
  updatedAt?: string
}

export interface CrmNotification {
  id: string
  targetName: string
  actor: string
  message: string
  href: string
  createdAt: string
  read: boolean
}

export function buildOpportunityName(
  customerLabel: string,
  subsidiaryLabel: string | undefined,
  projectTypes: string[],
  date = new Date().toISOString().slice(0, 10),
): string {
  const compact = (value: string) => value.replace(/(有限责任公司|股份有限公司|有限公司|科技|集团)/g, "").trim()
  const customer = compact(customerLabel) || "客户"
  const subsidiary = subsidiaryLabel ? compact(subsidiaryLabel) || "子公司" : "总部"
  const project = projectTypes.length ? projectTypes.join("+") : "待定项目"
  return `${customer}-${subsidiary}-${project}-${date.slice(0, 7).replace("-", "")}`
}

export function contractOwnerNames(contract: Contract): string[] {
  return contract.owners?.length ? contract.owners : contract.owner ? [contract.owner] : []
}

// ===== 工具 =====
export function money(n: number): string {
  if (!n) return "—"
  return `¥${n.toLocaleString("zh-CN")}`
}
export function wan(n: number): string {
  return `${(n / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万`
}

const GOAL_LABELS: Record<string, string> = {
  source: "来源率",
  recommend: "推荐率",
  top3: "前三推荐率",
  priority: "优先推荐率",
}
export function goalOrPlatform(goal: string, platform: string): string {
  const g = goal ? (GOAL_LABELS[goal] ?? goal) : ""
  const p = platform || ""
  if (g && p) return `${g} · ${p}`
  return g || p || "—"
}
