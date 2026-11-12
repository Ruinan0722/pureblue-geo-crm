"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import { auditChange, diffAuditChanges, type AuditInput } from "@/modules/audit/context/audit-provider"
import type { AuthUser } from "@/modules/auth/lib/constants"
import {
  followTypeLabel,
  mentionPreview,
  type Contact,
  type CrmAttachment,
  type Customer,
  type FollowUp,
  type SalesCoverage,
  type Subsidiary,
} from "@/modules/crm/lib/crm-data"
import {
  createCustomerCoverage,
  createCustomerDocument,
  transferCustomerContact,
  updateCoverageDocument,
  updateCustomerDocument,
} from "@/modules/crm/services/crm-api"
import {
  coverageToCustomerView,
  nowDate,
  nowStr,
  resolveWriteCoverage,
  rid,
  splitPoolKeys,
  upsertById,
} from "@/modules/crm/context/crm-provider-state"

export interface CustomerActionsDeps {
  customers: Customer[]
  setCustomers: Dispatch<SetStateAction<Customer[]>>
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
}

/** 客户动作（从 crm-provider.tsx 拆出，逻辑逐字搬移）。 */
export function useCustomerActions(deps: CustomerActionsDeps) {
  const {
    customers,
    setCustomers,
    refreshCustomerStats,
    user,
    recordAudit,
    notifyMentions,
  } = deps

  const getCustomer = useCallback((id: string) => customers.find((c) => c.id === id), [customers])

  const createCustomer = useCallback(
    async (
      data: Partial<Customer> & { companyName: string },
      contact?: Partial<Contact>,
    ): Promise<string> => {
      const companyName = data.companyName.trim()
      if (!companyName) {
        toast.error("请填写公司名称")
        throw new Error("请填写公司名称")
      }
      const id = rid("c")
      const contactName = (contact?.name || "").trim()
      const contacts: Contact[] = contactName
        ? [
            {
              id: rid("ct"),
              name: contactName,
              title: (contact?.title || "").trim(),
              phone: (contact?.phone || "").trim(),
              wechat: (contact?.wechat || "").trim(),
              email: (contact?.email || "").trim(),
              status: contact?.status || "awaiting_contact",
              isPrimary: true,
              active: true,
              wechatAdded: Boolean(contact?.wechatAdded),
              createdAt: nowStr(),
            },
          ]
        : []
      const draft: Customer = {
        id,
        companyUid: `CUS-${new Date().getFullYear()}-${id.replace(/\D/g, "").slice(-4).padStart(4, "0")}`,
        companyName,
        brandName: (data.brandName || "").trim() || companyName,
        region: data.region || "",
        city: data.city || "",
        industryL1: data.industryL1 || "",
        industryL2: data.industryL2 || "",
        foundedDate: data.foundedDate || "",
        creditCode: (data.creditCode || "").trim(),
        registeredCapital: data.registeredCapital ?? 0,
        annualRevenue: data.annualRevenue ?? 0,
        scale: data.scale || "",
        nature: data.nature || "",
        status: data.status || "connected",
        owner: data.owner || user?.name || "当前用户",
        createdByUserId: user?.id,
        sdrTransferDate: data.sdrTransferDate || "",
        lastFollowAt: nowStr(),
        nextFollowAt: data.nextFollowAt || "",
        source: data.source || "",
        sourceDetail: data.sourceDetail || "",
        isKey: Boolean(data.isKey),
        createdAt: nowDate(),
        contacts,
        subsidiaries: [],
        notes: [],
        attachments: [],
      }
      try {
        const saved = await createCustomerDocument(draft)
        setCustomers((prev) => upsertById(prev, saved))
        void refreshCustomerStats().catch(() => undefined)
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: saved.id,
          entityName: saved.companyName,
          action: "新建客户",
          changes: [
            auditChange("companyName", "—", saved.companyName),
            ...(saved.isKey ? [auditChange("isKey", "—", "是", "重点客户")] : []),
            ...(contactName
              ? [auditChange("contacts", "—", contactName, "主联系人")]
              : []),
          ],
        })
        return saved.id
      } catch (err) {
        // CompanyConflictError 由弹窗处理候选，此处不 toast
        if (err && typeof err === "object" && (err as { name?: string }).name === "CompanyConflictError") {
          throw err
        }
        toast.error(err instanceof Error ? err.message : "创建客户失败")
        throw err
      }
    },
    [recordAudit, refreshCustomerStats, user?.id, user?.name],
  )

  /** 无本人对接池时自动建立（状态/联系人/跟进/附件首次写入时调用），对用户透明。 */
  const ensureMyCoverage = useCallback(
    async (customer: Customer): Promise<SalesCoverage | undefined> => {
      const existing = customer.coverages?.find((cv) => cv.id === customer.myCoverageId)
      if (existing) return existing
      try {
        const created = await createCustomerCoverage(customer.id, {
          status: "awaiting_contact",
          ownerName: user?.name || "",
          contacts: [],
          notes: [],
          attachments: [],
        })
        const seeded = {
          ...customer,
          myCoverageId: created.id,
          coverages: [...(customer.coverages ?? []).filter((cv) => cv.id !== created.id), created],
        }
        setCustomers((prev) => upsertById(prev, coverageToCustomerView(seeded, created)))
        return created
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "建立对接池失败")
        return undefined
      }
    },
    [user?.name],
  )

  const updateCustomer = useCallback(
    async (id: string, patch: Partial<Customer>) => {
      const before = customers.find((customer) => customer.id === id)
      if (!before) return
      // 读=聚合超集，写=定向子集：池字段定向写本人池（/coverages/:id），主档字段单独走 customer PATCH。
      // 绝不再把聚合视图（contacts/notes/attachments 展平数据）整包回传，避免串入本人池。
      const { poolPatch, masterPatch } = splitPoolKeys(patch)
      let myCoverage = resolveWriteCoverage(before)
      if (!myCoverage && Object.keys(poolPatch).length > 0) {
        // 首次维护客户：自动建立本人对接池，对用户透明（决策 12）
        myCoverage = await ensureMyCoverage(before)
        if (!myCoverage) return
      }
      try {
        let saved: Customer
        if (myCoverage && Object.keys(poolPatch).length > 0) {
          const updatedCov = await updateCoverageDocument(
            myCoverage.id,
            poolPatch as Record<string, unknown>,
          )
          const afterCov = coverageToCustomerView(before, updatedCov)
          saved =
            Object.keys(masterPatch).length > 0
              ? await updateCustomerDocument(id, masterPatch)
              : afterCov
        } else {
          saved = await updateCustomerDocument(id, masterPatch)
          // 单池视图（只看自己/普通销售）：customer PATCH 响应可能是 managed 聚合
          //（后端无 coverageScope 参数）——收敛回本人池，避免聚合视图覆盖 store
          const ownId = before.myCoverageId
          const isSinglePoolView =
            Boolean(ownId) &&
            (before.coverages ?? []).length > 0 &&
            (before.coverages ?? []).every((cv) => cv.id === ownId)
          if (isSinglePoolView && saved.coverages) {
            const ownCov = saved.coverages.find((cv) => cv.id === ownId)
            saved = ownCov ? coverageToCustomerView(saved, ownCov) : { ...saved, coverages: before.coverages }
          }
        }
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: id,
          entityName: before.companyName,
          action: "编辑客户字段",
          changes: diffAuditChanges(before as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新客户失败")
        throw err
      }
    },
    [customers, recordAudit],
  )

  const applyCustomerOwnerLocally = useCallback((ids: string[], owner: string) => {
    if (!ids.length || !owner.trim()) return
    const idSet = new Set(ids)
    setCustomers((prev) =>
      prev.map((row) => (idSet.has(row.id) ? { ...row, owner: owner.trim() } : row)),
    )
  }, [])

  const addCustomerNote = useCallback(
    async (
      id: string,
      content: string,
      options: { author?: string; mentions?: string[]; nextFollowAt?: string; followType?: FollowUp["followType"]; contactId?: string; contactName?: string } = {},
    ) => {
      const before = customers.find((customer) => customer.id === id)
      if (!before) return
      // 写=定向子集：优先本人池；Leader/管理员定位「所选联系人所在池」（无幽灵改动）
      let myCoverage = resolveWriteCoverage(before, options.contactId)
      if (!myCoverage) {
        myCoverage = await ensureMyCoverage(before)
        if (!myCoverage) return
      }
      const author = options.author || user?.name || "当前用户"
      // 添加跟进 = 完成本次计划；未填写新计划则清空本人池 nextFollowAt
      const planned = (options.nextFollowAt || "").trim().slice(0, 10)
      const prevPlan = (myCoverage.nextFollowAt || "").slice(0, 10)
      const nextNotes: FollowUp[] = [
        ...(Array.isArray(myCoverage.notes) ? myCoverage.notes : []),
        {
          id: rid("f"),
          author,
          content,
          date: nowStr(),
          mentions: options.mentions,
          ...(planned ? { nextFollowAt: planned } : {}),
          ...(options.followType ? { followType: options.followType } : {}),
          ...(options.contactId ? { contactId: options.contactId } : {}),
          ...(options.contactName ? { contactName: options.contactName } : {}),
        },
      ]
      try {
        const updatedCov = await updateCoverageDocument(myCoverage.id, {
          notes: nextNotes,
          lastFollowAt: nowStr(),
          nextFollowAt: planned,
        })
        const saved = coverageToCustomerView(before, updatedCov)
        setCustomers((prev) => upsertById(prev, saved))
        notifyMentions(
          options.mentions ?? [],
          author,
          `在【${before.companyName || before.brandName || id}】的客户跟进记录中提到了你：${mentionPreview(content)}`,
          `/customers/${id}`,
          "customers",
        )
        const changes = [auditChange("notes", "—", content, "跟进内容")]
        if (options.followType) {
          changes.push(auditChange("followType", "—", followTypeLabel(options.followType), "跟进方式"))
        }
        if (options.contactName) {
          changes.push(auditChange("contactName", "—", options.contactName, "联系人"))
        }
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
          module: "客户管理",
          entityType: "客户",
          entityId: id,
          entityName: before.companyName,
          action: "添加客户跟进",
          changes,
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加跟进失败")
        throw err
      }
    },
    [customers, notifyMentions, recordAudit, user?.name],
  )

  const addCustomerAttachment = useCallback(
    async (
      id: string,
      file: Omit<CrmAttachment, "uploadedAt" | "origin" | "sourceLeadId" | "sourceLeadAttachmentId"> & {
        id: string
        uploadedAt?: string
      },
    ) => {
      const before = customers.find((customer) => customer.id === id)
      if (!before) return
      // 写=定向子集：优先本人池；Leader/管理员写入首个可见池（销售可见，无幽灵改动）
      let myCoverage = resolveWriteCoverage(before)
      if (!myCoverage) {
        myCoverage = await ensureMyCoverage(before)
        if (!myCoverage) return
      }
      const nextAttachments: CrmAttachment[] = [
        ...(myCoverage.attachments ?? []),
        {
          ...file,
          uploadedAt: file.uploadedAt || nowStr(),
          url: file.url || `/api/crm/attachments/${file.id}`,
        },
      ]
      try {
        const updatedCov = await updateCoverageDocument(myCoverage.id, {
          attachments: nextAttachments,
        })
        const saved = coverageToCustomerView(before, updatedCov)
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: id,
          entityName: before.companyName,
          action: "上传客户附件",
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
    [customers, recordAudit],
  )

  const addSubsidiary = useCallback(
    async (customerId: string, subsidiary: Omit<Subsidiary, "id">) => {
      const before = customers.find((customer) => customer.id === customerId)
      if (!before) return
      const nextIndex = (before.subsidiaries?.length ?? 0) + 1
      const parentCode =
        before.companyUid?.replace(/\D/g, "").slice(-4) || before.id.replace(/\D/g, "").padStart(4, "0")
      const nextSubsidiaries = [
        ...(before.subsidiaries ?? []),
        { ...subsidiary, id: `SUB-${parentCode}-${String(nextIndex).padStart(2, "0")}` },
      ]
      try {
        // 只 PATCH subsidiaries，避免整包主档字段误写；落库依赖后端子公司子表
        const saved = await updateCustomerDocument(customerId, { subsidiaries: nextSubsidiaries })
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: customerId,
          entityName: before.companyName,
          action: "添加二级子公司",
          changes: [auditChange("subsidiaries", "—", subsidiary.name, "子公司")],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加子公司失败")
        throw err
      }
    },
    [customers, recordAudit],
  )

  const addContact = useCallback(
    async (customerId: string, contact: Omit<Contact, "id">) => {
      const before = customers.find((customer) => customer.id === customerId)
      if (!before) return
      // 写=定向子集：优先本人池；Leader/管理员写入首个可见池（销售可见，无幽灵改动）
      let myCoverage = resolveWriteCoverage(before)
      if (!myCoverage) {
        myCoverage = await ensureMyCoverage(before)
        if (!myCoverage) return
      }
      const isFirst = myCoverage.contacts.length === 0
      const nextContacts: Contact[] = [
        ...myCoverage.contacts,
        {
          ...contact,
          id: rid("ct"),
          status: contact.status || "awaiting_contact",
          isPrimary: contact.isPrimary || isFirst,
          createdAt: nowStr(),
        },
      ]
      try {
        const updatedCov = await updateCoverageDocument(myCoverage.id, { contacts: nextContacts })
        const saved = coverageToCustomerView(before, updatedCov)
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: customerId,
          entityName: before.companyName,
          action: "添加联系人",
          changes: [auditChange("contacts", "—", `${contact.name} / ${contact.title}`, "联系人")],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加联系人失败")
        throw err
      }
    },
    [customers, recordAudit],
  )

  const updateContact = useCallback(
    async (customerId: string, contactId: string, patch: Partial<Contact>) => {
      const before = customers.find((item) => item.id === customerId)
      if (!before) return
      // 按联系人定位所在对接池（管理员/Leader 可写可见他人池）
      const coverage = resolveWriteCoverage(before, contactId)
      const contactBefore = coverage?.contacts.find((contact) => contact.id === contactId)
      if (!coverage || !contactBefore) {
        toast.error("未找到联系人所在对接池，无法编辑")
        return
      }
      const contactAfter = { ...contactBefore, ...patch }
      const nextContacts = coverage.contacts.map((ct) => (ct.id === contactId ? contactAfter : ct))
      try {
        const updatedCov = await updateCoverageDocument(coverage.id, { contacts: nextContacts })
        const saved = coverageToCustomerView(before, updatedCov)
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "联系人",
          entityId: contactId,
          relatedEntityIds: [before.id],
          entityName: `${before.companyName} / ${contactBefore.name}`,
          action: "编辑联系人",
          changes: diffAuditChanges(
            contactBefore as unknown as Record<string, unknown>,
            contactAfter as unknown as Record<string, unknown>,
          ),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新联系人失败")
        throw err
      }
    },
    [customers, recordAudit],
  )

  const setPrimaryContact = useCallback(
    async (customerId: string, contactId: string) => {
      const before = customers.find((item) => item.id === customerId)
      if (!before) return
      // 按联系人定位所在对接池（管理员/Leader 设他人池主联系人）
      const coverage = resolveWriteCoverage(before, contactId)
      // 单池且子表未回填到 coverages[].contacts 时，回退扁平 contacts
      const poolContacts =
        coverage?.contacts?.length
          ? coverage.contacts
          : coverage && (before.coverages?.length ?? 0) <= 1
            ? (before.contacts ?? [])
            : (coverage?.contacts ?? [])
      const contact = poolContacts.find((item) => item.id === contactId)
      if (!coverage || !contact) {
        toast.error("未找到联系人所在对接池，无法设置主联系人")
        return
      }
      const nextContacts = poolContacts.map((ct) => ({ ...ct, isPrimary: ct.id === contactId }))
      try {
        const updatedCov = await updateCoverageDocument(coverage.id, { contacts: nextContacts })
        const saved = coverageToCustomerView(before, updatedCov)
        setCustomers((prev) => upsertById(prev, saved))
        recordAudit({
          module: "客户管理",
          entityType: "客户",
          entityId: customerId,
          entityName: before.companyName,
          action: "设置主联系人",
          changes: [
            auditChange("primaryContact", before.contacts.find((item) => item.isPrimary)?.name, contact.name, "主联系人"),
          ],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "设置主联系人失败")
        throw err
      }
    },
    [customers, recordAudit],
  )

  const transferContact = useCallback(
    async (customerId: string, contactId: string, targetOwnerName: string) => {
      try {
        await transferCustomerContact(customerId, contactId, targetOwnerName)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "改派联系人失败")
        throw err
      }
    },
    [],
  )

  return {
    getCustomer,
    createCustomer,
    ensureMyCoverage,
    updateCustomer,
    applyCustomerOwnerLocally,
    addCustomerNote,
    addCustomerAttachment,
    addSubsidiary,
    addContact,
    updateContact,
    setPrimaryContact,
    transferContact,
  }
}
