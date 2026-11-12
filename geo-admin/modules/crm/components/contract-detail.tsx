"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Ban, BellRing, Check, History, Paperclip, Pencil, Upload, UserRoundPlus } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Pill, InfoRow, EmptyState } from "@/modules/crm/components/ui"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import { AttachmentUploadDialog } from "@/modules/crm/components/attachment-upload-dialog"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import { canDo } from "@/modules/auth/lib/permissions"
import { EntityAuditCount, EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import {
  CONTRACT_SOURCES,
  CONTRACT_STATUS_META,
  CONTRACT_TYPES,
  PROJECT_STATUS_META,
  REGIONS,
  SIGN_TYPES,
  contractOwnerNames,
  hasContractFileAttachment,
  money,
  type Contract,
  type ContractStatus,
  type ProjectStatus,
} from "@/modules/crm/lib/crm-data"
import { MemberPicker } from "@/modules/crm/components/member-picker"
import { useDepartmentMemberNames, useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { fetchDirectManagerByName } from "@/modules/crm/services/crm-directory"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { cityOptionsForRegion, applyRegionCityChange } from "@/modules/crm/lib/china-cities"
import { RelatedProjectLinks } from "@/modules/projects/components/related-project-links"
import { ContractPaymentPlanTab } from "@/modules/crm/components/payment-plan-tab"

const PROJECT_OPTIONS: ProjectStatus[] = ["not_started", "ongoing", "completed", "closed"]
const PROJECT_MANAGER_LEADERS = ["演示成员18", "演示成员20", "演示成员19"]

export function ContractDetail({ id }: { id: string }) {
  const {
    getContract,
    getCustomer,
    getOpportunity,
    updateContract,
    addContractAttachment,
    loadContractById,
    loadCustomerById,
    loadOpportunityById,
    ensureOpportunitiesLoaded,
  } = useCrm()
  const { identity, role, user } = useRole()
  const editable = canDo(user?.permissions ?? [], "contracts:sign", "contracts:write")
  const canViewPayments = canDo(user?.permissions ?? [], "payments:view", "section:contracts")
  const contract = getContract(id)
  const [detailLoading, setDetailLoading] = useState(false)
  const [signOpen, setSignOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [statusAction, setStatusAction] = useState<"void" | "terminated" | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKind, setUploadKind] = useState<"contract" | "sow">("contract")
  const [managerRequestOpen, setManagerRequestOpen] = useState(false)
  const [managerAssignOpen, setManagerAssignOpen] = useState(false)
  const [managerRequestReason, setManagerRequestReason] = useState("")
  const [requestedStartDate, setRequestedStartDate] = useState("")
  const [assignedManagers, setAssignedManagers] = useState<string[]>([])
  const [managerSaving, setManagerSaving] = useState(false)
  const [activeTab, setActiveTab] = useState("basic")
  const isProjectManagerLeader = PROJECT_MANAGER_LEADERS.includes(identity.name || "")
  const { names: projectManagerOptions, loading: projectManagerOptionsLoading } = useDepartmentMemberNames({
    departmentNames: ["客户成功"],
    managedOnly: isProjectManagerLeader,
  })

  useEffect(() => {
    // 列表可能尚未 compose attachments；进详情始终按 id 拉一次，避免缺字段崩溃/空附件
    let cancelled = false
    setDetailLoading(true)
    void loadContractById(id).finally(() => {
      if (!cancelled) setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, loadContractById])

  useEffect(() => {
    void ensureOpportunitiesLoaded().catch(() => undefined)
  }, [ensureOpportunitiesLoaded])

  useEffect(() => {
    if (!contract?.customerId) return
    if (getCustomer(contract.customerId)) return
    void loadCustomerById(contract.customerId)
  }, [contract?.customerId, getCustomer, loadCustomerById])

  useEffect(() => {
    if (!contract?.opportunityId) return
    if (getOpportunity(contract.opportunityId)) return
    void loadOpportunityById(contract.opportunityId)
  }, [contract?.opportunityId, getOpportunity, loadOpportunityById])

  if (!contract) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">
          {detailLoading ? "加载合同中…" : "未找到该合同。"}
        </p>
        <Link href="/contracts" className="mt-3 inline-block text-sm text-primary hover:underline">
          返回合同列表
        </Link>
      </div>
    )
  }

  const customer = getCustomer(contract.customerId)
  const linkedOpp = contract.opportunityId ? getOpportunity(contract.opportunityId) : undefined
  const attachments = Array.isArray(contract.attachments) ? contract.attachments : []
  const meta = CONTRACT_STATUS_META[contract.status] ?? CONTRACT_STATUS_META.pending
  const canCompleteSign = contract.status === "pending"
  const canMarkClosed = contract.status === "pending" || contract.status === "signed"
  /** 作废 / 终止的合同不可再编辑字段 */
  const canEditContract = editable && contract.status !== "void" && contract.status !== "terminated"
  const managerRequest = contract.projectManagerRequest
  const canAssignProjectManager = isProjectManagerLeader || role === "admin" || role === "super_admin"

  async function submitManagerRequest() {
    if (!requestedStartDate) return toast.error("请选择希望项目经理介入时间")
    setManagerSaving(true)
    try {
      await updateContract(contract!.id, { projectManagerRequest: { status: "pending", applicant: identity.name || "当前销售", appliedAt: new Date().toISOString(), requestedStartDate, reason: managerRequestReason.trim() } })
      setManagerRequestOpen(false)
      toast.success("已提交，并通知客户成功 Leader")
    } catch (error) { toast.error(error instanceof Error ? error.message : "提交失败") }
    finally { setManagerSaving(false) }
  }

  async function assignProjectManager() {
    const projectManager = assignedManagers[assignedManagers.length - 1]
    if (!projectManager) return toast.error("请选择项目经理")
    setManagerSaving(true)
    try {
      await updateContract(contract!.id, { projectManagerRequest: { ...(managerRequest || { status: "pending", applicant: identity.name || "当前用户", appliedAt: new Date().toISOString() }), status: "assigned", projectManager, assignedBy: identity.name || "当前 Leader", assignedAt: new Date().toISOString() } })
      setManagerAssignOpen(false)
      toast.success("已完成分配，并提前创建待启动项目")
    } catch (error) { toast.error(error instanceof Error ? error.message : "分配失败") }
    finally { setManagerSaving(false) }
  }

  async function handleAttachmentsUploaded(
    items: Array<{
      id: string
      name: string
      size: number
      url: string
      contentType?: string
      storagePath?: string
      description: string
    }>,
  ) {
    const author = identity.name || "当前用户"
    for (const file of items) {
      await addContractAttachment(contract!.id, {
        id: file.id,
        name: file.name,
        size: file.size,
        url: file.url,
        contentType: file.contentType,
        storagePath: file.storagePath,
        description: file.description,
        uploadedBy: author,
        kind: uploadKind,
      })
    }
    toast.success(`已上传 ${items.length} 个附件`)
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 lg:px-8">
      <Link
        href="/contracts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回合同列表
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{contract.name}</h1>
            <Pill label={meta.label} tone={meta.tone} />
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{contract.code || "-"}</p>
        </div>
        {(canEditContract || managerRequest) && (
          <div className="flex flex-wrap items-center gap-2">
            {!managerRequest && canEditContract ? (
              <Button className="gap-1.5" onClick={() => setManagerRequestOpen(true)}>
                <UserRoundPlus className="size-4" />
                申请项目经理
              </Button>
            ) : null}
            {managerRequest?.status === "pending" && canAssignProjectManager ? (
              <Button className="gap-1.5" onClick={() => { setAssignedManagers([]); setManagerAssignOpen(true) }}>
                <UserRoundPlus className="size-4" />
                分配项目经理
              </Button>
            ) : null}
            {managerRequest?.status === "pending" && !canAssignProjectManager ? (
              <Button variant="outline" onClick={() => setActiveTab("project-manager")}>待分配项目经理</Button>
            ) : null}
            {managerRequest?.status === "assigned" ? (
              <Button variant="outline" onClick={() => setActiveTab("project-manager")}>已分配：{managerRequest.projectManager || "项目经理"}</Button>
            ) : null}
            {canEditContract ? <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              编辑合同
            </Button> : null}
            {canEditContract && canCompleteSign && (
              <Button
                className="gap-1.5"
                onClick={() => {
                  if (!hasContractFileAttachment(attachments)) {
                    toast.error("完成签署前请先上传合同附件")
                    return
                  }
                  setSignOpen(true)
                }}
              >
                <Check className="size-4" />
                完成签署
              </Button>
            )}
            {canEditContract && canMarkClosed && (
              <>
                <Button
                  variant="outline"
                  className="gap-1.5 border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                  onClick={() => setStatusAction("void")}
                >
                  <Ban className="size-4" />
                  已作废
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                  onClick={() => setStatusAction("terminated")}
                >
                  已终止
                </Button>
              </>
            )}
            {canEditContract && contract.status === "signed" && (
              <SearchableSelect
                value={contract.projectStatus}
                onChange={async (projectStatus) => {
                  await updateContract(contract.id, { projectStatus: projectStatus as ProjectStatus })
                  toast.success("项目状态已更新")
                }}
                options={PROJECT_OPTIONS.map((s) => ({
                  value: s,
                  label: `项目：${PROJECT_STATUS_META[s].label}`,
                }))}
                className="w-44"
                placeholder="项目状态"
              />
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="sign">签约信息</TabsTrigger>
          <TabsTrigger value="amount">金额与周期</TabsTrigger>
          {canViewPayments && <TabsTrigger value="payments">回款计划</TabsTrigger>}
          <TabsTrigger value="project-manager">项目经理介入{managerRequest ? `（${managerRequest.status === "assigned" ? "已分配" : "待分配"}）` : ""}</TabsTrigger>
          <TabsTrigger value="files">附件 ({attachments.length})</TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-3.5 opacity-70" />
            <EntityAuditCount entityId={contract.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl>
              <InfoRow label="合同名称">{contract.name}</InfoRow>
              <InfoRow label="合同编号">{contract.code || "-"}</InfoRow>
              <InfoRow label="客户">
                {customer ? (
                  <Link href={`/customers/${customer.id}`} className="text-primary hover:underline">
                    {contract.company}
                  </Link>
                ) : (
                  contract.company
                )}
              </InfoRow>
              <InfoRow label="所在地区">
                {contract.region} · {contract.city}
              </InfoRow>
              <InfoRow label="合同类型">{contract.type}</InfoRow>
              <InfoRow label="签约类型">{contract.signType}</InfoRow>
              <InfoRow label="合同来源">{contract.source || "—"}</InfoRow>
              <InfoRow label="合同状态">
                <Pill label={meta.label} tone={meta.tone} />
              </InfoRow>
              {(contract.status === "void" || contract.status === "terminated") && (
                <InfoRow label={contract.status === "void" ? "作废原因" : "终止原因"}>
                  {contract.statusReason || "—"}
                </InfoRow>
              )}
              <InfoRow label="项目状态">
                <Pill
                  label={PROJECT_STATUS_META[contract.projectStatus]?.label ?? contract.projectStatus ?? "—"}
                  tone={PROJECT_STATUS_META[contract.projectStatus]?.tone ?? "muted"}
                />
              </InfoRow>
              <RelatedProjectLinks contractId={contract.id} />
              <InfoRow label="关联商机">
                {linkedOpp ? (
                  <Link href={`/opportunities/${linkedOpp.id}`} className="text-primary hover:underline">
                    {linkedOpp.name}
                  </Link>
                ) : contract.opportunityId ? (
                  <span className="text-muted-foreground">已绑定（商机不可见或不存在）</span>
                ) : (
                  <span className="text-muted-foreground">未绑定，请在编辑中选择商机</span>
                )}
              </InfoRow>
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="sign" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl>
              <InfoRow label="我方签约主体">{contract.ourSignSubject || "—"}</InfoRow>
              <InfoRow label="客户签约主体">{contract.customerSignSubject || contract.signSubject || "—"}</InfoRow>
              <InfoRow label="合同签订人">{contract.signer || "—"}</InfoRow>
              <InfoRow label="联系人姓名">{contract.signerContactName || "—"}</InfoRow>
              <InfoRow label="联系人电话">{contract.signerContactPhone || "—"}</InfoRow>
              <InfoRow label="联系人地址">{contract.signerContactAddress || "—"}</InfoRow>
              <InfoRow label="联系人邮箱">{contract.signerContactEmail || "—"}</InfoRow>
              <InfoRow label="开票信息">{contract.invoiceInfo || "—"}</InfoRow>
              <InfoRow label="销售负责人">{contractOwnerNames(contract).join(", ") || "—"}</InfoRow>
              <InfoRow label="直属上级（合同签订人）">{contract.signerManager || "—"}</InfoRow>
              <InfoRow label="签约部门">{contract.dept || "—"}</InfoRow>
              <InfoRow label="双方签署日期">{contract.dualSignDate || "—"}</InfoRow>
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="amount" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl>
              <InfoRow label="合同金额">
                <span className="text-base font-semibold">{money(contract.amount)}</span>
              </InfoRow>
              <InfoRow label="生效日期">{contract.effectiveDate || "—"}</InfoRow>
              <InfoRow label="有效期">{contract.validMonths ? `${contract.validMonths} 个月` : "—"}</InfoRow>
              <InfoRow label="到期日期">{contract.endDate || "—"}</InfoRow>
            </dl>
          </div>
        </TabsContent>

        {canViewPayments && (
          <TabsContent value="payments" className="mt-4">
            <ContractPaymentPlanTab contract={contract} />
          </TabsContent>
        )}

        <TabsContent value="project-manager" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 dark:border-blue-900/50 dark:bg-blue-950/20"><div className="flex items-start gap-3"><BellRing className="mt-0.5 size-5 text-blue-600" /><div><h2 className="font-medium">合同签署前也可申请项目经理提前介入</h2><p className="mt-1 text-sm text-muted-foreground">销售提交申请 → 演示成员18 / 演示成员20 / 演示成员19收到通知 → 任一 Leader 分配下属 → 系统立即创建“待启动”项目，不再等待合同签署。</p></div></div></div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">当前状态</p><div className="mt-2">{managerRequest ? <Pill label={managerRequest.status === "assigned" ? "已分配项目经理" : "待客户成功 Leader 分配"} tone={managerRequest.status === "assigned" ? "success" : "warning"} /> : <Pill label="未申请" tone="muted" />}</div></div><div className="flex gap-2">{canEditContract && !managerRequest ? <Button onClick={() => setManagerRequestOpen(true)}><UserRoundPlus className="mr-1.5 size-4" />申请项目经理</Button> : null}{canAssignProjectManager && managerRequest?.status === "pending" ? <Button onClick={() => { setAssignedManagers([]); setManagerAssignOpen(true) }}>分配项目经理</Button> : null}</div></div>
            {managerRequest ? <dl className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2"><InfoRow label="申请人">{managerRequest.applicant}</InfoRow><InfoRow label="希望介入时间">{managerRequest.requestedStartDate || "—"}</InfoRow><InfoRow label="申请原因">{managerRequest.reason || "—"}</InfoRow><InfoRow label="项目经理">{managerRequest.projectManager || "待分配"}</InfoRow><InfoRow label="分配人">{managerRequest.assignedBy || "—"}</InfoRow><InfoRow label="分配时间">{managerRequest.assignedAt ? new Date(managerRequest.assignedAt).toLocaleString("zh-CN") : "—"}</InfoRow></dl> : null}
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  合同附件
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  可上传合同扫描件、SOW 等签署材料。完成签署前须至少有一份「合同」附件。
                </p>
              </div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setUploadKind("contract")
                      setUploadOpen(true)
                    }}
                  >
                    <Upload className="size-4" />
                    上传合同
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setUploadKind("sow")
                      setUploadOpen(true)
                    }}
                  >
                    <Upload className="size-4" />
                    上传 SOW
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2.5">
              {attachments.length === 0 ? (
                <EmptyState text="暂无附件" />
              ) : (
                [...attachments].reverse().map((attachment) => (
                  <CrmAttachmentRow
                    key={attachment.id}
                    attachment={{
                      id: attachment.id,
                      name: attachment.name,
                      size: attachment.size ?? 0,
                      uploadedAt: attachment.uploadedAt ?? "",
                      uploadedBy: attachment.uploadedBy ?? "",
                      url: attachment.url,
                      contentType: attachment.contentType,
                      description: attachment.description,
                    }}
                    badge={{
                      label: attachment.kind === "sow" ? "SOW" : "合同",
                      tone: "info",
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-4 flex h-[min(36rem,calc(100dvh-18rem))] min-h-[20rem] flex-col overflow-hidden"
        >
          <EntityAuditHistory entityId={contract.id} embedded />
        </TabsContent>
      </Tabs>

      {signOpen && (
        <SignContractDialog contract={contract} open={signOpen} onOpenChange={setSignOpen} />
      )}
      {editOpen && canEditContract && (
        <EditContractDialog contract={contract} open={editOpen} onOpenChange={setEditOpen} />
      )}
      {statusAction && (
        <ContractStatusReasonDialog
          contract={contract}
          targetStatus={statusAction}
          open={Boolean(statusAction)}
          onOpenChange={(open) => {
            if (!open) setStatusAction(null)
          }}
        />
      )}
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title={uploadKind === "sow" ? "上传 SOW 文档" : "上传合同文件"}
        description="请为每个附件填写用途说明。"
        onUploaded={handleAttachmentsUploaded}
      />
      <Dialog open={managerRequestOpen} onOpenChange={setManagerRequestOpen}>
        <DialogContent><DialogHeader><DialogTitle>申请项目经理</DialogTitle><DialogDescription>合同无需先完成签署。提交后系统通知客户成功 Leader，由其中一位分配下属项目经理。</DialogDescription></DialogHeader><div className="space-y-4"><label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">希望介入时间 *</span><DatePicker value={requestedStartDate} onChange={setRequestedStartDate} /></label><label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">申请说明</span><Textarea rows={4} value={managerRequestReason} onChange={(event)=>setManagerRequestReason(event.target.value)} placeholder="例如：客户希望下周提前对齐启动会与资料清单" /></label></div><DialogFooter><Button variant="outline" onClick={()=>setManagerRequestOpen(false)}>取消</Button><Button disabled={managerSaving} onClick={()=>void submitManagerRequest()}>{managerSaving?"提交中…":"提交并通知 Leader"}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={managerAssignOpen} onOpenChange={setManagerAssignOpen}>
        <DialogContent><DialogHeader><DialogTitle>分配项目经理</DialogTitle><DialogDescription>请选择当前 Leader 管辖范围内的客户成功成员；确认后系统立即创建待启动项目。</DialogDescription></DialogHeader><MemberPicker label="项目经理（单选）" value={assignedManagers} onChange={(values)=>setAssignedManagers(values.slice(-1))} options={projectManagerOptions} disabled={projectManagerOptionsLoading} placeholder={projectManagerOptionsLoading ? "正在加载可分配下属…" : "请选择项目经理"} emptyText="未找到当前 Leader 可分配的下属" /><DialogFooter><Button variant="outline" onClick={()=>setManagerAssignOpen(false)}>取消</Button><Button disabled={managerSaving || projectManagerOptionsLoading} onClick={()=>void assignProjectManager()}>{managerSaving?"分配中…":"确认分配并创建项目"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  )
}

function ContractStatusReasonDialog({
  contract,
  targetStatus,
  open,
  onOpenChange,
}: {
  contract: Contract
  targetStatus: Extract<ContractStatus, "void" | "terminated">
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { updateContract } = useCrm()
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const isVoid = targetStatus === "void"
  const statusLabel = isVoid ? "已作废" : "已终止"
  const title = isVoid ? "确认作废合同" : "确认终止合同"
  const reasonLabel = isVoid ? "作废原因" : "终止原因"
  const successText = isVoid ? "合同已作废" : "合同已终止"

  async function submit() {
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error(`请填写${reasonLabel}`)
      return
    }
    setSubmitting(true)
    try {
      await updateContract(contract.id, {
        status: targetStatus,
        statusReason: trimmed,
      })
      onOpenChange(false)
      toast.success(successText)
    } catch {
      // updateContract 已 toast
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-700">{title}</DialogTitle>
          <DialogDescription>
            确认后合同状态将变为「{statusLabel}」，并记入历史操作记录。请填写原因后继续。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          此操作会影响合同有效状态，请确认信息无误后再提交。
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {reasonLabel} <span className="text-destructive">*</span>
          </label>
          <Textarea
            rows={4}
            placeholder={isVoid ? "例如：双方协商取消 / 条款无法达成一致" : "例如：履约中止 / 客户业务调整"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "提交中…" : `确认${isVoid ? "作废" : "终止"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditContractDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { updateContract, opportunities } = useCrm()
  const [form, setForm] = useState({
    name: contract.name || "",
    code: contract.code || "",
    region: contract.region || "",
    city: contract.city || "",
    type: contract.type || "",
    signType: contract.signType || "",
    source: contract.source || "",
    opportunityId: contract.opportunityId || "",
    ourSignSubject: contract.ourSignSubject || "北京 GEO 智营科技有限公司",
    customerSignSubject: contract.customerSignSubject || contract.signSubject || "",
    signer: contract.signer || "",
    signerContactName: contract.signerContactName || "",
    signerContactPhone: contract.signerContactPhone || "",
    signerContactAddress: contract.signerContactAddress || "",
    signerContactEmail: contract.signerContactEmail || "",
    invoiceInfo: contract.invoiceInfo || "",
    owners: contractOwnerNames(contract),
    signerManager: contract.signerManager || "",
    dept: contract.dept || "",
    amount: contract.amount ? String(contract.amount) : "",
    dualSignDate: contract.dualSignDate || "",
    effectiveDate: contract.effectiveDate || "",
    validMonths: contract.validMonths ? String(contract.validMonths) : "",
  })
  const [managerLoading, setManagerLoading] = useState(false)
  const { names: salesOptions } = useSalesNames(
    [form.signer, ...form.owners].filter(Boolean),
  )
  const signerOptions = useMemo(() => {
    const set = new Set(salesOptions)
    if (form.signer) set.add(form.signer)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [salesOptions, form.signer])

  const customerOpps = useMemo(() => {
    return opportunities
      .filter((o) => o.customerId === contract.customerId && o.stage !== "lost")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  }, [opportunities, contract.customerId])

  function setRegion(region: string) {
    setForm((current) => ({ ...current, ...applyRegionCityChange(current, { region }) }))
  }

  function setCity(city: string) {
    setForm((current) => ({ ...current, ...applyRegionCityChange(current, { city }) }))
  }

  async function applySigner(signer: string) {
    setForm((prev) => ({ ...prev, signer }))
    const name = signer.trim()
    if (!name) {
      setForm((prev) => ({ ...prev, signer: "", signerManager: "" }))
      return
    }
    setManagerLoading(true)
    try {
      const result = await fetchDirectManagerByName(name)
      setForm((prev) => ({
        ...prev,
        signer: name,
        signerManager: result.managerName || "",
      }))
      if (!result.managerName && result.message) {
        toast.message(result.message)
      }
    } catch (err) {
      setForm((prev) => ({ ...prev, signer: name }))
      toast.error(err instanceof Error ? err.message : "查询直属上级失败，请手动填写")
    } finally {
      setManagerLoading(false)
    }
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error("请填写合同名称")
      return
    }
    const months = Number(form.validMonths) || 0
    let endDate = contract.endDate
    if (form.effectiveDate && months) {
      const end = new Date(form.effectiveDate)
      end.setMonth(end.getMonth() + months)
      endDate = end.toISOString().slice(0, 10)
    }
    await updateContract(contract.id, {
      name: form.name.trim(),
      code: form.code.trim() || contract.code,
      region: form.region.trim(),
      city: form.city.trim(),
      type: form.type.trim(),
      signType: form.signType.trim(),
      source: form.source.trim(),
      opportunityId: form.opportunityId || "",
      signSubject: form.customerSignSubject.trim(),
      ourSignSubject: form.ourSignSubject.trim(),
      customerSignSubject: form.customerSignSubject.trim(),
      signer: form.signer.trim(),
      signerContactName: form.signerContactName.trim(),
      signerContactPhone: form.signerContactPhone.trim(),
      signerContactAddress: form.signerContactAddress.trim(),
      signerContactEmail: form.signerContactEmail.trim(),
      invoiceInfo: form.invoiceInfo.trim(),
      owner: form.owners[0] || "",
      owners: form.owners,
      signerManager: form.signerManager.trim(),
      dept: form.dept.trim(),
      amount: Number(form.amount) || 0,
      dualSignDate: form.dualSignDate,
      effectiveDate: form.effectiveDate,
      validMonths: months,
      endDate,
    })
    onOpenChange(false)
    toast.success("合同信息已更新")
  }

  const field = (label: string, key: keyof typeof form, opts?: { numeric?: boolean }) => (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input
        inputMode={opts?.numeric ? "numeric" : undefined}
        value={form[key]}
        onChange={(e) =>
          setForm({ ...form, [key]: opts?.numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value })
        }
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑合同字段</DialogTitle>
          <DialogDescription>
            修改基本信息、地区、签约信息与金额周期。客户与合同状态请通过详情页专用操作变更。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("合同名称", "name")}
            {field("合同编号", "code")}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">区域</label>
              <SearchableSelect
                value={form.region}
                onChange={setRegion}
                options={toSelectOptions([...REGIONS])}
                placeholder="选择区域"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">城市</label>
              <SearchableSelect
                value={form.city}
                onChange={setCity}
                options={cityOptionsForRegion(form.region, form.city)}
                placeholder="选择城市"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">关联商机</label>
            <SearchableSelect
              value={form.opportunityId || "__none__"}
              onChange={(v) => setForm({ ...form, opportunityId: !v || v === "__none__" ? "" : v })}
              options={[
                { value: "__none__", label: "暂不绑定" },
                ...customerOpps.map((o) => ({ value: o.id, label: o.name })),
              ]}
              placeholder="选择关联商机"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">合同类型</label>
              <SearchableSelect
                value={form.type}
                onChange={(type) => setForm({ ...form, type })}
                options={toSelectOptions(CONTRACT_TYPES)}
                placeholder="选择合同类型"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">签约类型</label>
              <SearchableSelect
                value={form.signType}
                onChange={(signType) => setForm({ ...form, signType })}
                options={toSelectOptions(SIGN_TYPES)}
                placeholder="选择签约类型"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同来源</label>
            <SearchableSelect
              value={form.source}
              onChange={(source) => setForm({ ...form, source })}
              options={toSelectOptions(CONTRACT_SOURCES)}
              placeholder="选择合同来源"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("我方签约主体", "ourSignSubject")}
            {field("客户签约主体", "customerSignSubject")}
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同签订人</label>
            <SearchableSelect
              value={form.signer}
              onChange={(v) => void applySigner(v)}
              options={toSelectOptions(signerOptions)}
              placeholder="选择签订人"
            />
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="mb-3 text-xs font-medium text-foreground">联系人信息</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("姓名", "signerContactName")}
              {field("电话", "signerContactPhone")}
              {field("地址", "signerContactAddress")}
              {field("邮箱", "signerContactEmail")}
            </div>
            <div className="mt-3">{field("开票信息", "invoiceInfo")}</div>
          </div>
          <MemberPicker
            value={form.owners}
            onChange={(owners) => setForm({ ...form, owners })}
            options={salesOptions}
            label="销售负责人（可多选）"
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              直属上级（合同签订人）{managerLoading ? "（查询中…）" : "（随签订人自动带入，可改）"}
            </label>
            <Input
              value={form.signerManager}
              onChange={(e) => setForm({ ...form, signerManager: e.target.value })}
              placeholder={managerLoading ? "正在查询直属上级…" : "选择签订人后自动带入"}
              disabled={managerLoading}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("签约部门", "dept")}
            {field("合同金额（元）", "amount", { numeric: true })}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">双方签署日期</label>
              <DatePicker
                value={form.dualSignDate}
                onChange={(dualSignDate) => setForm({ ...form, dualSignDate })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">生效日期</label>
              <DatePicker
                value={form.effectiveDate}
                onChange={(effectiveDate) => setForm({ ...form, effectiveDate })}
              />
            </div>
          </div>
          {field("有效期（月）", "validMonths", { numeric: true })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SignContractDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { updateContract } = useCrm()
  const [form, setForm] = useState({
    amount: contract.amount ? String(contract.amount) : "",
    dualSignDate: contract.dualSignDate || new Date().toISOString().slice(0, 10),
    effectiveDate: contract.effectiveDate || new Date().toISOString().slice(0, 10),
    validMonths: contract.validMonths ? String(contract.validMonths) : "12",
    code: contract.code || "",
  })

  async function submit() {
    if (!hasContractFileAttachment(contract.attachments ?? [])) {
      toast.error("完成签署前请先上传合同附件")
      return
    }
    const months = Number(form.validMonths) || 0
    let endDate = ""
    if (form.effectiveDate && months) {
      const end = new Date(form.effectiveDate)
      end.setMonth(end.getMonth() + months)
      endDate = end.toISOString().slice(0, 10)
    }
    const linkedOpp = await updateContract(contract.id, {
      status: "signed",
      statusReason: "",
      amount: Number(form.amount) || 0,
      dualSignDate: form.dualSignDate,
      effectiveDate: form.effectiveDate,
      validMonths: months,
      endDate,
      code: form.code.trim() || contract.code,
    })
    onOpenChange(false)
    if (contract.opportunityId && linkedOpp?.stage === "won") {
      toast.success("合同已完成签署，关联商机已自动变为已签订")
    } else if (contract.opportunityId) {
      toast.success("合同已完成签署（关联商机未自动推进，请刷新商机详情核对）")
    } else {
      toast.success("合同已完成签署")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>完成签署</DialogTitle>
          <DialogDescription>
            确认签署信息后，合同状态将变为「已签订」。若已关联商机，商机将自动推进至「已签订」。签署前须已上传合同附件。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同编号</label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同金额（元）</label>
            <Input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">双方签署日期</label>
            <DatePicker
              value={form.dualSignDate}
              onChange={(dualSignDate) => setForm({ ...form, dualSignDate })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">生效日期</label>
            <DatePicker
              value={form.effectiveDate}
              onChange={(effectiveDate) => setForm({ ...form, effectiveDate })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">有效期（月）</label>
            <Input
              inputMode="numeric"
              value={form.validMonths}
              onChange={(e) => setForm({ ...form, validMonths: e.target.value.replace(/[^0-9]/g, "") })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()}>确认签署</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
