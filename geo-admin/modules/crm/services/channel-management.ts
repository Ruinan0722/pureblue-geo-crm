import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"

export type ChannelPartner = {
  ecosystemDepartment?: string | null
  id: string
  name: string
  partnerType?: "channel" | "strategic_ecosystem"
  brandName?: string | null
  customerType?: string | null
  customerSubtype?: string | null
  serviceContents?: string[]
  budgetAmount?: number | null
  bdUserIds?: string[]
  bdNames?: string[]
  primaryOpportunityId?: string | null
  projectStatus?: string | null
  expectedSignMonth?: string | null
  demandDescription?: string | null
  projectNotes?: string | null
  executionStatus?: string | null
  executionProduct?: string | null
  executionIntentCount?: number | null
  executionPlatformCount?: number | null
  executionPeriodMonths?: number | null
  executionEndDate?: string | null
  nextFollowAt?: string | null
  primaryContactName?: string | null
  channelType?: string | null
  cooperationType?: string | null
  signingMethod?: string | null
  source?: string | null
  sourceDetail?: string | null
  level?: string | null
  ownerUserId?: string | null
  ownerName?: string | null
  region?: string | null
  city?: string | null
  website?: string | null
  industries: string[]
  majorCustomers?: string | null
  teamSupport?: boolean | null
  agencyTypes: string[]
  cooperationProject?: string | null
  contractStatus: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export type ChannelContact = { id: string; name: string; phone?: string | null; title?: string | null; department?: string | null; contactType?: string | null; method?: string | null; isPrimary: boolean }
export type ChannelFollowUp = { id: string; followType?: string | null; contactName?: string | null; mentions?: string[]; contactId?: string | null; authorName: string; content: string; nextFollowAt?: string | null; createdAt: string }
export type ChannelOpportunity = { id: string; stageCode?: string; notes?: import("@/modules/crm/lib/crm-data").Opportunity["notes"]; advisorNotes?: import("@/modules/crm/lib/crm-data").Opportunity["advisorNotes"]; name: string; stage: string; ownerName?: string | null; lostReason?: string | null }
export type ChannelContractAttachment = { id: string; name: string; url: string; size?: number; contentType?: string; uploadedAt?: string; uploadedBy?: string; description?: string }
export type ChannelContract = {
  id: string; name: string; status: string; partnerType?: string; contractNumber?: string | null; opportunityId?: string | null; opportunityName?: string | null; signedAt?: string | null
  channelSubject?: string | null; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null
  region?: string | null; signingSubject?: string | null; signer?: string | null; projectStatus?: string | null
  effectiveDate?: string | null; doubleSignedDate?: string | null; termMonths?: number | null; endDate?: string | null
  createdAt?: string | null; updatedAt?: string | null; attachments?: ChannelContractAttachment[]
}
export type ChannelHistory = { id: string; actorName: string; action: string; detail?: string | null; createdAt: string }
export type ChannelOpportunityRow = ChannelOpportunity & { partnerId: string; partnerName: string; partnerType?: string; updatedAt: string }
export type ChannelContractRow = ChannelContract & { partnerId: string; partnerName: string; ownerUserId?: string | null; ownerName?: string | null }

async function channelRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const fallback = response.status === 401 ? "登录已过期，请重新登录。" : response.status === 403 ? "当前账号没有此操作权限。" : response.status === 404 ? "渠道数据不存在，或接口暂时不可用。" : "渠道管理请求失败，请稍后重试。"
    throw new Error(parseApiErrorMessage(body, fallback))
  }
  return response.json() as Promise<T>
}

export const fetchChannels = (partnerType: "channel" | "strategic_ecosystem" = "channel") => channelRequest<ChannelPartner[]>("/api/channels?partnerType=" + partnerType)
export const fetchChannel = (partnerId: string) => channelRequest<ChannelPartner>("/api/channels/" + encodeURIComponent(partnerId))
export const fetchAllChannelOpportunities = (partnerType: "channel" | "strategic_ecosystem" = "channel") => channelRequest<ChannelOpportunityRow[]>("/api/channels/opportunities?partnerType=" + partnerType)
export const fetchAllChannelContracts = (partnerType: "channel" | "strategic_ecosystem" = "channel") => channelRequest<ChannelContractRow[]>("/api/channels/contracts?partnerType=" + partnerType)
export const createChannel = (body: Record<string, unknown>) => channelRequest<ChannelPartner>("/api/channels", { method: "POST", body: JSON.stringify(body) })
export const fetchChannelResource = <T,>(partnerId: string, resource: "contacts" | "follow-ups" | "opportunities" | "contracts" | "history") =>
  channelRequest<T>(`/api/channels/${encodeURIComponent(partnerId)}/${resource}`)
export const createChannelResource = <T,>(partnerId: string, resource: "contacts" | "follow-ups" | "opportunities" | "contracts", body: Record<string, unknown>) =>
  channelRequest<T>(`/api/channels/${encodeURIComponent(partnerId)}/${resource}`, { method: "POST", body: JSON.stringify(body) })
export const updateChannel = (partnerId: string, body: Record<string, unknown>) =>
  channelRequest<ChannelPartner>(`/api/channels/${encodeURIComponent(partnerId)}`, { method: "PATCH", body: JSON.stringify(body) })
export const moveChannelOpportunity = (partnerId: string, opportunityId: string, body: { stage: string; lostReason?: string }) =>
  channelRequest<{ id: string; stage: string; lostReason?: string }>(`/api/channels/${encodeURIComponent(partnerId)}/opportunities/${encodeURIComponent(opportunityId)}/stage`, { method: "PATCH", body: JSON.stringify(body) })
export async function signChannelContract(partnerId: string, contractId: string) {
  const result = await channelRequest<{ id: string; status: string; projectCreated: false }>(`/api/channels/${encodeURIComponent(partnerId)}/contracts/${encodeURIComponent(contractId)}/sign`, { method: "PATCH" })
  publishChange(CHANNEL_OPPORTUNITIES_CHANGED)
  publishChange(CHANNEL_CONTRACTS_CHANGED)
  return result
}

export const fetchChannelContract = (id: string) => channelRequest<ChannelContractRow>("/api/channels/contracts/" + encodeURIComponent(id))
export const channelContractUrl = (id: string, partnerType?: string) => (partnerType === "strategic_ecosystem" ? "/contracts/ecosystems/" : "/contracts/channels/") + encodeURIComponent(id)
export const channelContractCreateUrl = (partnerId?: string, opportunityId?: string, partnerType?: string) => {
  const query = new URLSearchParams({ create: "1" })
  if (partnerId) query.set("partner", partnerId)
  if (opportunityId) query.set("opportunity", opportunityId)
  return (partnerType === "strategic_ecosystem" ? "/contracts/ecosystems?" : "/contracts/channels?") + query.toString()
}
export async function createChannelContract(partnerId: string, body: Record<string, unknown>) {
  const row = await createChannelResource<ChannelContractRow>(partnerId, "contracts", body)
  publishChange(CHANNEL_CONTRACTS_CHANGED)
  return row
}
export async function updateChannelContract(id: string, body: Record<string, unknown>) {
  const row = await channelRequest<ChannelContractRow>("/api/channels/contracts/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) })
  publishChange(CHANNEL_CONTRACTS_CHANGED)
  return row
}
export async function attachChannelContractFiles(id: string, attachments: { id: string; description: string }[]) {
  const row = await channelRequest<ChannelContractRow>(`/api/channels/contracts/${encodeURIComponent(id)}/attachments`, { method: "POST", body: JSON.stringify({ attachments }) })
  publishChange(CHANNEL_CONTRACTS_CHANGED)
  return row
}

export const CHANNEL_OPPORTUNITIES_CHANGED = "flow:channel-opportunities-changed"
export const CHANNEL_CONTRACTS_CHANGED = "flow:channel-contracts-changed"
const CHANNEL_CHANGE_SOURCE = Math.random().toString(36).slice(2)

export function publishChange(eventName: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(eventName))
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(eventName)
    channel.postMessage({ source: CHANNEL_CHANGE_SOURCE })
    channel.close()
  }
}

export function channelOpportunityUrl(opportunityId?: string, partnerType: "channel" | "strategic_ecosystem" = "channel") {
  return opportunityId ? "/opportunities/" + encodeURIComponent(opportunityId) : "/opportunities?businessType=" + partnerType
}

export async function generateChannelOpportunity(partnerId: string, name: string) {
  const opportunity = await createChannelResource<ChannelOpportunity>(partnerId, "opportunities", { name: name.trim() })
  publishChange(CHANNEL_OPPORTUNITIES_CHANGED)
  return opportunity
}

/** Channel details and opportunity management read the same record; notify open views after a successful write. */
export function subscribeChannelOpportunityChanges(onChange: () => void) {
  return subscribeChanges(CHANNEL_OPPORTUNITIES_CHANGED, onChange)
}

export function subscribeChannelContractChanges(onChange: () => void) {
  return subscribeChanges(CHANNEL_CONTRACTS_CHANGED, onChange)
}

function subscribeChanges(eventName: string, onChange: () => void) {
  if (typeof window === "undefined") return () => undefined
  window.addEventListener(eventName, onChange)
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(eventName) : null
  if (channel) channel.onmessage = (event: MessageEvent<{ source?: string }>) => { if (event.data?.source !== CHANNEL_CHANGE_SOURCE) onChange() }
  return () => {
    window.removeEventListener(eventName, onChange)
    channel?.close()
  }
}
