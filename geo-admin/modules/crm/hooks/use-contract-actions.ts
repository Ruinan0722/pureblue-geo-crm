"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import { auditChange, diffAuditChanges, type AuditInput } from "@/modules/audit/context/audit-provider"
import type { AuthUser } from "@/modules/auth/lib/constants"
import {
  CONTRACT_STATUS_META,
  normalizeContract,
  OPP_STAGE_META,
  type Contract,
  type ContractAttachment,
  type Customer,
  type Opportunity,
} from "@/modules/crm/lib/crm-data"
import { createContractDocument, updateContractDocument } from "@/modules/crm/services/crm-api"
import { hydrateOpportunity, nowDate, nowStr, rid, upsertById } from "@/modules/crm/context/crm-provider-state"

export interface ContractActionsDeps {
  customers: Customer[]
  contracts: Contract[]
  setContracts: Dispatch<SetStateAction<Contract[]>>
  setOpportunities: Dispatch<SetStateAction<Opportunity[]>>
  user: AuthUser | null
  recordAudit: (input: AuditInput) => void
}

export function useContractActions(deps: ContractActionsDeps) {
  const { customers, contracts, setContracts, setOpportunities, user, recordAudit } = deps

  const getContract = useCallback((id: string) => contracts.find((c) => c.id === id), [contracts])

  const createContract = useCallback(
    async (data: Partial<Contract>): Promise<string> => {
      const cust = data.customerId ? customers.find((c) => c.id === data.customerId) : undefined
      const draft: Contract = {
        id: rid("ct-"),
        code: data.code?.trim() || "",
        name: data.name ?? "新建合同",
        customerId: data.customerId ?? "",
        company: data.company ?? cust?.companyName ?? "",
        region: data.region ?? cust?.region ?? "",
        city: data.city ?? cust?.city ?? "",
        type: data.type ?? "新签",
        signType: data.signType ?? "线上电子签",
        source: data.source ?? "",
        status: data.status ?? "pending",
        projectStatus: data.projectStatus ?? "not_started",
        signSubject: data.signSubject ?? "",
        ourSignSubject: data.ourSignSubject ?? "北京 GEO 智营科技有限公司",
        customerSignSubject: data.customerSignSubject ?? data.signSubject ?? "",
        signer: data.signer ?? "",
        owner: data.owner ?? user?.name ?? "",
        owners: data.owners?.length ? data.owners : data.owner ? [data.owner] : user?.name ? [user.name] : [],
        signerManager: data.signerManager ?? "",
        dept: data.dept ?? (user?.departmentNames?.[0] ?? ""),
        amount: data.amount ?? 0,
        effectiveDate: data.effectiveDate ?? "",
        dualSignDate: data.dualSignDate ?? "",
        validMonths: data.validMonths ?? 0,
        endDate: data.endDate ?? "",
        attachments: data.attachments ?? [],
        opportunityId: data.opportunityId ?? "",
        createdAt: nowDate(),
      }
      try {
        const created = await createContractDocument(draft)
        const { _updatedOpportunity, ...rest } = created
        const saved = normalizeContract(rest)
        setContracts((prev) => upsertById(prev, saved))
        if (_updatedOpportunity) {
          setOpportunities((prev) => upsertById(prev, hydrateOpportunity(_updatedOpportunity)))
        }
        recordAudit({
          module: "合同管理",
          entityType: "合同",
          entityId: saved.id,
          entityName: saved.name,
          action: "新增合同",
          changes: [auditChange("name", "—", saved.name), auditChange("owners", "—", saved.owners)],
        })
        return saved.id
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "创建合同失败")
        throw err
      }
    },
    [customers, recordAudit, user?.departmentNames, user?.name],
  )

  const updateContract = useCallback(
    async (id: string, patch: Partial<Contract>): Promise<Opportunity | undefined> => {
      const before = contracts.find((contract) => contract.id === id)
      if (!before) return undefined
      // 真正 patch：只传变更字段；集合由后端 compose+merge 补齐
      try {
        const updated = await updateContractDocument(id, patch)
        const { _updatedOpportunity, ...rest } = updated
        const saved = normalizeContract(rest)
        setContracts((prev) => upsertById(prev, saved))
        let linkedOpp: Opportunity | undefined
        if (_updatedOpportunity) {
          linkedOpp = hydrateOpportunity(_updatedOpportunity)
          setOpportunities((prev) => upsertById(prev, linkedOpp!))
        }
        const action =
          patch.status === "void"
            ? "作废合同"
            : patch.status === "terminated"
              ? "终止合同"
              : patch.status === "signed"
                ? "完成签署"
                : "编辑合同字段"
        const changes =
          patch.status === "void" || patch.status === "terminated" || patch.status === "signed"
            ? [
                auditChange(
                  "status",
                  CONTRACT_STATUS_META[before.status].label,
                  CONTRACT_STATUS_META[patch.status].label,
                  "合同状态",
                ),
                ...(patch.status === "void" || patch.status === "terminated"
                  ? [
                      auditChange(
                        "statusReason",
                        before.statusReason,
                        patch.statusReason,
                        patch.status === "void" ? "作废原因" : "终止原因",
                      ),
                    ]
                  : []),
                ...(linkedOpp?.stage === "won"
                  ? [
                      auditChange(
                        "linkedOppStage",
                        "—",
                        OPP_STAGE_META.won.label,
                        "关联商机阶段",
                      ),
                    ]
                  : []),
              ]
            : diffAuditChanges(
                before as unknown as Record<string, unknown>,
                patch as unknown as Record<string, unknown>,
              )
        recordAudit({
          module: "合同管理",
          entityType: "合同",
          entityId: id,
          entityName: before.name,
          action,
          changes,
          relatedEntityIds: linkedOpp ? [linkedOpp.id] : undefined,
        })
        return linkedOpp
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新合同失败")
        throw err
      }
    },
    [contracts, recordAudit],
  )

  const addContractAttachment = useCallback(
    async (id: string, file: Omit<ContractAttachment, "uploadedAt"> & { id: string; uploadedAt?: string }) => {
      const before = contracts.find((contract) => contract.id === id)
      if (!before) return
      const attachments = [
        ...(before.attachments ?? []),
        {
          ...file,
          kind: file.kind ?? "contract",
          uploadedAt: file.uploadedAt || nowStr(),
          url: file.url || `/api/crm/attachments/${file.id}`,
        },
      ]
      try {
        const updated = await updateContractDocument(id, { attachments })
        const { _updatedOpportunity, ...rest } = updated
        const saved = normalizeContract(rest)
        setContracts((prev) => upsertById(prev, saved))
        if (_updatedOpportunity) {
          setOpportunities((prev) => upsertById(prev, hydrateOpportunity(_updatedOpportunity)))
        }
        recordAudit({
          module: "合同管理",
          entityType: "合同",
          entityId: id,
          entityName: before.name,
          action: "上传合同附件",
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
    [contracts, recordAudit],
  )

  return { getContract, createContract, updateContract, addContractAttachment }
}
