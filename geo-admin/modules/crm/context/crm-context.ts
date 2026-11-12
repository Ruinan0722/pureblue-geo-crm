"use client"

import { createContext, useContext } from "react"
import type {
  Contact,
  Contract,
  ContractAttachment,
  CrmAttachment,
  CrmNotification,
  Customer,
  FollowUp,
  Lead,
  Opportunity,
  OpportunityAttachment,
  OppStage,
  Subsidiary,
} from "@/modules/crm/lib/crm-data"
import type {
  CustomerListFilters,
  CustomerListResult,
  CustomerStats,
  LeadStats,
  LeadListFilters,
  LeadListResult,
} from "@/modules/crm/services/crm-api"

export interface CrmContextValue {
  leads: Lead[]
  customers: Customer[]
  opportunities: Opportunity[]
  contracts: Contract[]
  /** 线索顶部统计：由 MySQL 聚合接口返回，前端不自行计算 */
  leadStats: LeadStats
  /** 客户顶部统计：由 MySQL 聚合接口返回 */
  customerStats: CustomerStats
  /** 线索列表页当前结果集（由 searchLeads 写入，bootstrap 不再预载） */
  leadListTotal: number
  leadsListLoading: boolean
  searchLeads: (filters?: LeadListFilters) => Promise<LeadListResult>
  loadLeadById: (id: string) => Promise<Lead | undefined>
  /** 客户列表页当前结果集（由 searchCustomers 写入） */
  customerListTotal: number
  customersListLoading: boolean
  searchCustomers: (filters?: CustomerListFilters) => Promise<CustomerListResult>
  loadCustomerById: (id: string, opts?: { coverageScope?: "self" | "managed" }) => Promise<Customer | undefined>
  /** 用服务端返回的客户 document 覆盖本地缓存（新增联系人等写后立即刷新） */
  replaceCustomerFromServer: (customer: Customer) => void
  refreshCustomerStats: () => Promise<void>
  /** 进入商机板块时按需拉取全量商机（去重 inflight） */
  ensureOpportunitiesLoaded: () => Promise<void>
  /** 进入合同板块时按需拉取全量合同 */
  ensureContractsLoaded: () => Promise<void>
  opportunitiesLoading: boolean
  contractsLoading: boolean
  loadOpportunityById: (id: string) => Promise<Opportunity | undefined>
  loadContractById: (id: string) => Promise<Contract | undefined>
  notifications: CrmNotification[]
  loading: boolean
  refresh: () => Promise<void>
  refreshNotifications: () => Promise<void>
  refreshLeadStats: () => Promise<void>
  getLead: (id: string) => Lead | undefined
  getCustomer: (id: string) => Customer | undefined
  getOpportunity: (id: string) => Opportunity | undefined
  getContract: (id: string) => Contract | undefined
  createLead: (data: Partial<Lead>) => Promise<string>
  updateLead: (id: string, patch: Partial<Lead>) => Promise<void>
  addLeadNote: (
    id: string,
    content: string,
    wechatAdded: boolean,
    options?: { author?: string; mentions?: string[] },
  ) => Promise<void>
  addLeadAttachment: (
    id: string,
    file: Omit<CrmAttachment, "uploadedAt" | "origin" | "sourceLeadId" | "sourceLeadAttachmentId"> & {
      id: string
      uploadedAt?: string
    },
  ) => Promise<void>
  convertLeadToCustomer: (
    id: string,
    options?: { mode?: "create" | "link"; customerId?: string; sales?: string },
  ) => Promise<string>
  markLeadInvalid: (id: string, reason: string) => Promise<void>
  createCustomer: (
    data: Partial<Customer> & { companyName: string },
    contact?: Partial<Contact>,
  ) => Promise<string>
  updateCustomer: (id: string, patch: Partial<Customer>) => Promise<void>
  /** 批量改负责人后，同步列表缓存中的 owner 字段 */
  applyCustomerOwnerLocally: (ids: string[], owner: string) => void
  addCustomerNote: (
    id: string,
    content: string,
    options?: { author?: string; mentions?: string[]; nextFollowAt?: string; followType?: FollowUp["followType"]; contactId?: string; contactName?: string },
  ) => Promise<void>
  addCustomerAttachment: (
    id: string,
    file: Omit<CrmAttachment, "uploadedAt" | "origin" | "sourceLeadId" | "sourceLeadAttachmentId"> & {
      id: string
      uploadedAt?: string
    },
  ) => Promise<void>
  addSubsidiary: (customerId: string, subsidiary: Omit<Subsidiary, "id">) => Promise<void>
  addContact: (customerId: string, contact: Omit<Contact, "id">) => Promise<void>
  updateContact: (customerId: string, contactId: string, patch: Partial<Contact>) => Promise<void>
  setPrimaryContact: (customerId: string, contactId: string) => Promise<void>
  /** Leader/运营/管理员：改派联系人成员归属（池间移动） */
  transferContact: (customerId: string, contactId: string, targetOwnerName: string) => Promise<void>
  updateOpportunity: (id: string, patch: Partial<Opportunity>) => Promise<void>
  /** 用服务端返回的商机 document 覆盖本地缓存（需求状态联动推进后使用） */
  replaceOpportunityFromServer: (document: Opportunity) => void
  addOpportunityNote: (
    id: string,
    content: string,
    options?: { author?: string; mentions?: string[]; nextFollowAt?: string },
  ) => Promise<void>
  addAdvisorNote: (
    id: string,
    content: string,
    options?: { author?: string; mentions?: string[] },
  ) => Promise<void>
  addOpportunityAttachment: (
    id: string,
    file: Omit<OpportunityAttachment, "uploadedAt"> & { id: string; uploadedAt?: string },
  ) => Promise<void>
  createOpportunity: (customerId: string, data: Partial<Opportunity>) => Promise<string>
  setOppStage: (id: string, stage: OppStage, reason: string) => Promise<Opportunity>
  markOppLost: (
    id: string,
    info: { lostStage: string; lostReasonL1: string; lostReasonL2: string; competitor: string },
  ) => Promise<void>
  createContract: (data: Partial<Contract>) => Promise<string>
  updateContract: (id: string, patch: Partial<Contract>) => Promise<Opportunity | undefined>
  addContractAttachment: (
    id: string,
    file: Omit<ContractAttachment, "uploadedAt"> & { id: string; uploadedAt?: string },
  ) => Promise<void>
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: (targetName?: string) => void
}

export const CrmContext = createContext<CrmContextValue | null>(null)

export function useCrm() {
  const ctx = useContext(CrmContext)
  if (!ctx) throw new Error("useCrm must be used within CrmProvider")
  return ctx
}
