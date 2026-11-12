"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ROLE_META, useRole } from "@/modules/crm/hooks/use-crm-access"
import { LEAD_STATUS_META } from "@/modules/crm/lib/crm-data"
import { STATUS_META as REQUEST_STATUS_META } from "@/modules/requests/lib/status"
import { createAuditRecord, fetchAuditRecords } from "@/modules/audit/services/audit-api"
import { invalidateEntityAuditCache } from "@/modules/audit/lib/entity-audit-store"

export type AuditModule = "线索管理" | "公海池" | "客户管理" | "商机管理" | "合同管理" | "需求管理" | "项目" | "系统设置"

export interface AuditChange {
  field: string
  label: string
  before: string
  after: string
}

export interface AuditRecord {
  id: string
  module: AuditModule
  entityType: string
  entityId: string
  relatedEntityIds?: string[]
  entityName: string
  action: string
  actor: string
  timestamp: string
  changes: AuditChange[]
  /** lead = 线索转客户带入 */
  origin?: "lead" | "request"
}

export type AuditInput = Omit<AuditRecord, "id" | "actor" | "timestamp">

interface AuditContextValue {
  records: AuditRecord[]
  recordAudit: (input: AuditInput) => void
  refreshAudits: () => Promise<void>
}

const AuditContext = createContext<AuditContextValue | null>(null)

/** 审计字段中文标签：写入端生成 label，但服务端不持久化 label，
 *  读取端统一回退到本字典，保证历史记录与各模块展示一致。 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  companyName: "公司名称",
  claimStatus: "认领状态",
  applicant: "申请销售",
  releaseReason: "释放原因",
  reviewReason: "不通过原因",
  companyUid: "公司唯一 ID",
  brandName: "品牌名称",
  website: "官网",
  region: "区域",
  city: "城市",
  industryL1: "一级行业",
  industryL2: "二级行业",
  foundedDate: "成立时间",
  creditCode: "统一社会信用代码",
  registeredCapital: "注册资金",
  scale: "公司规模",
  nature: "企业性质",
  status: "状态",
  owner: "负责人",
  owners: "销售负责人",
  isKey: "重点客户",
  attachments: "附件",
  source: "来源",
  sourceDetail: "来源详情",
  nextFollowAt: "下次计划跟进",
  lastFollowAt: "最近跟进",
  sdrTransferDate: "SDR 转出日期",
  sdr: "SDR",
  contactName: "联系人",
  contactTitle: "联系人职位",
  contactPhone: "联系人电话",
  contactWechat: "联系人微信",
  contactDepartment: "联系人部门",
  email: "邮箱",
  level: "等级",
  sales: "分配销售",
  followState: "跟进状态",
  followType: "跟进方式",
  firstContactDate: "首次触达日期",
  transferDate: "转出日期",
  wechatAdded: "是否加企微",
  invalidReason: "无效原因",
  notes: "跟进内容",
  note: "跟进内容",
  data: "表单内容",
  attachment: "附件",
  opportunityId: "关联商机",
  sourceContractId: "来源合同",
  customer: "客户档案",
  contacts: "联系人",
  subsidiaries: "子公司",
  primaryContact: "主联系人",
  primaryContactId: "主联系人",
  advisorNotes: "顾问反馈",
  advisor: "售前顾问",
  customerSuccess: "客户成功",
  geoSource: "业务归属",
  goal: "优化目标",
  platform: "平台",
  isPrimary: "主联系人",
  active: "有效状态",
  author: "跟进人",
  sourceLeadId: "来源线索",
  sourceRequestId: "来源需求",
  shortName: "简称",
  name: "名称",
  subsidiaryId: "二级公司 ID",
  subsidiaryName: "商机业务主体",
  projectTypes: "项目类型",
  period: "周期",
  amount: "金额",
  probability: "成交概率",
  expectedSignDate: "预计签约日期",
  stage: "商机阶段",
  stageReason: "变更原因",
  lostStage: "输单阶段",
  lostReasonL1: "输单一级原因",
  lostReasonL2: "输单二级原因",
  lostReason: "输单原因",
  competitor: "竞争对手",
  code: "编号",
  type: "类型",
  signType: "签约类型",
  projectStatus: "项目状态",
  statusReason: "作废/终止原因",
  ourSignSubject: "我方签约主体",
  customerSignSubject: "客户签约主体",
  signer: "合同签订人",
  signerManager: "直属上级",
  dept: "部门",
  effectiveDate: "生效日期",
  dualSignDate: "双方签署日期",
  validMonths: "有效期",
  endDate: "到期日期",
  role: "角色",
  customerId: "客户",
  signSubject: "客户签约主体（旧字段）",
  requestIds: "关联需求",
  company: "客户公司",
  linkedOppStage: "关联商机阶段",
  stageHistory: "阶段历史",
}

/** 审计变更项展示标签：字段字典优先，其次写入端标签，最后回退字段名。 */
export function auditFieldLabel(field: string, fallback = ""): string {
  return AUDIT_FIELD_LABELS[field] || fallback || field
}

/** 审计变更值展示：需求状态等枚举值转中文，兼容历史记录中直接存的英文状态码。 */
export function auditChangeValue(
  module: string,
  change: AuditChange,
  value: string,
): string {
  const v = (value || "").trim()
  if (!v || v === "—") return value
  if (change.field === "status" && module === "需求管理") {
    return REQUEST_STATUS_META[v as keyof typeof REQUEST_STATUS_META]?.label || value
  }
  if (change.field === "status" && module === "线索管理") {
    return LEAD_STATUS_META[v as keyof typeof LEAD_STATUS_META]?.label || value
  }
  return value
}

/** 审计动作/模块/实体类型展示文案：兼容历史数据中未中文化的值。 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "project.created": "自动创建项目",
}
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  projects: "项目",
}
export const AUDIT_ENTITY_TYPE_LABELS: Record<string, string> = {
  project: "项目",
  lead: "线索",
  contact: "联系人",
  customer: "客户",
  opportunity: "商机",
  contract: "合同",
  request: "需求",
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action
}

export function auditModuleLabel(module: string): string {
  return AUDIT_MODULE_LABELS[module] || module
}

export function auditEntityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABELS[entityType] || entityType
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "boolean") return value ? "是" : "否"
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join("、") : "—"
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value)
      return text.length > 180 ? `${text.slice(0, 180)}…` : text
    } catch {
      return "[复杂数据]"
    }
  }
  return String(value)
}

export function diffAuditChanges(before: Record<string, unknown> | undefined, patch: Record<string, unknown>): AuditChange[] {
  return Object.entries(patch)
    .filter(([key, after]) => key !== "updatedAt" && displayValue(before?.[key]) !== displayValue(after))
    .map(([field, after]) => ({
      field,
      label: auditFieldLabel(field),
      before: displayValue(before?.[field]),
      after: displayValue(after),
    }))
}

export function auditChange(field: string, before: unknown, after: unknown, label?: string): AuditChange {
  return { field, label: auditFieldLabel(field, label), before: displayValue(before), after: displayValue(after) }
}

function formatLocalTimestamp(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const { role, identity, dataScope } = useRole()
  const [records, setRecords] = useState<AuditRecord[]>([])

  const actor = identity.name || ROLE_META[role]?.label || String(role)

  const refreshAudits = useCallback(async () => {
    // 全局审计列表仅 all 范围；own/department 请按实体拉取
    if (dataScope !== "all") {
      setRecords([])
      return
    }
    const items = await fetchAuditRecords({ limit: 500 })
    setRecords(items)
  }, [dataScope])

  useEffect(() => {
    let cancelled = false
    if (dataScope !== "all") {
      setRecords([])
      return () => {
        cancelled = true
      }
    }
    void fetchAuditRecords({ limit: 500 })
      .then((items) => {
        if (!cancelled) setRecords(items)
      })
      .catch(() => {
        if (!cancelled) setRecords([])
      })
    return () => {
      cancelled = true
    }
  }, [dataScope])

  const recordAudit = useCallback(
    (input: AuditInput) => {
      if (input.changes.length === 0) return
      const optimistic: AuditRecord = {
        ...input,
        id: `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        actor,
        timestamp: formatLocalTimestamp(),
      }
      setRecords((prev) => [optimistic, ...prev].slice(0, 500))
      void createAuditRecord({
        ...input,
        id: optimistic.id,
        actor: optimistic.actor,
        timestamp: optimistic.timestamp,
      })
        .then((saved) => {
          setRecords((prev) => {
            const withoutTemp = prev.filter((item) => item.id !== optimistic.id)
            return [saved, ...withoutTemp].slice(0, 500)
          })
          invalidateEntityAuditCache(saved.entityId, ...(saved.relatedEntityIds ?? []))
        })
        .catch(() => {
          setRecords((prev) => prev.filter((item) => item.id !== optimistic.id))
        })
    },
    [actor],
  )

  const value = useMemo(
    () => ({ records, recordAudit, refreshAudits }),
    [records, recordAudit, refreshAudits],
  )
  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>
}

export function useAudit() {
  const context = useContext(AuditContext)
  if (!context) throw new Error("useAudit must be used within AuditProvider")
  return context
}
