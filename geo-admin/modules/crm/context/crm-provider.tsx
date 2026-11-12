"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { useAudit } from "@/modules/audit/context/audit-provider"
import { invalidateEntityAuditCache } from "@/modules/audit/lib/entity-audit-store"
import {
  CrmContext,
  type CrmContextValue,
} from "@/modules/crm/context/crm-context"
import { useContractActions } from "@/modules/crm/hooks/use-contract-actions"
import { useCrmDataActions } from "@/modules/crm/hooks/use-crm-data"
import { useCustomerActions } from "@/modules/crm/hooks/use-customer-actions"
import { useLeadActions } from "@/modules/crm/hooks/use-lead-actions"
import { useNotificationActions } from "@/modules/crm/hooks/use-notification-actions"
import { useNotificationSocket } from "@/modules/crm/hooks/use-notification-socket"
import { useOpportunityActions } from "@/modules/crm/hooks/use-opportunity-actions"
import {
  type Contract,
  type CrmNotification,
  type Customer,
  type Lead,
  type Opportunity,
} from "@/modules/crm/lib/crm-data"
import {
  EMPTY_CUSTOMER_STATS,
  EMPTY_LEAD_STATS,
  type CustomerStats,
  type LeadStats,
} from "@/modules/crm/services/crm-api"
import { subscribeChannelOpportunityChanges } from "../services/channel-management"
import { fetchOpportunities } from "../services/crm-api"
import { hydrateOpportunity } from "./crm-provider-state"
import { fetchNotifications } from "@/modules/crm/services/crm-directory"

export function CrmProvider({ children }: { children: ReactNode }) {
  const { kind, user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const canViewOpportunities = user?.permissions.includes("section:opportunities")
  useEffect(() => {
    if (kind !== "user" || !canViewOpportunities) return
    let active = true
    const off = subscribeChannelOpportunityChanges(() => { void fetchOpportunities().then((rows) => { if (active) setOpportunities(rows.map(hydrateOpportunity)) }).catch(() => undefined) })
    return () => { active = false; off() }
  }, [kind, user?.id, canViewOpportunities])
  const [leadStats, setLeadStats] = useState<LeadStats>(EMPTY_LEAD_STATS)
  const [customerStats, setCustomerStats] = useState<CustomerStats>(EMPTY_CUSTOMER_STATS)
  const [leadListTotal, setLeadListTotal] = useState(0)
  const [leadsListLoading, setLeadsListLoading] = useState(false)
  const [customerListTotal, setCustomerListTotal] = useState(0)
  const [customersListLoading, setCustomersListLoading] = useState(false)
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false)
  const [contractsLoading, setContractsLoading] = useState(false)
  const [notifications, setNotifications] = useState<CrmNotification[]>([])
  const [loading, setLoading] = useState(false)
  const { recordAudit } = useAudit()
  const contractActions = useContractActions({
    customers,
    contracts,
    setContracts,
    setOpportunities,
    user,
    recordAudit,
  })
  const notificationActions = useNotificationActions({ setNotifications })
  const { getContract, createContract, updateContract, addContractAttachment } = contractActions
  const { markNotificationRead, markAllNotificationsRead } = notificationActions
  const dataActions = useCrmDataActions({
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
  })
  const {
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
  } = dataActions
  const replaceCustomerFromServer = dataActions.replaceCustomerFromServer
  const leadActions = useLeadActions({
    leads,
    setLeads,
    setCustomers,
    refreshLeadStats,
    refreshCustomerStats,
    user,
    recordAudit,
    notifyMentions,
    invalidateEntityAuditCache,
  })
  const {
    getLead,
    createLead,
    updateLead,
    addLeadNote,
    addLeadAttachment,
    markLeadInvalid,
    convertLeadToCustomer,
  } = leadActions
  const customerActions = useCustomerActions({
    customers,
    setCustomers,
    refreshCustomerStats,
    user,
    recordAudit,
    notifyMentions,
  })
  const {
    getCustomer,
    createCustomer,
    updateCustomer,
    applyCustomerOwnerLocally,
    addCustomerNote,
    addCustomerAttachment,
    addSubsidiary,
    addContact,
    updateContact,
    setPrimaryContact,
    transferContact,
  } = customerActions
  const opportunityActions = useOpportunityActions({
    opportunities,
    setOpportunities,
    setContracts,
    customers,
    user,
    recordAudit,
    notifyMentions,
  })
  const {
    getOpportunity,
    updateOpportunity,
    replaceOpportunityFromServer,
    addOpportunityNote,
    addAdvisorNote,
    addOpportunityAttachment,
    createOpportunity,
    setOppStage,
    markOppLost,
  } = opportunityActions

  useEffect(() => {
    if (kind !== "user") {
      setLeads([])
      setCustomers([])
      setOpportunities([])
      setContracts([])
      setLeadStats(EMPTY_LEAD_STATS)
      setCustomerStats(EMPTY_CUSTOMER_STATS)
      setLeadListTotal(0)
      setCustomerListTotal(0)
      setLeadsListLoading(false)
      setCustomersListLoading(false)
      setOpportunitiesLoading(false)
      setContractsLoading(false)
      resetLoadedFlags()
      setLoading(false)
      return
    }
    setLoading(true)
    refresh()
      .catch((err) => toast.error(err instanceof Error ? err.message : "加载 CRM 数据失败"))
      .finally(() => setLoading(false))
  }, [kind, user?.id, refresh])

  useEffect(() => {
    if (!user?.id) {
      setNotifications([])
      return
    }
    let cancelled = false
    void fetchNotifications(100)
      .then((items) => {
        if (!cancelled) setNotifications(items)
      })
      .catch(() => {
        if (!cancelled) setNotifications([])
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // WebSocket 推送未读变化 → 立即刷新列表（侧栏红点随之更新）；断线时仍有 60s 兜底轮询
  useNotificationSocket(Boolean(user?.id), () => {
    void refreshNotifications()
  })

  useEffect(() => {
    if (!user?.id) return
    const timer = window.setInterval(() => {
      void refreshNotifications()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [user?.id, refreshNotifications])


  const value = useMemo<CrmContextValue>(
    () => ({
      leads,
      customers,
      opportunities,
      contracts,
      leadStats,
      customerStats,
      leadListTotal,
      leadsListLoading,
      searchLeads,
      loadLeadById,
      customerListTotal,
      customersListLoading,
      searchCustomers,
      loadCustomerById,
      replaceCustomerFromServer,
      refreshCustomerStats,
      ensureOpportunitiesLoaded,
      ensureContractsLoaded,
      opportunitiesLoading,
      contractsLoading,
      loadOpportunityById,
      loadContractById,
      notifications,
      loading,
      refresh,
      refreshNotifications,
      refreshLeadStats,
      getLead,
      getCustomer,
      getOpportunity,
      getContract,
      createLead,
      updateLead,
      addLeadNote,
      addLeadAttachment,
      convertLeadToCustomer,
      createCustomer,
      markLeadInvalid,
      updateCustomer,
      applyCustomerOwnerLocally,
      addCustomerNote,
      addCustomerAttachment,
      addSubsidiary,
      addContact,
      updateContact,
      setPrimaryContact,
      transferContact,
      updateOpportunity,
      replaceOpportunityFromServer,
      addOpportunityNote,
      addAdvisorNote,
      addOpportunityAttachment,
      createOpportunity,
      setOppStage,
      markOppLost,
      createContract,
      updateContract,
      addContractAttachment,
      markNotificationRead,
      markAllNotificationsRead,
    }),
    [
      leads,
      customers,
      opportunities,
      contracts,
      leadStats,
      customerStats,
      leadListTotal,
      leadsListLoading,
      searchLeads,
      loadLeadById,
      customerListTotal,
      customersListLoading,
      searchCustomers,
      loadCustomerById,
      replaceCustomerFromServer,
      refreshCustomerStats,
      ensureOpportunitiesLoaded,
      ensureContractsLoaded,
      opportunitiesLoading,
      contractsLoading,
      loadOpportunityById,
      loadContractById,
      notifications,
      loading,
      refresh,
      refreshNotifications,
      refreshLeadStats,
      getLead,
      getCustomer,
      getOpportunity,
      getContract,
      createLead,
      updateLead,
      addLeadNote,
      addLeadAttachment,
      convertLeadToCustomer,
      createCustomer,
      markLeadInvalid,
      updateCustomer,
      applyCustomerOwnerLocally,
      addCustomerNote,
      addCustomerAttachment,
      addSubsidiary,
      addContact,
      updateContact,
      setPrimaryContact,
      updateOpportunity,
      replaceOpportunityFromServer,
      addOpportunityNote,
      addAdvisorNote,
      addOpportunityAttachment,
      createOpportunity,
      setOppStage,
      markOppLost,
      createContract,
      updateContract,
      addContractAttachment,
      markNotificationRead,
      markAllNotificationsRead,
    ],
  )

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>
}

export { useCrm } from "@/modules/crm/context/crm-context"
