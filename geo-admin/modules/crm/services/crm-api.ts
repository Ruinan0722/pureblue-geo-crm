import type { Contract, Customer, Lead, Opportunity, PaymentPlan, SalesCoverage } from "@/modules/crm/lib/crm-data"
import { parseApiErrorDetail, parseApiErrorMessage } from "@/shared/lib/parse-api-error"

export type LeadStats = {
  total: number
  today: number
  untouched: number
  touched: number
  converted: number
  invalid: number
}

export const EMPTY_LEAD_STATS: LeadStats = {
  total: 0,
  today: 0,
  untouched: 0,
  touched: 0,
  converted: 0,
  invalid: 0,
}

export type CustomerStats = {
  total: number
  cooperating: number
  awaitingContact?: number
  awaiting_contact?: number
  connected?: number
  opportunityFollowing?: number
  opportunity_following?: number
  stopped?: number
  following: number
  potential: number
  lost: number
  key: number
}

export const EMPTY_CUSTOMER_STATS: CustomerStats = {
  total: 0,
  cooperating: 0,
  awaitingContact: 0,
  connected: 0,
  opportunityFollowing: 0,
  stopped: 0,
  following: 0,
  potential: 0,
  lost: 0,
  key: 0,
}

export type CrmBootstrap = {
  leads: Lead[]
  customers: Customer[]
  opportunities: Opportunity[]
  contracts: Contract[]
  leadStats?: LeadStats
  customerStats?: CustomerStats
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

async function requestJson<T>(url: string, init?: RequestInit, fallback = "请求失败"): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(await readError(res, fallback))
  return res.json() as Promise<T>
}

export type LeadSourceOption = {
  id: string
  primarySource: string
  startDate: string | null
  name: string
  organizer: string | null
  displayName: string
  enabled: boolean
  sortOrder: number
  updatedAt: string
}

export async function fetchLeadSourceOptions(filters?: {
  includeDisabled?: boolean
  primarySource?: string
  meetingName?: string
  organizer?: string
  startDate?: string
}): Promise<LeadSourceOption[]> {
  const params = new URLSearchParams()
  if (filters?.includeDisabled) params.set("includeDisabled", "true")
  if (filters?.primarySource) params.set("primarySource", filters.primarySource)
  if (filters?.meetingName?.trim()) params.set("meetingName", filters.meetingName.trim())
  if (filters?.organizer?.trim()) params.set("organizer", filters.organizer.trim())
  if (filters?.startDate) params.set("startDate", filters.startDate)
  const query = params.toString()
  const data = await requestJson<{ items: LeadSourceOption[] }>(
    `/api/lead-source-options${query ? `?${query}` : ""}`,
    undefined,
    "加载二级来源失败",
  )
  return data.items ?? []
}

export async function createLeadSourceOption(input: {
  primarySource: string
  startDate?: string
  name: string
  organizer?: string
  sortOrder?: number
}): Promise<LeadSourceOption> {
  return requestJson("/api/lead-source-options", {
    method: "POST",
    body: JSON.stringify(input),
  }, "新增二级来源失败")
}

export async function updateLeadSourceOption(
  id: string,
  input: { name?: string; enabled?: boolean; sortOrder?: number },
): Promise<LeadSourceOption> {
  return requestJson(`/api/lead-source-options/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }, "更新二级来源失败")
}

export async function deleteLeadSourceOption(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/lead-source-options/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) throw new Error(await readError(res, "删除二级来源失败"))
}

export async function fetchCrmBootstrap(): Promise<CrmBootstrap> {
  const data = await requestJson<
    CrmBootstrap & { lead_stats?: LeadStats; customer_stats?: CustomerStats }
  >("/api/crm/bootstrap", undefined, "加载 CRM 数据失败")
  return {
    ...data,
    leads: data.leads ?? [],
    customers: data.customers ?? [],
    opportunities: data.opportunities ?? [],
    contracts: data.contracts ?? [],
    leadStats: data.leadStats ?? data.lead_stats ?? EMPTY_LEAD_STATS,
    customerStats: data.customerStats ?? data.customer_stats ?? EMPTY_CUSTOMER_STATS,
  }
}

export async function fetchOpportunities(): Promise<Opportunity[]> {
  return requestJson<Opportunity[]>("/api/opportunities", undefined, "加载商机失败")
}

export async function fetchOpportunityById(id: string): Promise<Opportunity> {
  return requestJson<Opportunity>(
    `/api/opportunities/${encodeURIComponent(id)}`,
    undefined,
    "加载商机详情失败",
  )
}

export async function fetchContracts(): Promise<Contract[]> {
  return requestJson<Contract[]>("/api/contracts", undefined, "加载合同失败")
}

export async function fetchContractById(
  id: string,
): Promise<Contract & { _updatedOpportunity?: Opportunity }> {
  return requestJson(
    `/api/contracts/${encodeURIComponent(id)}`,
    undefined,
    "加载合同详情失败",
  )
}

export async function fetchPaymentPlans(contractId?: string): Promise<PaymentPlan[]> {
  const url = contractId
    ? `/api/contracts/${encodeURIComponent(contractId)}/payment-plans`
    : "/api/payment-plans"
  return requestJson<PaymentPlan[]>(url, undefined, "加载回款计划失败")
}

export type PaymentPlanInput = {
  periodIndex?: number
  periodName?: string
  plannedAmount?: number
  plannedDate?: string
  invoiceStatus?: PaymentPlan["invoiceStatus"]
  invoiceDate?: string | null
  invoiceAmount?: number | null
  invoiceAttachment?: PaymentPlan["invoiceAttachment"]
  actualPaymentDate?: string | null
  actualAmount?: number
  receiptAttachment?: PaymentPlan["receiptAttachment"]
}

export async function createPaymentPlan(contractId: string, input: PaymentPlanInput): Promise<PaymentPlan> {
  return requestJson(`/api/contracts/${encodeURIComponent(contractId)}/payment-plans`, {
    method: "POST",
    body: JSON.stringify(input),
  }, "新增回款计划失败")
}

export async function updatePaymentPlan(id: string, input: PaymentPlanInput): Promise<PaymentPlan> {
  return requestJson(`/api/payment-plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }, "更新回款计划失败")
}

export async function deletePaymentPlan(id: string): Promise<void> {
  const res = await fetch(`/api/payment-plans/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) throw new Error(await readError(res, "删除回款计划失败"))
}

export type WorkbenchStats = {
  leadsTotal: number
  leadsNeed: number
  leadsUntouched: number
  leadsToTransfer: number
  leadsConverted: number
  leadsInvalid: number
  leadRate: number
  customersTotal: number
  customersActive: number
  customersStale: number
  customersCooperating: number
  oppsTotal: number
  oppsActive: number
  oppsFollowDue: number
  oppsStale: number
  oppsLostNoReason: number
  oppsSigning: number
  oppsWon: number
  oppsLost: number
  monthExpected: number
  wonAmount: number
  reqPending: number
  reqSupplement: number
  reqConfirmed: number
  signingContracts: number
  signedContracts: number
  contractsTotal: number
  contractsPending: number
  contractAmount: number
  projectsTotal: number
  projectsActive: number
  projectsDelayed: number
  projectsRenewalWarning: number
  projectsUnhealthy: number
  projectsCompleted: number
}

export const EMPTY_WORKBENCH_STATS: WorkbenchStats = {
  leadsTotal: 0,
  leadsNeed: 0,
  leadsUntouched: 0,
  leadsToTransfer: 0,
  leadsConverted: 0,
  leadsInvalid: 0,
  leadRate: 0,
  customersTotal: 0,
  customersActive: 0,
  customersStale: 0,
  customersCooperating: 0,
  oppsTotal: 0,
  oppsActive: 0,
  oppsFollowDue: 0,
  oppsStale: 0,
  oppsLostNoReason: 0,
  oppsSigning: 0,
  oppsWon: 0,
  oppsLost: 0,
  monthExpected: 0,
  wonAmount: 0,
  reqPending: 0,
  reqSupplement: 0,
  reqConfirmed: 0,
  signingContracts: 0,
  signedContracts: 0,
  contractsTotal: 0,
  contractsPending: 0,
  contractAmount: 0,
  projectsTotal: 0,
  projectsActive: 0,
  projectsDelayed: 0,
  projectsRenewalWarning: 0,
  projectsUnhealthy: 0,
  projectsCompleted: 0,
}

export async function fetchWorkbenchStats(): Promise<WorkbenchStats> {
  const data = await requestJson<WorkbenchStats & Record<string, number>>(
    "/api/crm/workbench",
    undefined,
    "加载工作台数据失败",
  )
  return {
    leadsTotal: Number(data.leadsTotal ?? data.leads_total ?? 0),
    leadsNeed: Number(data.leadsNeed ?? data.leads_need ?? 0),
    leadsUntouched: Number(data.leadsUntouched ?? data.leads_untouched ?? 0),
    leadsToTransfer: Number(data.leadsToTransfer ?? data.leads_to_transfer ?? 0),
    leadsConverted: Number(data.leadsConverted ?? data.leads_converted ?? 0),
    leadsInvalid: Number(data.leadsInvalid ?? data.leads_invalid ?? 0),
    leadRate: Number(data.leadRate ?? data.lead_rate ?? 0),
    customersTotal: Number(data.customersTotal ?? data.customers_total ?? 0),
    customersActive: Number(data.customersActive ?? data.customers_active ?? 0),
    customersStale: Number(data.customersStale ?? data.customers_stale ?? 0),
    customersCooperating: Number(data.customersCooperating ?? data.customers_cooperating ?? 0),
    oppsTotal: Number(data.oppsTotal ?? data.opps_total ?? 0),
    oppsActive: Number(data.oppsActive ?? data.opps_active ?? 0),
    oppsFollowDue: Number(data.oppsFollowDue ?? data.opps_follow_due ?? 0),
    oppsStale: Number(data.oppsStale ?? data.opps_stale ?? 0),
    oppsLostNoReason: Number(data.oppsLostNoReason ?? data.opps_lost_no_reason ?? 0),
    oppsSigning: Number(data.oppsSigning ?? data.opps_signing ?? 0),
    oppsWon: Number(data.oppsWon ?? data.opps_won ?? 0),
    oppsLost: Number(data.oppsLost ?? data.opps_lost ?? 0),
    monthExpected: Number(data.monthExpected ?? data.month_expected ?? 0),
    wonAmount: Number(data.wonAmount ?? data.won_amount ?? 0),
    reqPending: Number(data.reqPending ?? data.req_pending ?? 0),
    reqSupplement: Number(data.reqSupplement ?? data.req_supplement ?? 0),
    reqConfirmed: Number(data.reqConfirmed ?? data.req_confirmed ?? 0),
    signingContracts: Number(data.signingContracts ?? data.signing_contracts ?? 0),
    signedContracts: Number(data.signedContracts ?? data.signed_contracts ?? 0),
    contractsTotal: Number(data.contractsTotal ?? data.contracts_total ?? 0),
    contractsPending: Number(data.contractsPending ?? data.contracts_pending ?? 0),
    contractAmount: Number(data.contractAmount ?? data.contract_amount ?? 0),
    projectsTotal: Number(data.projectsTotal ?? data.projects_total ?? 0),
    projectsActive: Number(data.projectsActive ?? data.projects_active ?? 0),
    projectsDelayed: Number(data.projectsDelayed ?? data.projects_delayed ?? 0),
    projectsRenewalWarning: Number(data.projectsRenewalWarning ?? data.projects_renewal_warning ?? 0),
    projectsUnhealthy: Number(data.projectsUnhealthy ?? data.projects_unhealthy ?? 0),
    projectsCompleted: Number(data.projectsCompleted ?? data.projects_completed ?? 0),
  }
}

export async function fetchLeadStats(): Promise<LeadStats> {
  const data = await requestJson<LeadStats & Record<string, number>>(
    "/api/leads/stats",
    undefined,
    "加载线索统计失败",
  )
  return {
    total: Number(data.total ?? 0),
    today: Number(data.today ?? 0),
    untouched: Number(data.untouched ?? 0),
    touched: Number(data.touched ?? 0),
    converted: Number(data.converted ?? 0),
    invalid: Number(data.invalid ?? 0),
  }
}

export type LeadListFilters = {
  name?: string
  contactName?: string
  sdr?: string
  sales?: string
  status?: string
  source?: string
  sourceDetail?: string
  level?: string
  region?: string
  firstContactFrom?: string
  firstContactTo?: string
  transferFrom?: string
  transferTo?: string
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
}

export type LeadListResult = {
  items: Lead[]
  total: number
  page: number
  pageSize: number
}

function buildLeadQuery(filters: LeadListFilters = {}): string {
  const params = new URLSearchParams()
  const entries: [string, string | undefined][] = [
    ["name", filters.name],
    ["contactName", filters.contactName],
    ["sdr", filters.sdr],
    ["sales", filters.sales],
    ["status", filters.status],
    ["source", filters.source],
    ["sourceDetail", filters.sourceDetail],
    ["level", filters.level],
    ["region", filters.region],
    ["firstContactFrom", filters.firstContactFrom],
    ["firstContactTo", filters.firstContactTo],
    ["transferFrom", filters.transferFrom],
    ["transferTo", filters.transferTo],
    ["createdFrom", filters.createdFrom],
    ["createdTo", filters.createdTo],
    ["page", filters.page != null ? String(filters.page) : undefined],
    ["pageSize", filters.pageSize != null ? String(filters.pageSize) : undefined],
  ]
  for (const [key, value] of entries) {
    const trimmed = (value || "").trim()
    if (trimmed) params.set(key, trimmed)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

/** 线索列表：条件由后端 MySQL 查询，前端不做业务过滤 */
export async function fetchLeads(filters: LeadListFilters = {}): Promise<LeadListResult> {
  const data = await requestJson<
    (LeadListResult & { page_size?: number }) | Lead[]
  >(`/api/leads${buildLeadQuery(filters)}`, undefined, "加载线索列表失败")
  // 兼容旧版接口：直接返回 Lead[]
  if (Array.isArray(data)) {
    return {
      items: data,
      total: data.length,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? data.length,
    }
  }
  const pageSize = Number(data.pageSize ?? data.page_size ?? filters.pageSize ?? 10)
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total ?? 0),
    page: Number(data.page ?? filters.page ?? 1),
    pageSize,
  }
}

const leadByIdInflight = new Map<string, Promise<Lead>>()

/** Strict Mode / 并发挂载时合并同 key 的进行中请求 */
function shareInflight<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = map.get(key)
  if (existing) return existing
  const task = run().finally(() => {
    if (map.get(key) === task) map.delete(key)
  })
  map.set(key, task)
  return task
}

export async function fetchLeadById(id: string): Promise<Lead> {
  return shareInflight(leadByIdInflight, id, () =>
    requestJson<Lead>(`/api/leads/${encodeURIComponent(id)}`, undefined, "加载线索详情失败"),
  )
}

export async function retryMarkMaterial(fileId: string): Promise<{ fileId: string; status: string }> {
  return requestJson(
    `/api/crm/mark-materials/${encodeURIComponent(fileId)}/retry`,
    { method: "POST", body: "{}" },
    "重新下载 Mark 材料失败",
  )
}

export async function createLeadDocument(document: Lead): Promise<Lead> {
  return requestJson<Lead>(
    "/api/leads",
    { method: "POST", body: JSON.stringify({ document }) },
    "创建线索失败",
  )
}

export async function createCustomerContactLead(
  customerId: string,
  document: Partial<Lead> & { contactStatus?: string },
): Promise<{ lead: Lead; customer: Customer }> {
  return requestJson(
    `/api/customers/${encodeURIComponent(customerId)}/contacts`,
    { method: "POST", body: JSON.stringify({ document }) },
    "添加联系人失败",
  )
}

export async function updateLeadDocument(id: string, document: Partial<Lead>): Promise<Lead> {
  return requestJson<Lead>(
    `/api/leads/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ document }) },
    "更新线索失败",
  )
}

export async function convertLeadDocument(
  id: string,
  options: { mode?: "create" | "link"; customerId?: string; sales?: string } = {},
): Promise<{ lead: Lead; customer: Customer }> {
  const mode = options.mode || "create"
  const res = await fetch(`/api/leads/${encodeURIComponent(id)}/convert`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      customerId: options.customerId || null,
      sales: options.sales || null,
    }),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    const detail = parseApiErrorDetail(body) || {}
    const candidates = Array.isArray(detail.candidates)
      ? (detail.candidates as ConvertCandidate[]).map(normalizeConvertCandidate)
      : []
    throw new CompanyConflictError(
      parseApiErrorMessage(body, "该公司已存在客户档案"),
      candidates,
      Number(detail.hiddenMatchCount ?? 0),
    )
  }
  if (!res.ok) throw new Error(await readError(res, "线索转客户失败"))
  return res.json() as Promise<{ lead: Lead; customer: Customer }>
}

export class CompanyConflictError extends Error {
  candidates: ConvertCandidate[]
  hiddenMatchCount: number
  constructor(message: string, candidates: ConvertCandidate[], hiddenMatchCount: number) {
    super(message)
    this.name = "CompanyConflictError"
    this.candidates = candidates
    this.hiddenMatchCount = hiddenMatchCount
  }
}

export type ConvertCandidate = {
  id: string
  companyName: string
  brandName?: string
  owner?: string
  region?: string
  city?: string
  creditCode?: string
  status?: string
  /** credit/exact 强制挂靠；partial 仅软提示；缺省按 exact 兼容旧接口 */
  matchType?: "credit" | "exact" | "partial"
}

export type ConvertCandidatesResult = {
  items: ConvertCandidate[]
  hiddenMatchCount: number
  companyName: string
  creditCode: string
}

const convertCandidatesInflight = new Map<string, Promise<ConvertCandidatesResult>>()

export async function fetchConvertCandidates(leadId: string): Promise<ConvertCandidatesResult> {
  return shareInflight(convertCandidatesInflight, leadId, async () => {
    const data = await requestJson<
      ConvertCandidatesResult & { hidden_match_count?: number; company_name?: string; credit_code?: string }
    >(`/api/leads/${encodeURIComponent(leadId)}/convert-candidates`, undefined, "加载同名客户失败")
    return {
      items: (data.items ?? []).map(normalizeConvertCandidate),
      hiddenMatchCount: Number(data.hiddenMatchCount ?? data.hidden_match_count ?? 0),
      companyName: data.companyName ?? data.company_name ?? "",
      creditCode: data.creditCode ?? data.credit_code ?? "",
    }
  })
}

function normalizeConvertCandidate(raw: ConvertCandidate & { match_type?: string }): ConvertCandidate {
  const mt = raw.matchType ?? raw.match_type
  const matchType =
    mt === "credit" || mt === "exact" || mt === "partial" ? mt : undefined
  return {
    id: raw.id,
    companyName: raw.companyName,
    brandName: raw.brandName,
    owner: raw.owner,
    region: raw.region,
    city: raw.city,
    creditCode: raw.creditCode,
    status: raw.status,
    matchType,
  }
}

export type CustomerListFilters = {
  companyName?: string
  brandName?: string
  owner?: string
  status?: string
  industry?: string
  industryL2?: string
  region?: string
  creditCode?: string
  keyOnly?: boolean
  lastFollowFrom?: string
  lastFollowTo?: string
  nextFollowFrom?: string
  nextFollowTo?: string
  relation?: "opp" | "contract" | "none"
  mineOnly?: boolean
  /** Leader：managed（默认）| self（只看自己） */
  coverageScope?: "self" | "managed"
  page?: number
  pageSize?: number
}

export type CustomerListResult = {
  items: Customer[]
  total: number
  page: number
  pageSize: number
}

function buildCustomerQuery(filters: CustomerListFilters = {}): string {
  const params = new URLSearchParams()
  const entries: [string, string | undefined][] = [
    ["companyName", filters.companyName],
    ["brandName", filters.brandName],
    ["owner", filters.owner],
    ["status", filters.status && filters.status !== "all" ? filters.status : undefined],
    ["industry", filters.industry && filters.industry !== "all" ? filters.industry : undefined],
    ["industryL2", filters.industryL2 && filters.industryL2 !== "all" ? filters.industryL2 : undefined],
    ["region", filters.region && filters.region !== "all" ? filters.region : undefined],
    ["creditCode", filters.creditCode],
    ["keyOnly", filters.keyOnly ? "true" : undefined],
    ["lastFollowFrom", filters.lastFollowFrom],
    ["lastFollowTo", filters.lastFollowTo],
    ["nextFollowFrom", filters.nextFollowFrom],
    ["nextFollowTo", filters.nextFollowTo],
    ["relation", filters.relation],
    ["mineOnly", filters.mineOnly ? "true" : undefined],
    ["coverageScope", filters.coverageScope],
    ["page", filters.page != null ? String(filters.page) : undefined],
    ["pageSize", filters.pageSize != null ? String(filters.pageSize) : undefined],
  ]
  for (const [key, value] of entries) {
    const trimmed = (value || "").trim()
    if (trimmed) params.set(key, trimmed)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export async function fetchCustomers(filters: CustomerListFilters = {}): Promise<CustomerListResult> {
  const data = await requestJson<
    (CustomerListResult & { page_size?: number }) | Customer[]
  >(`/api/customers${buildCustomerQuery(filters)}`, undefined, "加载客户列表失败")
  if (Array.isArray(data)) {
    return {
      items: data,
      total: data.length,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? data.length,
    }
  }
  const pageSize = Number(data.pageSize ?? data.page_size ?? filters.pageSize ?? 10)
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total ?? 0),
    page: Number(data.page ?? filters.page ?? 1),
    pageSize,
  }
}

export async function fetchCustomerById(
  id: string,
  opts?: { coverageScope?: "self" | "managed" },
): Promise<Customer> {
  const qs = opts?.coverageScope ? `?coverageScope=${encodeURIComponent(opts.coverageScope)}` : ""
  return requestJson<Customer>(
    `/api/customers/${encodeURIComponent(id)}${qs}`,
    undefined,
    "加载客户详情失败",
  )
}

export async function fetchCustomerStats(opts?: {
  mineOnly?: boolean
  coverageScope?: "self" | "managed"
}): Promise<CustomerStats> {
  const params = new URLSearchParams()
  if (opts?.mineOnly) params.set("mineOnly", "true")
  if (opts?.coverageScope) params.set("coverageScope", opts.coverageScope)
  const qs = params.toString() ? `?${params.toString()}` : ""
  const data = await requestJson<CustomerStats & Record<string, number>>(
    `/api/customers/stats${qs}`,
    undefined,
    "加载客户统计失败",
  )
  return {
    total: Number(data.total ?? 0),
    cooperating: Number(data.cooperating ?? 0),
    awaitingContact: Number(data.awaitingContact ?? data.awaiting_contact ?? 0),
    connected: Number(data.connected ?? 0),
    opportunityFollowing: Number(data.opportunityFollowing ?? data.opportunity_following ?? 0),
    stopped: Number(data.stopped ?? 0),
    following: Number(data.following ?? 0),
    potential: Number(data.potential ?? 0),
    lost: Number(data.lost ?? 0),
    key: Number(data.key ?? 0),
  }
}

export async function createCustomerDocument(document: Customer): Promise<Customer> {
  const res = await fetch("/api/customers", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document }),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    const detail = parseApiErrorDetail(body) || {}
    const candidates = Array.isArray(detail.candidates)
      ? (detail.candidates as ConvertCandidate[]).map(normalizeConvertCandidate)
      : []
    throw new CompanyConflictError(
      parseApiErrorMessage(body, "该公司已存在客户档案"),
      candidates,
      Number(detail.hiddenMatchCount ?? 0),
    )
  }
  if (!res.ok) throw new Error(await readError(res, "创建客户失败"))
  return res.json() as Promise<Customer>
}

/** 自拓建档查重：与「生成客户」一致的主档全局候选（credit/exact/partial）。 */
export async function fetchCustomerCreateCandidates(
  companyName: string,
  creditCode = "",
): Promise<{ items: ConvertCandidate[]; hiddenMatchCount: number }> {
  const qs = new URLSearchParams()
  if (companyName.trim()) qs.set("companyName", companyName.trim())
  if (creditCode.trim()) qs.set("creditCode", creditCode.trim())
  const query = qs.size ? `?${qs.toString()}` : ""
  const data = await requestJson<{ items: ConvertCandidate[]; hiddenMatchCount: number }>(
    `/api/customers/duplicate-check${query}`,
    undefined,
    "查重失败",
  )
  return {
    items: (data.items ?? []).map(normalizeConvertCandidate),
    hiddenMatchCount: Number(data.hiddenMatchCount ?? 0),
  }
}

/** 主档写：仅允许主档字段子集（池字段已被 provider 拆到 /coverages/:id 定向写）。 */
export async function updateCustomerDocument(id: string, document: Partial<Customer>): Promise<Customer> {
  return requestJson<Customer>(
    `/api/customers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ document }) },
    "更新客户失败",
  )
}

export async function releaseCustomerToPublicPool(
  customerId: string,
  input: { reason: string; coverageId?: string },
): Promise<{ id: string; customerId: string; status: string }> {
  return requestJson(
    `/api/customers/${encodeURIComponent(customerId)}/release-to-public-pool`,
    { method: "POST", body: JSON.stringify(input) },
    "释放客户至公海失败",
  )
}

export async function createCustomerCoverage(
  customerId: string,
  document: Record<string, unknown> = {},
): Promise<SalesCoverage> {
  return requestJson(
    `/api/customers/${encodeURIComponent(customerId)}/coverages`,
    { method: "POST", body: JSON.stringify({ document }) },
    "建立对接池失败",
  )
}

export async function updateCoverageDocument(
  coverageId: string,
  document: Record<string, unknown>,
): Promise<SalesCoverage> {
  return requestJson(
    `/api/coverages/${encodeURIComponent(coverageId)}`,
    { method: "PATCH", body: JSON.stringify({ document }) },
    "更新对接池失败",
  )
}

/** 客户详情联系人：Leader/运营/管理员改派联系人成员归属（池间移动） */
export async function transferCustomerContact(
  customerId: string,
  contactId: string,
  targetOwnerName: string,
): Promise<SalesCoverage> {
  return requestJson(
    `/api/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}/transfer`,
    { method: "POST", body: JSON.stringify({ targetOwnerName }) },
    "改派联系人失败",
  )
}

export type AssignableContactOwner = { id: string; name: string }

/** 改派联系人归属的可选成员：服务端按可指派集合下发（前端不自行拼目录） */
export async function fetchAssignableContactOwners(
  customerId: string,
): Promise<AssignableContactOwner[]> {
  const data = await requestJson<{ items?: AssignableContactOwner[] }>(
    `/api/customers/${encodeURIComponent(customerId)}/assignable-contact-owners`,
    undefined,
    "加载可指派成员失败",
  )
  return data.items ?? []
}

export type BatchAssignCustomerOwnerItem = {
  customerId: string
  companyName?: string
  reason?: string
}

export type BatchAssignCustomerOwnerResult = {
  owner: string
  succeeded: BatchAssignCustomerOwnerItem[]
  failed: BatchAssignCustomerOwnerItem[]
}

/** 客户列表：批量指定销售负责人 */
export async function batchAssignCustomerOwner(
  customerIds: string[],
  owner: string,
): Promise<BatchAssignCustomerOwnerResult> {
  return requestJson<BatchAssignCustomerOwnerResult>(
    "/api/customers/batch-assign-owner",
    {
      method: "POST",
      body: JSON.stringify({ customerIds, owner }),
    },
    "批量分配负责人失败",
  )
}

export async function createOpportunityDocument(document: Opportunity): Promise<Opportunity> {
  return requestJson<Opportunity>(
    "/api/opportunities",
    { method: "POST", body: JSON.stringify({ document }) },
    "创建商机失败",
  )
}

export async function updateOpportunityDocument(
  id: string,
  document: Partial<Opportunity>,
): Promise<Opportunity & { _createdContract?: Contract }> {
  return requestJson(
    `/api/opportunities/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ document }) },
    "更新商机失败",
  )
}

export async function createContractDocument(
  document: Contract,
): Promise<Contract & { _updatedOpportunity?: Opportunity }> {
  return requestJson(
    "/api/contracts",
    { method: "POST", body: JSON.stringify({ document }) },
    "创建合同失败",
  )
}

export async function updateContractDocument(
  id: string,
  document: Partial<Contract>,
): Promise<Contract & { _updatedOpportunity?: Opportunity }> {
  return requestJson(
    `/api/contracts/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ document }) },
    "更新合同失败",
  )
}
