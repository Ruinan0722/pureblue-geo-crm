"use client"

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react"
import type { AuthUser } from "@/modules/auth/lib/constants"
import {
  coerceCustomerStatus,
  normalizeContract,
  type Contract,
  type CrmNotification,
  type Customer,
  type Lead,
  type Opportunity,
} from "@/modules/crm/lib/crm-data"
import {
  createNotifications,
  fetchNotifications,
} from "@/modules/crm/services/crm-directory"
import {
  EMPTY_CUSTOMER_STATS,
  EMPTY_LEAD_STATS,
  fetchContractById,
  fetchContracts,
  fetchCrmBootstrap,
  fetchCustomerById,
  fetchCustomerStats,
  fetchCustomers,
  fetchLeadById,
  fetchLeadStats,
  fetchLeads,
  fetchOpportunities,
  fetchOpportunityById,
  type CustomerListFilters,
  type CustomerListResult,
  type CustomerStats,
  type LeadListFilters,
  type LeadListResult,
  type LeadStats,
} from "@/modules/crm/services/crm-api"
import { hydrateOpportunity, upsertById } from "@/modules/crm/context/crm-provider-state"

export interface CrmDataDeps {
  setLeads: Dispatch<SetStateAction<Lead[]>>
  setCustomers: Dispatch<SetStateAction<Customer[]>>
  setOpportunities: Dispatch<SetStateAction<Opportunity[]>>
  setContracts: Dispatch<SetStateAction<Contract[]>>
  setLeadStats: Dispatch<SetStateAction<LeadStats>>
  setCustomerStats: Dispatch<SetStateAction<CustomerStats>>
  setLeadListTotal: Dispatch<SetStateAction<number>>
  setLeadsListLoading: Dispatch<SetStateAction<boolean>>
  setCustomerListTotal: Dispatch<SetStateAction<number>>
  setCustomersListLoading: Dispatch<SetStateAction<boolean>>
  setOpportunitiesLoading: Dispatch<SetStateAction<boolean>>
  setContractsLoading: Dispatch<SetStateAction<boolean>>
  setNotifications: Dispatch<SetStateAction<CrmNotification[]>>
  user: AuthUser | null
}

/** 加载/搜索/刷新动作（从 crm-provider.tsx 拆出，逻辑逐字搬移）。 */
export function useCrmDataActions(deps: CrmDataDeps) {
  const {
    setLeads,
    setCustomers,
    setOpportunities,
    setContracts,
    setLeadStats,
    setCustomerStats,
    setLeadListTotal,
    setLeadsListLoading,
    setCustomerListTotal,
    setCustomersListLoading,
    setOpportunitiesLoading,
    setContractsLoading,
    setNotifications,
    user,
  } = deps

  const opportunitiesLoadedRef = useRef(false)
  const contractsLoadedRef = useRef(false)
  const opportunitiesInflightRef = useRef<Promise<void> | null>(null)
  const contractsInflightRef = useRef<Promise<void> | null>(null)
  const leadsSearchInflight = useRef<Map<string, Promise<LeadListResult>>>(new Map())
  const leadsSearchSeq = useRef(0)
  const customersSearchInflight = useRef<Map<string, Promise<CustomerListResult>>>(new Map())
  const customersSearchSeq = useRef(0)

  const refreshLeadStats = useCallback(async () => {
    const stats = await fetchLeadStats()
    setLeadStats(stats)
  }, [])

  const refreshCustomerStats = useCallback(async () => {
    const stats = await fetchCustomerStats()
    setCustomerStats(stats)
  }, [])

  const searchLeads = useCallback(async (filters: LeadListFilters = {}): Promise<LeadListResult> => {
    const key = JSON.stringify(filters)
    // 合并并发相同查询（含 React Strict Mode 双触发）
    const existing = leadsSearchInflight.current.get(key)
    if (existing) return existing

    const seq = ++leadsSearchSeq.current
    const task = (async () => {
      setLeadsListLoading(true)
      try {
        const result = await fetchLeads(filters)
        // 只应用最新一次请求，避免快速翻页时旧响应覆盖新页数据
        if (seq === leadsSearchSeq.current) {
          setLeads(result.items)
          setLeadListTotal(result.total)
          setLeadsListLoading(false)
        }
        return result
      } catch (err) {
        if (seq === leadsSearchSeq.current) {
          setLeadsListLoading(false)
        }
        throw err
      } finally {
        leadsSearchInflight.current.delete(key)
      }
    })()

    leadsSearchInflight.current.set(key, task)
    return task
  }, [])

  const loadLeadById = useCallback(async (id: string): Promise<Lead | undefined> => {
    try {
      const lead = await fetchLeadById(id)
      setLeads((prev) => upsertById(prev, lead))
      return lead
    } catch {
      return undefined
    }
  }, [])

  const searchCustomers = useCallback(async (filters: CustomerListFilters = {}): Promise<CustomerListResult> => {
    const key = JSON.stringify(filters)
    const existing = customersSearchInflight.current.get(key)
    if (existing) return existing

    const seq = ++customersSearchSeq.current
    const task = (async () => {
      setCustomersListLoading(true)
      try {
        const result = await fetchCustomers(filters)
        if (seq === customersSearchSeq.current) {
          setCustomers(result.items.map((c) => ({ ...c, status: coerceCustomerStatus(c.status) })))
          setCustomerListTotal(result.total)
          setCustomersListLoading(false)
        }
        return result
      } catch (err) {
        if (seq === customersSearchSeq.current) {
          setCustomersListLoading(false)
        }
        throw err
      } finally {
        customersSearchInflight.current.delete(key)
      }
    })()

    customersSearchInflight.current.set(key, task)
    return task
  }, [])

  const loadCustomerById = useCallback(
    async (id: string, opts?: { coverageScope?: "self" | "managed" }): Promise<Customer | undefined> => {
      try {
        const customer = await fetchCustomerById(id, opts)
        setCustomers((prev) =>
          upsertById(prev, { ...customer, status: coerceCustomerStatus(customer.status) }),
        )
        return customer
      } catch {
        return undefined
      }
    },
    [],
  )

  const replaceCustomerFromServer = useCallback((customer: Customer) => {
    setCustomers((prev) =>
      upsertById(prev, { ...customer, status: coerceCustomerStatus(customer.status) }),
    )
  }, [])

  const ensureOpportunitiesLoaded = useCallback(async () => {
    if (opportunitiesLoadedRef.current) return
    if (opportunitiesInflightRef.current) return opportunitiesInflightRef.current
    setOpportunitiesLoading(true)
    const task = (async () => {
      try {
        const rows = await fetchOpportunities()
        setOpportunities(rows.map(hydrateOpportunity))
        opportunitiesLoadedRef.current = true
      } finally {
        setOpportunitiesLoading(false)
        opportunitiesInflightRef.current = null
      }
    })()
    opportunitiesInflightRef.current = task
    return task
  }, [])

  const ensureContractsLoaded = useCallback(async () => {
    if (contractsLoadedRef.current) return
    if (contractsInflightRef.current) return contractsInflightRef.current
    setContractsLoading(true)
    const task = (async () => {
      try {
        const rows = await fetchContracts()
        setContracts(rows.map(normalizeContract))
        contractsLoadedRef.current = true
      } finally {
        setContractsLoading(false)
        contractsInflightRef.current = null
      }
    })()
    contractsInflightRef.current = task
    return task
  }, [])

  const loadOpportunityById = useCallback(async (id: string): Promise<Opportunity | undefined> => {
    try {
      const opp = await fetchOpportunityById(id)
      const hydrated = hydrateOpportunity(opp)
      setOpportunities((prev) => upsertById(prev, hydrated))
      return hydrated
    } catch {
      return undefined
    }
  }, [])

  const loadContractById = useCallback(async (id: string): Promise<Contract | undefined> => {
    try {
      const raw = await fetchContractById(id)
      const { _updatedOpportunity, ...rest } = raw as Contract & { _updatedOpportunity?: Opportunity }
      const normalized = normalizeContract(rest)
      setContracts((prev) => upsertById(prev, normalized))
      if (_updatedOpportunity) {
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(_updatedOpportunity)))
      }
      return normalized
    } catch {
      return undefined
    }
  }, [])

  const refresh = useCallback(async () => {
    // bootstrap 仅统计；商机/合同由 ensure* 按板块加载，避免拖慢线索/客户页
    const data = await fetchCrmBootstrap()
    if (data.leads.length > 0) {
      setLeads(data.leads)
      setLeadListTotal(data.leads.length)
    }
    if (data.customers.length > 0) {
      setCustomers(
        (prev) =>
          prev.length > 0
            ? prev
            : data.customers.map((c) => ({ ...c, status: coerceCustomerStatus(c.status) })),
      )
      setCustomerListTotal((prev) => (prev > 0 ? prev : data.customers.length))
    }
    setLeadStats(data.leadStats ?? EMPTY_LEAD_STATS)
    setCustomerStats(data.customerStats ?? EMPTY_CUSTOMER_STATS)
  }, [])

  const resetLoadedFlags = useCallback(() => {
    opportunitiesLoadedRef.current = false
    contractsLoadedRef.current = false
    opportunitiesInflightRef.current = null
    contractsInflightRef.current = null
  }, [])

  const notifyMentions = useCallback(
    (
      mentions: string[] = [],
      actor: string,
      message: string,
      href: string,
      mentionScope?: "leads" | "customers" | "requests" | "opportunities",
    ) => {
      if (!mentions.length) return
      const targets = mentions.filter((name) => name && name !== actor)
      if (!targets.length) return
      void createNotifications(
        targets.map((targetName) => ({ targetName, message, href })),
        mentionScope,
      )
        .then((created) => {
          if (!created.length) return
          setNotifications((prev) => {
            const mine = created.filter((item) => !user?.name || item.targetName === user.name)
            if (!mine.length) return prev
            const ids = new Set(prev.map((item) => item.id))
            return [...mine.filter((item) => !ids.has(item.id)), ...prev].slice(0, 100)
          })
        })
        .catch(() => undefined)
    },
    [user?.name],
  )

  const refreshNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([])
      return
    }
    try {
      const items = await fetchNotifications(100)
      setNotifications(items)
    } catch {
      /* 侧边栏角标失败时保持现状，避免闪空 */
    }
  }, [user?.id])

  return {
    refreshLeadStats,
    refreshCustomerStats,
    searchLeads,
    loadLeadById,
    searchCustomers,
    loadCustomerById,
    ensureOpportunitiesLoaded,
    ensureContractsLoaded,
    loadOpportunityById,
    loadContractById,
    refresh,
    resetLoadedFlags,
    notifyMentions,
    refreshNotifications,
    replaceCustomerFromServer,
  }
}
