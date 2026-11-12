"use client"

import { CHANNEL_CONTRACTS_CHANGED,CHANNEL_OPPORTUNITIES_CHANGED,publishChange } from "../services/channel-management"

import { auditChange,diffAuditChanges,type AuditInput } from "@/modules/audit/context/audit-provider"
import type { AuthUser } from "@/modules/auth/lib/constants"
import {
hydrateOpportunity,
nowDate,
nowStr,
rid,
upsertById,
} from "@/modules/crm/context/crm-provider-state"
import {
buildOpportunityName,
isOppStageRollback,
mentionPreview,
normalizeContract,
OPP_STAGE_META,
type Contract,
type Customer,
type Opportunity,
type OpportunityAttachment,
type OppStage,
} from "@/modules/crm/lib/crm-data"
import {
createOpportunityDocument,
updateOpportunityDocument,
} from "@/modules/crm/services/crm-api"
import { useCallback,type Dispatch,type SetStateAction } from "react"
import { toast } from "sonner"

export interface OpportunityActionsDeps {
  opportunities: Opportunity[]
  setOpportunities: Dispatch<SetStateAction<Opportunity[]>>
  setContracts: Dispatch<SetStateAction<Contract[]>>
  customers: Customer[]
  user: AuthUser | null
  recordAudit: (input: AuditInput) => void
  notifyMentions: (
    mentions: string[],
    actor: string,
    message: string,
    href: string,
    mentionScope?: "leads" | "customers" | "requests" | "opportunities",
  ) => void
}

/** 商机动作（从 crm-provider.tsx 拆出，逻辑逐字搬移）。 */
export function useOpportunityActions(deps: OpportunityActionsDeps) {
  const {
    opportunities,
    setOpportunities,
    setContracts,
    customers,
    user,
    recordAudit,
    notifyMentions,
  } = deps

  const getOpportunity = useCallback(
    (id: string) => opportunities.find((o) => o.id === id),
    [opportunities],
  )

  const updateOpportunity = useCallback(
    async (id: string, patch: Partial<Opportunity>) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before) return
      // 真正 patch：只传变更字段；集合由后端 compose+merge 补齐
      const body: Partial<Opportunity> = { ...patch }
      try {
        const saved = await updateOpportunityDocument(id, body)
        const { _createdContract, ...opp } = saved
        if (opp.partnerId) { publishChange(CHANNEL_OPPORTUNITIES_CHANGED); publishChange(CHANNEL_CONTRACTS_CHANGED) }
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(opp)))
        if (_createdContract) setContracts((prev) => upsertById(prev, normalizeContract(_createdContract)))
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: "编辑商机字段",
          changes: diffAuditChanges(before as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新商机失败")
        throw err
      }
    },
    [opportunities, recordAudit, setContracts, setOpportunities],
  )

  const replaceOpportunityFromServer = useCallback((document: Opportunity) => {
    setOpportunities((prev) => upsertById(prev, hydrateOpportunity(document)))
  }, [])

  const addOpportunityNote = useCallback(
    async (
      id: string,
      content: string,
      options: { author?: string; mentions?: string[]; nextFollowAt?: string } = {},
    ) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before) return
      const author = options.author || user?.name || "当前用户"
      // 添加跟进 = 完成本次计划；未填写新计划则清空商机级 nextFollowAt
      const planned = (options.nextFollowAt || "").trim().slice(0, 10)
      const prevPlan = (before.nextFollowAt || "").slice(0, 10)
      const notes = [
        ...before.notes,
        {
          id: rid("of"),
          author,
          content,
          date: nowStr(),
          mentions: options.mentions,
          ...(planned ? { nextFollowAt: planned } : {}),
        },
      ]
      try {
        const saved = await updateOpportunityDocument(id, {
          lastFollowAt: nowStr(),
          nextFollowAt: planned,
          notes,
        })
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(saved)))
        notifyMentions(
          options.mentions ?? [],
          author,
          `在【${before.name || before.brandName || id}】的商机销售跟进记录中提到了你：${mentionPreview(content)}`,
          `/opportunities/${id}`,
          "opportunities",
        )
        const changes = [auditChange("notes", "—", content, "跟进内容")]
        if (prevPlan !== planned) {
          changes.push(
            auditChange(
              "nextFollowAt",
              prevPlan || "—",
              planned || "已清除",
              planned ? "下次计划跟进" : "下次计划跟进（本次已跟进）",
            ),
          )
        }
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: "添加销售跟进",
          changes,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加跟进失败")
        throw err
      }
    },
    [notifyMentions, opportunities, recordAudit, user?.name],
  )

  const addAdvisorNote = useCallback(
    async (id: string, content: string, options: { author?: string; mentions?: string[] } = {}) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before) return
      const author = options.author || user?.name || "售前顾问"
      const advisorNotes = [
        ...before.advisorNotes,
        { id: rid("ad"), author, content, date: nowStr(), mentions: options.mentions },
      ]
      try {
        const saved = await updateOpportunityDocument(id, { advisorNotes })
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(saved)))
        notifyMentions(
          options.mentions ?? [],
          author,
          `在【${before.name || before.brandName || id}】的商机顾问反馈中提到了你：${mentionPreview(content)}`,
          `/opportunities/${id}`,
          "opportunities",
        )
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: "添加顾问反馈",
          changes: [auditChange("advisorNotes", "—", content, "顾问反馈")],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加顾问反馈失败")
        throw err
      }
    },
    [notifyMentions, opportunities, recordAudit, user?.name],
  )

  const addOpportunityAttachment = useCallback(
    async (id: string, file: Omit<OpportunityAttachment, "uploadedAt"> & { id: string; uploadedAt?: string }) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before) return
      const attachments = [
        ...(before.attachments ?? []),
        {
          ...file,
          uploadedAt: file.uploadedAt || nowStr(),
          url: file.url || `/api/crm/attachments/${file.id}`,
        },
      ]
      try {
        const saved = await updateOpportunityDocument(id, { attachments })
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(saved)))
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: "上传商机附件",
          changes: [
            auditChange(
              "attachments",
              "—",
              file.description?.trim() ? `${file.name}（${file.description.trim()}）` : file.name,
              "附件",
            ),
          ],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传附件失败")
        throw err
      }
    },
    [opportunities, recordAudit],
  )

  const createOpportunity = useCallback(
    async (customerId: string, data: Partial<Opportunity>): Promise<string> => {
      const cust = customers.find((c) => c.id === customerId)
      const subsidiary = cust?.subsidiaries?.find((item) => item.id === data.subsidiaryId)
      const draft: Opportunity = {
        id: rid("o"),
        name:
          data.name?.trim() ||
          buildOpportunityName(cust?.brandName || cust?.companyName || "新客户", subsidiary?.shortName || subsidiary?.name, data.projectTypes ?? []),
        customerId,
        businessType: data.businessType ?? "direct",
        partnerId: data.partnerId,
        partnerName: data.partnerName,
        subsidiaryId: subsidiary?.id,
        subsidiaryName: subsidiary?.name,
        brandName: data.brandName ?? cust?.brandName ?? "",
        region: data.region ?? cust?.region ?? "",
        goal: data.goal ?? "recommend",
        platform: data.platform ?? "ChatGPT",
        period: data.period ?? "6 个月",
        amount: data.amount ?? 0,
        probability: data.probability ?? 20,
        expectedSignDate: data.expectedSignDate ?? "",
        stage: "contact",
        owner: data.owner ?? cust?.owner ?? user?.name ?? "当前用户",
        advisor: data.advisor ?? "",
        customerSuccess: data.customerSuccess ?? "",
        projectTypes: data.projectTypes && data.projectTypes.length ? data.projectTypes : ["监测"],
        primaryContactId: data.primaryContactId ?? cust?.contacts.find((c) => c.isPrimary)?.id ?? "",
        requestIds: [],
        notes: [],
        advisorNotes: [],
        createdAt: nowDate(),
        lastFollowAt: nowStr(),
        stageHistory: [{ stage: "contact", enteredAt: nowStr() }],
        attachments: [],
      }
      try {
        const saved = await createOpportunityDocument(draft)
        if (saved.partnerId) publishChange(CHANNEL_OPPORTUNITIES_CHANGED)
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(saved)))
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: saved.id,
          entityName: saved.name,
          action: "创建商机",
          changes: [auditChange("name", "—", saved.name), auditChange("stage", "—", OPP_STAGE_META[saved.stage].label)],
        })
        return saved.id
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "创建商机失败")
        throw err
      }
    },
    [customers, recordAudit, user?.name],
  )

  const setOppStage = useCallback(
    async (id: string, stage: OppStage, reason: string) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before || before.stage === stage) {
        throw new Error("阶段未变化")
      }
      const trimmed = reason.trim()
      if (!trimmed) {
        toast.error("请填写阶段变更原因")
        throw new Error("请填写阶段变更原因")
      }
      const rollback = isOppStageRollback(before.stage, stage)
      const toLabel = OPP_STAGE_META[stage].label
      const changedAt = nowStr()
      const history = [...(before.stageHistory ?? [])]
      const last = history[history.length - 1]
      if (last && !last.leftAt) history[history.length - 1] = { ...last, leftAt: changedAt }
      history.push({
        stage,
        enteredAt: changedAt,
        reason: trimmed,
        changeType: rollback ? "rollback" : "advance",
      })
      try {
        const saved = await updateOpportunityDocument(id, {
          stage,
          lastFollowAt: changedAt,
          stageHistory: history,
        })
        const { _createdContract, ...opp } = saved
        if (opp.partnerId) { publishChange(CHANNEL_OPPORTUNITIES_CHANGED); publishChange(CHANNEL_CONTRACTS_CHANGED) }
        const hydrated = hydrateOpportunity(opp)
        setOpportunities((prev) => upsertById(prev, hydrated))
        if (_createdContract) setContracts((prev) => upsertById(prev, normalizeContract(_createdContract)))
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: rollback ? `回退至「${toLabel}」` : `推进至「${toLabel}」`,
          changes: [
            auditChange("stage", OPP_STAGE_META[before.stage].label, toLabel),
            auditChange("stageReason", "—", trimmed, rollback ? "回退原因" : "变更原因"),
          ],
        })
        return hydrated
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "阶段变更失败")
        throw err
      }
    },
    [opportunities, recordAudit],
  )

  const markOppLost = useCallback(
    async (
      id: string,
      info: { lostStage: string; lostReasonL1: string; lostReasonL2: string; competitor: string },
    ) => {
      const before = opportunities.find((opportunity) => opportunity.id === id)
      if (!before) return
      const changedAt = nowStr()
      const history = [...(before.stageHistory ?? [])]
      const last = history[history.length - 1]
      if (last && !last.leftAt) history[history.length - 1] = { ...last, leftAt: changedAt }
      history.push({ stage: "lost", enteredAt: changedAt })
      try {
        const saved = await updateOpportunityDocument(id, {
          stage: "lost",
          ...info,
          lostReason: info.lostReasonL2,
          probability: 0,
          stageHistory: history,
        })
        setOpportunities((prev) => upsertById(prev, hydrateOpportunity(saved)))
        recordAudit({
          module: "商机管理",
          entityType: "商机",
          entityId: id,
          entityName: before.name,
          action: "标记商机输单",
          changes: [
            auditChange("stage", OPP_STAGE_META[before.stage].label, OPP_STAGE_META.lost.label),
            auditChange("lostStage", before.lostStage, info.lostStage),
            auditChange("lostReasonL1", before.lostReasonL1, info.lostReasonL1),
            auditChange("lostReasonL2", before.lostReasonL2, info.lostReasonL2),
            auditChange("competitor", before.competitor, info.competitor),
          ],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "标记输单失败")
        throw err
      }
    },
    [opportunities, recordAudit],
  )

  return {
    getOpportunity,
    updateOpportunity,
    replaceOpportunityFromServer,
    addOpportunityNote,
    addAdvisorNote,
    addOpportunityAttachment,
    createOpportunity,
    setOppStage,
    markOppLost,
  }
}
