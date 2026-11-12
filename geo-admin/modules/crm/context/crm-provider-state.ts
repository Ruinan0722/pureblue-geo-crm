/**
 * CRM Provider 纯工具函数（从 crm-provider.tsx 拆出，无 React 状态）。
 */
import { chinaDateISO } from "@/shared/lib/datetime"
import {
  coerceCustomerStatus,
  normalizeOppStage,
  type Contact,
  type CrmAttachment,
  type Customer,
  type FollowUp,
  type Opportunity,
  type OppStage,
  type SalesCoverage,
} from "@/modules/crm/lib/crm-data"

export function nowDate() {
  // 与「今日新增」一致：按中国时区自然日，避免 UTC 跨日偏差
  return chinaDateISO()
}
export function nowStr() {
  return new Date().toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
}
export function rid(prefix: string) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`
}

/** 对接池经营字段：写操作拆分时走 /coverages/:id 定向写；owner 为双重语义（主档负责人 + 池归属名）归主档。 */
export const CUSTOMER_POOL_KEYS: ReadonlyArray<string> = [
  "contacts",
  "notes",
  "attachments",
  "status",
  "lastFollowAt",
  "nextFollowAt",
  "isKey",
]

/** 池字段（走 coverage 定向写）与主档字段（走 customer PATCH）拆包。 */
export function splitPoolKeys(
  patch: Partial<Customer>,
): { poolPatch: Partial<Customer>; masterPatch: Partial<Customer> } {
  const poolPatch: Record<string, unknown> = {}
  const masterPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (CUSTOMER_POOL_KEYS.includes(key)) {
      poolPatch[key] = value
    } else {
      masterPatch[key] = value
    }
  }
  return { poolPatch: poolPatch as Partial<Customer>, masterPatch: masterPatch as Partial<Customer> }
}

type OwnerStamped<T> = T & { coverageOwner?: string }

function stampOwner<T>(items: T[] | undefined, ownerName: string): Array<OwnerStamped<T>> {
  return (Array.isArray(items) ? items : []).map((item) => {
    const raw = item as OwnerStamped<T>
    return ownerName && !raw.coverageOwner ? { ...raw, coverageOwner: ownerName } : raw
  })
}

/**
 * 池定向写成功后，把更新的 coverage 合并回客户视图：
 * - coverages 数组替换该池
 * - contacts/notes/attachments 重算聚合（各池展平 + coverageOwner 归属标注）
 * - 经营标量以本人池为准（与后端 _compose_customer_view 对齐）
 * 读=聚合超集，写=定向子集——聚合视图绝不再整包回传。
 */
export function coverageToCustomerView(
  customer: Customer,
  updated: SalesCoverage,
): Customer {
  const coverages = (customer.coverages ?? []).map((cv) => (cv.id === updated.id ? updated : cv))
  const ownCoverage = coverages.find((cv) => cv.id === customer.myCoverageId)
  const primary = ownCoverage ?? coverages[0]
  return {
    ...customer,
    coverages,
    contacts: coverages.flatMap((cv) => stampOwner(cv.contacts, cv.ownerName)) as Contact[],
    notes: coverages.flatMap((cv) => stampOwner(cv.notes, cv.ownerName)) as FollowUp[],
    attachments: coverages.flatMap((cv) =>
      stampOwner(cv.attachments, cv.ownerName),
    ) as CrmAttachment[],
    status: coerceCustomerStatus(primary?.status),
    owner: primary?.ownerName ?? "",
    lastFollowAt: primary?.lastFollowAt ?? "",
    nextFollowAt: primary?.nextFollowAt ?? "",
    isKey: primary?.isKey ?? false,
  }
}

/** 写目标池：有 contactId 时先定位联系人所在池（管理员/Leader 改他人池联系人）；
 * 否则本人池 → 首个可见池。保证改动落在销售可见池，无幽灵改动。 */
export function resolveWriteCoverage(
  customer: Customer,
  contactId?: string,
): SalesCoverage | undefined {
  if (contactId) {
    const byContact = customer.coverages?.find((cv) =>
      (cv.contacts ?? []).some((c) => c.id === contactId),
    )
    if (byContact) return byContact
  }
  return (
    customer.coverages?.find((cv) => cv.id === customer.myCoverageId) ??
    customer.coverages?.[0]
  )
}

export const STAGE_FLOW: OppStage[] = [
  "contact",
  "demand_research",
  "demand_diagnosis",
  "solution_confirm",
  "business_negotiation",
  "bidding",
  "signing",
  "won",
]
export const LOST_STAGE_INDEX: Record<string, number> = {
  需求绑定: 0,
  初步接触: 0,
  需求调研: 1,
  需求确认: 2,
  需求诊断: 2,
  方案沟通: 3,
  方案确认: 3,
  报价谈判: 4,
  商务谈判: 4,
  招投标阶段: 5,
  签署中: 6,
}

function addDays(date: string, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}

export function hydrateOpportunity(opp: Opportunity): Opportunity {
  const requestIds: string[] = []
  const stage = normalizeOppStage(opp.stage)
  const normalizedHistory = (opp.stageHistory ?? []).map((item) => ({
    ...item,
    stage: normalizeOppStage(item.stage),
  }))
  if (normalizedHistory.length) {
    return { ...opp, stage, requestIds, stageHistory: normalizedHistory, attachments: opp.attachments ?? [] }
  }
  const endIndex = stage === "lost" ? (LOST_STAGE_INDEX[opp.lostStage || "初步接触"] ?? 0) : STAGE_FLOW.indexOf(stage)
  const stages = STAGE_FLOW.slice(0, Math.max(0, endIndex) + 1)
  const history = stages.map((s, index) => ({
    stage: s,
    enteredAt: addDays(opp.createdAt, index * 2),
    ...(index < stages.length - 1 || stage === "lost" ? { leftAt: addDays(opp.createdAt, (index + 1) * 2) } : {}),
  }))
  if (stage === "lost") history.push({ stage: "lost", enteredAt: addDays(opp.createdAt, stages.length * 2) })
  return { ...opp, stage, requestIds, stageHistory: history, attachments: opp.attachments ?? [] }
}

export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((row) => row.id === item.id)
  if (idx === -1) return [item, ...list]
  return list.map((row) => (row.id === item.id ? item : row))
}
