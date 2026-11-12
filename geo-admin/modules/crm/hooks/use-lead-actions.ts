"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import { auditChange, diffAuditChanges, type AuditInput } from "@/modules/audit/context/audit-provider"
import type { AuthUser } from "@/modules/auth/lib/constants"
import {
  coerceCustomerStatus,
  mentionPreview,
  normalizeLeadSource,
  type CrmAttachment,
  type Customer,
  type Lead,
  type LeadLevel,
} from "@/modules/crm/lib/crm-data"
import {
  convertLeadDocument,
  createLeadDocument,
  updateLeadDocument,
} from "@/modules/crm/services/crm-api"
import { nowDate, nowStr, rid, upsertById } from "@/modules/crm/context/crm-provider-state"

export interface LeadActionsDeps {
  leads: Lead[]
  setLeads: Dispatch<SetStateAction<Lead[]>>
  setCustomers: Dispatch<SetStateAction<Customer[]>>
  refreshLeadStats: () => Promise<void>
  refreshCustomerStats: () => Promise<void>
  user: AuthUser | null
  recordAudit: (input: AuditInput) => void
  notifyMentions: (
    mentions: string[],
    actor: string,
    message: string,
    href: string,
    mentionScope?: "leads" | "customers" | "requests" | "opportunities",
  ) => void
  invalidateEntityAuditCache: (entityId: string, relatedEntityId?: string) => void
}

/** 线索动作（从 crm-provider.tsx 拆出，逻辑逐字搬移）。 */
export function useLeadActions(deps: LeadActionsDeps) {
  const {
    leads,
    setLeads,
    setCustomers,
    refreshLeadStats,
    refreshCustomerStats,
    user,
    recordAudit,
    notifyMentions,
    invalidateEntityAuditCache: invalidateAudit,
  } = deps

  const getLead = useCallback((id: string) => leads.find((l) => l.id === id), [leads])

  const createLead = useCallback(
    async (data: Partial<Lead>): Promise<string> => {
      const today = nowDate()
      const draft: Lead = {
        id: rid("l"),
        createdAt: data.createdAt || today,
        firstContactDate: (data.firstContactDate ?? "").trim(),
        transferDate: data.transferDate ?? "",
        source: normalizeLeadSource(data.source) || data.source || "",
        sourceDetail: data.sourceDetail ?? "",
        companyName: data.companyName ?? "未命名公司",
        brandName: data.brandName ?? "",
        website: data.website ?? "",
        city: data.city ?? "",
        region: data.region ?? "",
        contactName: data.contactName ?? "",
        contactTitle: data.contactTitle ?? "",
        contactDepartment: data.contactDepartment ?? "",
        contactPhone: data.contactPhone ?? "",
        contactWechat: data.contactWechat ?? "",
        email: data.email ?? "",
        sdr: data.sdr ?? user?.name ?? "当前用户",
        sales: data.sales ?? "未分配",
        level: data.level ?? ("" as LeadLevel),
        followState: data.followState ?? "need",
        status: data.status ?? "untouched",
        invalidReason: data.invalidReason,
        wechatAdded: data.wechatAdded,
        notes: data.notes ?? [],
        attachments: data.attachments ?? [],
        importMeta: data.importMeta,
      }
      try {
        const saved = await createLeadDocument(draft)
        setLeads((prev) => upsertById(prev, saved))
        void refreshLeadStats().catch(() => undefined)
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: saved.id,
          entityName: saved.companyName,
          action: "新增线索",
          changes: [auditChange("companyName", "—", saved.companyName), auditChange("sales", "—", saved.sales)],
        })
        return saved.id
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "创建线索失败")
        throw err
      }
    },
    [recordAudit, refreshLeadStats, user?.name],
  )

  const updateLead = useCallback(
    async (id: string, patch: Partial<Lead>) => {
      const before = leads.find((lead) => lead.id === id)
      if (!before) return
      // 真正 patch：只传变更字段；notes/attachments/importMeta 由后端 compose+merge
      const body: Partial<Lead> = {
        ...patch,
        ...(patch.source !== undefined
          ? { source: normalizeLeadSource(patch.source) || patch.source || "" }
          : {}),
      }
      // 归属 SDR 改派由后端写权威审计（变更归属 SDR），前端编辑审计不重复记录 sdr 字段
      const auditPatch = { ...patch } as Partial<Lead>
      delete auditPatch.sdr
      try {
        const saved = await updateLeadDocument(id, body)
        setLeads((prev) => upsertById(prev, saved))
        if (patch.status !== undefined && patch.status !== before.status) {
          void refreshLeadStats().catch(() => undefined)
        }
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: id,
          entityName: before.companyName,
          action: "编辑线索字段",
          changes: diffAuditChanges(before as unknown as Record<string, unknown>, auditPatch as unknown as Record<string, unknown>),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新线索失败")
        throw err
      }
    },
    [leads, recordAudit, refreshLeadStats],
  )

  const addLeadNote = useCallback(
    async (
      id: string,
      content: string,
      wechatAdded: boolean,
      options: { author?: string; mentions?: string[] } = {},
    ) => {
      const before = leads.find((lead) => lead.id === id)
      if (!before) return
      const author = options.author || user?.name || "当前用户"
      const noteDate = nowStr()
      const contactDay = nowDate()
      const existingNotes = Array.isArray(before.notes) ? before.notes : []
      // 跟进勾选「已加企微」时同步基本信息；已是「是」则保持，不因后续未勾选回退
      const nextWechatAdded = wechatAdded ? true : before.wechatAdded
      // 首次触达未填时：以第一次跟进当日作为首次触达日期
      const shouldSetFirstContact = !String(before.firstContactDate || "").trim() && existingNotes.length === 0
      const notes = [
        ...existingNotes,
        {
          id: rid("ln"),
          author,
          content,
          date: noteDate,
          wechatAdded,
          mentions: options.mentions,
        },
      ]
      try {
        const saved = await updateLeadDocument(id, {
          status: before.status === "untouched" ? "touched" : before.status,
          wechatAdded: nextWechatAdded,
          ...(shouldSetFirstContact ? { firstContactDate: contactDay } : {}),
          notes,
        })
        setLeads((prev) => upsertById(prev, saved))
        if (before.status === "untouched") {
          void refreshLeadStats().catch(() => undefined)
        }
        notifyMentions(
          options.mentions ?? [],
          author,
          `在【${before.companyName || before.brandName || id}】的线索跟进记录中提到了你：${mentionPreview(content)}`,
          `/leads/${id}`,
          "leads",
        )
        const changes = [auditChange("notes", "—", content, "跟进内容")]
        if (wechatAdded && before.wechatAdded !== true) {
          changes.push(auditChange("wechatAdded", before.wechatAdded, true, "是否加企微"))
        }
        if (shouldSetFirstContact) {
          changes.push(auditChange("firstContactDate", before.firstContactDate, contactDay, "首次触达日期"))
        }
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: id,
          entityName: before.companyName,
          action: "添加跟进记录",
          changes,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加跟进失败")
        throw err
      }
    },
    [leads, notifyMentions, recordAudit, refreshLeadStats, user?.name],
  )

  const addLeadAttachment = useCallback(
    async (
      id: string,
      file: Omit<CrmAttachment, "uploadedAt" | "origin" | "sourceLeadId" | "sourceLeadAttachmentId"> & {
        id: string
        uploadedAt?: string
      },
    ) => {
      const before = leads.find((lead) => lead.id === id)
      if (!before) return
      const attachments = [
        ...(before.attachments ?? []),
        {
          ...file,
          uploadedAt: file.uploadedAt || nowStr(),
          url: file.url || `/api/crm/attachments/${file.id}`,
          // 磁盘相对路径 leads/{leadId}/{fileId}，写入 MySQL document.attachments
          storagePath: file.storagePath || `leads/${id}/${file.id}`,
        },
      ]
      try {
        const saved = await updateLeadDocument(id, { attachments })
        setLeads((prev) => upsertById(prev, saved))
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: id,
          entityName: before.companyName,
          action: "上传线索附件",
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
    [leads, recordAudit],
  )

  const markLeadInvalid = useCallback(
    async (id: string, reason: string) => {
      const before = leads.find((lead) => lead.id === id)
      if (!before) return
      // 设为无效视为转出：转出日期与无效当日（中国时区）一致
      const transferDate = nowDate()
      try {
        const saved = await updateLeadDocument(id, {
          status: "invalid",
          invalidReason: reason,
          followState: "no_need",
          transferDate,
        })
        setLeads((prev) => upsertById(prev, saved))
        void refreshLeadStats().catch(() => undefined)
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: id,
          entityName: before.companyName,
          action: "标记无效线索",
          changes: [
            auditChange("status", before.status, "invalid"),
            auditChange("invalidReason", before.invalidReason, reason),
            auditChange("transferDate", before.transferDate, transferDate, "转出日期"),
          ],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "标记无效失败")
        throw err
      }
    },
    [leads, recordAudit, refreshLeadStats],
  )

  const convertLeadToCustomer = useCallback(
    async (
      id: string,
      options?: { mode?: "create" | "link"; customerId?: string; sales?: string },
    ): Promise<string> => {
      try {
        const { lead, customer } = await convertLeadDocument(id, options)
        setLeads((prev) => upsertById(prev, lead))
        setCustomers((prev) =>
          upsertById(prev, { ...customer, status: coerceCustomerStatus(customer.status) }),
        )
        void refreshLeadStats().catch(() => undefined)
        void refreshCustomerStats().catch(() => undefined)
        const linked = options?.mode === "link"
        recordAudit({
          module: "线索管理",
          entityType: "线索",
          entityId: id,
          entityName: lead.companyName,
          action: linked ? "线索挂靠已有客户" : "线索转为客户",
          changes: [
            auditChange(
              "customer",
              "—",
              customer.brandName || customer.companyName || (linked ? "已挂靠" : "已生成"),
              linked ? "挂靠客户" : "客户档案",
            ),
          ],
        })
        invalidateAudit(id, customer.id)
        return customer.id
      } catch (err) {
        // CompanyConflictError 由弹窗处理候选，此处不 toast
        if (err && typeof err === "object" && (err as { name?: string }).name === "CompanyConflictError") {
          throw err
        }
        toast.error(err instanceof Error ? err.message : "线索转客户失败")
        throw err
      }
    },
    [recordAudit, refreshLeadStats, refreshCustomerStats],
  )

  return {
    getLead,
    createLead,
    updateLead,
    addLeadNote,
    addLeadAttachment,
    markLeadInvalid,
    convertLeadToCustomer,
  }
}
