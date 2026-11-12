"use client"

import { EntityAuditCount,EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { canDo } from "@/modules/auth/lib/permissions"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import { AttachmentUploadDialog } from "@/modules/crm/components/attachment-upload-dialog"
import { FollowUpComposer,FollowUpRecords } from "@/modules/crm/components/follow-up-panel"
import { MemberPicker,MentionTextarea } from "@/modules/crm/components/member-picker"
import {
AdvanceOpportunityDialog,
AssignAdvisorDialog,
EditOpportunityDialog,
LostOpportunityDialog,
} from "@/modules/crm/components/opportunity-actions"
import { TeamCollaborationCard } from "@/modules/crm/components/team-collaboration-card"
import { EmptyState,InfoRow,Pill } from "@/modules/crm/components/ui"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { ROLE_META,useRole } from "@/modules/crm/hooks/use-crm-access"
import { useDepartmentMemberNames,useMentionNames } from "@/modules/crm/hooks/use-directory-options"
import {
CONTRACT_STATUS_META,
OPP_FLOW_STAGES,
OPP_STAGE_META,
goalOrPlatform,
money,
normalizeOppStage,
type OppStage,
} from "@/modules/crm/lib/crm-data"
import { chinaDateISO } from "@/shared/lib/datetime"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { DatePicker } from "@/shared/ui/date-picker"
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/shared/ui/dialog"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/shared/ui/tabs"
import { Textarea } from "@/shared/ui/textarea"
import {
ArrowLeft,
Ban,
BellRing,
Check,
Clock3,
History,
MessageSquarePlus,
Paperclip,
Pencil,
Upload,
UserCog,
UserRoundPlus
} from "lucide-react"
import Link from "next/link"
import { useEffect,useState } from "react"
import { toast } from "sonner"
import { channelContractUrl,fetchChannelResource,type ChannelContract } from "../services/channel-management"

// 正向阶段流转顺序（与飞书 1:1，不含输单）
const FLOW: OppStage[] = OPP_FLOW_STAGES
const PROJECT_MANAGER_LEADERS = ["演示成员18", "演示成员20", "演示成员19"]

type OppTab = "overview" | "notes" | "advisor" | "files" | "history"

const RECENT_NOTE_LIMIT = 2

function formatStageTime(value?: string | null) {
  if (!value) return "—"
  return value.replace("T", " ")
}

function durationLabel(start?: string | null, end?: string | null) {
  if (!start) return "—"
  const startAt = new Date(start).getTime()
  if (Number.isNaN(startAt)) return "—"
  const endAt = end ? new Date(end).getTime() : Date.now()
  if (end && Number.isNaN(endAt)) return "—"
  const hours = Math.max(0, Math.floor((endAt - startAt) / 3600000))
  if (hours < 24) return `${Math.max(1, hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

function localToday(): string {
  return chinaDateISO()
}

export function OpportunityDetail({ id }: { id: string }) {
  const {
    getOpportunity,
    getCustomer,
    addOpportunityNote,
    addAdvisorNote,
    addOpportunityAttachment,
    updateOpportunity,
    contracts,
    loadOpportunityById,
    loadCustomerById,
    ensureContractsLoaded,
  } = useCrm()
  const { canEditAdvisor, identity, role, user } = useRole()
  const editable = canDo(user?.permissions ?? [], "opportunities:stage", "opportunities:write")
  const canAssignAdvisor = canDo(user?.permissions ?? [], "opportunities:assign_advisor")
  const opp = getOpportunity(id)
  const { canAccess } = useAuth()
  const canViewPartnerContract = canAccess("contracts") && canAccess("channels")
  const [partnerContract, setPartnerContract] = useState<ChannelContract | null>(null)
  useEffect(() => {
    let active = true
    setPartnerContract(null)
    if (opp?.partnerId && canViewPartnerContract) void fetchChannelResource<ChannelContract[]>(opp.partnerId, "contracts").then((rows) => { if (active) setPartnerContract(rows.find((row) => row.opportunityId === id) || null) }).catch(() => undefined)
    return () => { active = false }
  }, [opp?.partnerId, opp?.stage, id, canViewPartnerContract])
  const { names: staffNames } = useMentionNames("opportunities", id)
  const isProjectManagerLeader = PROJECT_MANAGER_LEADERS.includes(identity.name || "")
  const { names: projectManagerOptions, loading: projectManagerOptionsLoading } = useDepartmentMemberNames({
    departmentNames: ["客户成功"],
    managedOnly: isProjectManagerLeader,
  }, opp?.projectManagerRequest?.projectManager ? [opp.projectManagerRequest.projectManager] : [])
  const [detailLoading, setDetailLoading] = useState(false)

  const [tab, setTab] = useState<OppTab>("overview")
  const [note, setNote] = useState("")
  const [noteMentions, setNoteMentions] = useState<string[]>([])
  const [noteNextFollowAt, setNoteNextFollowAt] = useState("")
  const [advisorNote, setAdvisorNote] = useState("")
  const [advisorMentions, setAdvisorMentions] = useState<string[]>([])
  const [lostOpen, setLostOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [assignAdvisorOpen, setAssignAdvisorOpen] = useState(false)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [managerRequestOpen, setManagerRequestOpen] = useState(false)
  const [managerAssignOpen, setManagerAssignOpen] = useState(false)
  const [managerReason, setManagerReason] = useState("")
  const [managerSaving, setManagerSaving] = useState(false)
  const [managerSelection, setManagerSelection] = useState<string[]>([])

  useEffect(() => {
    if (opp) return
    let cancelled = false
    setDetailLoading(true)
    void loadOpportunityById(id).finally(() => {
      if (!cancelled) setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, opp, loadOpportunityById])

  useEffect(() => {
    void ensureContractsLoaded().catch(() => undefined)
  }, [ensureContractsLoaded])

  useEffect(() => {
    if (!opp?.customerId) return
    if (getCustomer(opp.customerId)) return
    void loadCustomerById(opp.customerId)
  }, [opp?.customerId, getCustomer, loadCustomerById])

  if (!opp) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">
          {detailLoading ? "加载商机中…" : "未找到该商机。"}
        </p>
        <Link href="/opportunities" className="mt-3 inline-block text-sm text-primary hover:underline">
          返回商机列表
        </Link>
      </div>
    )
  }

  const customer = getCustomer(opp.customerId)
  const sourceLabel = opp.businessType === "channel" ? "渠道" : opp.businessType === "strategic_ecosystem" ? "战略生态" : "直客"
  const partnerHref = (opp.businessType === "strategic_ecosystem" ? "/ecosystems/" : "/channels/") + opp.partnerId
  const linkedContract = contracts.find((c) => c.opportunityId === opp.id)
  const stageNow = normalizeOppStage(opp.stage)
  const meta = OPP_STAGE_META[stageNow]
  const isClosed = stageNow === "won" || stageNow === "lost"
  const currentIndex = FLOW.indexOf(stageNow)
  const canRequestProjectManager = currentIndex >= FLOW.indexOf("bidding") && stageNow !== "lost"
  const canAssignProjectManager = isProjectManagerLeader || role === "admin" || role === "super_admin"
  const nextStage = currentIndex >= 0 && currentIndex < FLOW.length - 1 ? FLOW[currentIndex + 1] : null
  const stageHistory = opp.stageHistory ?? []
  const currentStageRecord = [...stageHistory].reverse().find((item) => normalizeOppStage(item.stage) === stageNow)
  const author = identity.name || ROLE_META[role]?.label || String(role)
  const attachments = opp.attachments ?? []
  const canManageOpportunityTeam =
    editable || identity.name === opp.owner || role === "admin" || role === "super_admin"

  async function submitProjectManagerRequest() {
    if (!opp) return
    setManagerSaving(true)
    try {
      await updateOpportunity(opp.id, {
        projectManagerRequest: {
          status: "pending",
          applicant: identity.name || "当前销售",
          applicantUserId: user?.id,
          appliedAt: new Date().toISOString(),
          reason: managerReason.trim(),
        },
      })
      setManagerRequestOpen(false)
      setManagerReason("")
      toast.success("已提交，项目经理 Leader 会收到分配通知")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "申请失败")
    } finally {
      setManagerSaving(false)
    }
  }

  async function assignOpportunityProjectManager() {
    if (!opp) return
    const projectManager = managerSelection[managerSelection.length - 1]
    if (!projectManager) return toast.error("请选择项目经理")
    setManagerSaving(true)
    try {
      const request = opp.projectManagerRequest
      if (!request || request.status !== "pending") {
        toast.error("当前没有待分配申请")
        return
      }
      await updateOpportunity(opp.id, {
        projectManagerRequest: {
          ...request,
          status: "assigned",
          projectManager,
          assignedBy: identity.name || "项目经理 Leader",
          assignedAt: new Date().toISOString(),
        },
      })
      setManagerSelection([])
      setManagerAssignOpen(false)
      toast.success("已分配项目经理")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分配失败")
    } finally {
      setManagerSaving(false)
    }
  }

  async function submitNote() {
    if (!opp) return
    if (!note.trim()) {
      toast.error("请输入跟进内容")
      return
    }
    const planned = noteNextFollowAt.slice(0, 10)
    const minFollowDate = localToday()
    if (planned && planned < minFollowDate) {
      toast.error("下次计划跟进不能早于今天")
      return
    }
    await addOpportunityNote(opp.id, note.trim(), {
      author,
      mentions: noteMentions,
      nextFollowAt: planned,
    })
    setNote("")
    setNoteMentions([])
    setNoteNextFollowAt("")
    toast.success(
      planned
        ? `跟进已记录，已安排下次跟进 ${planned}`
        : opp.nextFollowAt
          ? "跟进已记录，原下次跟进计划已清除"
          : "跟进记录已添加",
    )
  }

  async function submitAdvisorNote() {
    if (!opp) return
    if (!advisorNote.trim()) {
      toast.error("请输入顾问反馈内容")
      return
    }
    await addAdvisorNote(opp.id, advisorNote.trim(), { author, mentions: advisorMentions })
    setAdvisorNote("")
    setAdvisorMentions([])
    toast.success("顾问反馈已添加")
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
    if (!opp) return
    for (const file of items) {
      await addOpportunityAttachment(opp.id, {
        id: file.id,
        name: file.name,
        size: file.size,
        url: file.url,
        contentType: file.contentType,
        storagePath: file.storagePath,
        description: file.description,
        uploadedBy: author,
      })
    }
    setTab("files")
    toast.success(`已上传 ${items.length} 个附件`)
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-6 lg:px-8">
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回商机列表
      </Link>

      {/* 页头摘要：切 Tab 时始终可见 */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{opp.name}</h1>
              <Pill label={meta.label} tone={meta.tone} /><Pill label={sourceLabel} tone="neutral" />
              {currentStageRecord && (
                <Pill label={`当前阶段停滞 ${durationLabel(currentStageRecord.enteredAt)}`} tone="warning" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {customer && (
                <Link href={`/customers/${customer.id}`} className="hover:text-foreground hover:underline">
                  {customer.brandName || customer.companyName}
                </Link>
              )}
              {opp.partnerId && (canAccess("channels") ? <Link href={partnerHref} className="hover:underline">{opp.partnerName || opp.brandName}</Link> : <span>{opp.partnerName || opp.brandName}</span>)}
              {" · "}
              {opp.projectTypes.join(" / ") || "未选项目类型"} · 负责人：{opp.owner}
              {opp.advisor ? ` · 顾问：${opp.advisor}` : ""}
              {opp.customerSuccess ? ` · 客户成功：${opp.customerSuccess}` : ""}
            </p>
          </div>

          {!isClosed && editable && (
            <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
              <Button variant="outline" className="shrink-0 gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                编辑
              </Button>
              <Button
                variant="outline"
                className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setLostOpen(true)}
              >
                <Ban className="size-4" />
                标记输单
              </Button>
              {nextStage && (
                <Button className="shrink-0 gap-1.5" onClick={() => setAdvanceOpen(true)}>
                  <Check className="size-4" />
                  推进至{OPP_STAGE_META[nextStage].label}
                </Button>
              )}
            </div>
          )}
          {!isClosed && canAssignAdvisor && (
            <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
              <Button
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => setAssignAdvisorOpen(true)}
              >
                <UserCog className="size-4" />
                分配售前顾问
              </Button>
            </div>
          )}
        </div>
        {opp.projectManagerRequest ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm">
            <div className="flex items-start gap-2.5">
              <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  {opp.projectManagerRequest.status === "assigned" ? "项目经理已分配" : "项目经理申请待分配"}
                  {opp.projectManagerRequest.projectManager ? `：${opp.projectManagerRequest.projectManager}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  申请人：{opp.projectManagerRequest.applicant} · {formatStageTime(opp.projectManagerRequest.appliedAt)}
                  {opp.projectManagerRequest.reason ? ` · ${opp.projectManagerRequest.reason}` : ""}
                </p>
              </div>
            </div>
            {opp.projectManagerRequest.status === "pending" && canAssignProjectManager && (
              <Button size="sm" onClick={() => setManagerAssignOpen(true)}>
                <UserRoundPlus className="mr-1.5 size-4" />分配项目经理
              </Button>
            )}
          </div>
        ) : canRequestProjectManager && editable ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm">
            <div>
              <p className="font-medium">需要交付团队提前介入？</p>
              <p className="mt-0.5 text-xs text-muted-foreground">招投标阶段起可申请，由项目经理 Leader 审核并分配。</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setManagerRequestOpen(true)}>
              <UserRoundPlus className="mr-1.5 size-4" />申请项目经理
            </Button>
          </div>
        ) : null}
      </div>

      {/* 阶段进度：强制横向步进（inline style，避免 Tailwind flex/grid 工具类未打进 CSS 时变成竖排） */}
      <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-card p-5">
        <div
          className="relative"
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            alignItems: "stretch",
            gap: 8,
            width: "max-content",
            minWidth: "100%",
          }}
        >
          <div
            className="pointer-events-none absolute top-[15px] h-px bg-border"
            style={{ left: 62, right: 62 }}
            aria-hidden
          />
          {FLOW.map((s, i) => {
            const stageNow = normalizeOppStage(opp.stage)
            const done = opp.stage !== "lost" && FLOW.indexOf(stageNow) >= i
            const isCurrent = stageNow === s
            const visits = stageHistory.filter((item) => normalizeOppStage(item.stage) === s)
            const latest = visits.length ? visits[visits.length - 1] : undefined
            return (
              <div
                key={s}
                className="space-y-3"
                style={{ flex: "0 0 128px", width: 128, minWidth: 128, maxWidth: 128 }}
              >
                <div className="flex justify-center">
                  <div
                    className={cn(
                      "relative z-[1] flex max-w-full items-center justify-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-medium",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {done && !isCurrent && <Check className="size-3 shrink-0" />}
                    <span className="truncate">{OPP_STAGE_META[s].label}</span>
                  </div>
                </div>

                <div
                  className={cn(
                    "rounded-lg border bg-secondary/30 p-2.5",
                    isCurrent ? "border-primary/40" : "border-border",
                  )}
                >
                  {latest ? (
                    <>
                      <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="mt-0.5 size-3 shrink-0" />
                        <span className="min-w-0 leading-snug">
                          {latest.leftAt
                            ? `阶段耗时 ${durationLabel(latest.enteredAt, latest.leftAt)}`
                            : `已停滞 ${durationLabel(latest.enteredAt)}`}
                        </span>
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground/70">
                        {formatStageTime(latest.enteredAt)}
                        {latest.leftAt ? ` → ${formatStageTime(latest.leftAt)}` : " · 至今"}
                      </p>
                      {latest.reason && (
                        <p
                          className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-foreground/80"
                          title={latest.reason}
                        >
                          {latest.changeType === "rollback" ? "回退原因" : "原因"}：{latest.reason}
                        </p>
                      )}
                      {visits.length > 1 && (
                        <p className="mt-1 text-[10px] text-muted-foreground">共进入 {visits.length} 次</p>
                      )}
                    </>
                  ) : done ? (
                    <p className="py-1 text-center text-[11px] text-muted-foreground">已随后续阶段一并完成</p>
                  ) : (
                    <p className="py-1 text-center text-[11px] text-muted-foreground">尚未进入</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {opp.stage === "lost" && (
          <div className="mt-3">
            <Pill label="已输单" tone="danger" />
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as OppTab)} className="mt-5 gap-0">
        <TabsList
          variant="line"
          className="flex h-auto w-full flex-wrap justify-start gap-0 rounded-none border-b border-border bg-transparent p-0"
        >
          <TabsTrigger
            value="overview"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            基本信息
          </TabsTrigger>
          <TabsTrigger
            value="notes"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <MessageSquarePlus className="size-3.5 opacity-70" />
            跟进记录
            <span className="ml-1 tabular-nums text-muted-foreground">({opp.notes.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="advisor"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <MessageSquarePlus className="size-3.5 opacity-70" />
            顾问反馈
            <span className="ml-1 tabular-nums text-muted-foreground">({opp.advisorNotes.length})</span>
          </TabsTrigger>

          <TabsTrigger
            value="files"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <Paperclip className="size-3.5 opacity-70" />
            附件
            <span className="ml-1 tabular-nums text-muted-foreground">({attachments.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <History className="size-3.5 opacity-70" />
            <EntityAuditCount entityId={opp.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 outline-none">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-4">
              <h2 className="text-sm font-semibold">基本信息</h2>
              <dl className="mt-1">
                <InfoRow label="商机名称">{opp.name}</InfoRow>
                <InfoRow label="商机来源">{sourceLabel}</InfoRow>
                <InfoRow label="所属客户">
                  {customer?.brandName || customer?.companyName || opp.partnerName || opp.brandName || "—"}
                  {customer?.brandName && customer?.companyName && customer.brandName !== customer.companyName
                    ? `（${customer.companyName}）`
                    : ""}
                </InfoRow>
                <InfoRow label="商机业务主体">
                  {opp.subsidiaryName || `${customer?.companyName || opp.partnerName || "—"}（总部）`}
                </InfoRow>
                <InfoRow label="品牌">{opp.brandName || "—"}</InfoRow>
                <InfoRow label="区域">{opp.region}</InfoRow>
                <InfoRow label="项目类型">
                  <div className="flex flex-wrap gap-1.5">
                    {!opp.projectTypes.length ? (
                      <span>—</span>
                    ) : (
                      opp.projectTypes.map((t) => (
                        <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </InfoRow>
                <InfoRow label="优化目标 / 平台">{goalOrPlatform(opp.goal, opp.platform)}</InfoRow>
                <InfoRow label="优化周期">{opp.period}</InfoRow>
                <InfoRow label="商机金额">
                  <span className="font-semibold">{money(opp.amount)}</span>
                </InfoRow>
                <InfoRow label="成交概率">{opp.probability}%</InfoRow>
                <InfoRow label="预计签约日期">{opp.expectedSignDate || "—"}</InfoRow>
                <InfoRow label="销售负责人">{opp.owner || "—"}</InfoRow>
                <InfoRow label="售前顾问">{opp.advisor || "未指定"}</InfoRow>
                <InfoRow label="客户成功">{opp.customerSuccess || "未指定"}</InfoRow>
                <InfoRow label="创建日期">{opp.createdAt}</InfoRow>
                <InfoRow label="最近跟进">{opp.lastFollowAt || "—"}</InfoRow>
                <InfoRow label="下次计划跟进">
                  {opp.nextFollowAt ? (
                    <span className="font-medium text-amber-700">{opp.nextFollowAt.slice(0, 10)}</span>
                  ) : (
                    <span className="text-muted-foreground">未安排</span>
                  )}
                </InfoRow>
                {opp.stage === "lost" && (
                  <>
                    <InfoRow label="输单阶段">{opp.lostStage || "—"}</InfoRow>
                    <InfoRow label="竞争对手">{opp.competitor || "—"}</InfoRow>
                    <InfoRow label="输单一级原因">{opp.lostReasonL1 || "—"}</InfoRow>
                    <InfoRow label="输单二级原因">{opp.lostReasonL2 || opp.lostReason || "—"}</InfoRow>
                  </>
                )}
              </dl>
              {partnerContract && <div className="rounded-xl border p-4"><p className="mb-2 text-xs text-muted-foreground">关联{sourceLabel}合同</p><Link href={channelContractUrl(partnerContract.id, opp.businessType)} className="text-sm text-primary hover:underline">{partnerContract.name}</Link><span className="ml-3 text-xs text-muted-foreground">{partnerContract.status}</span></div>}
              {linkedContract && (
                <div className="mt-4 rounded-xl bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">关联合同</p>
                  <Link
                    href={`/contracts/${linkedContract.id}`}
                    className="mt-1 inline-flex flex-wrap items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    {linkedContract.name}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Pill
                      label={CONTRACT_STATUS_META[linkedContract.status]?.label ?? linkedContract.status}
                      tone={CONTRACT_STATUS_META[linkedContract.status]?.tone ?? "muted"}
                    />
                    <span className="text-xs text-muted-foreground">
                      合同附件 {linkedContract.attachments?.length ?? 0} 个
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    签署文件在合同详情的「附件」中查看；商机「附件」页只放方案/纪要等材料。
                  </p>
                </div>
              )}
            </section>

            <div className="space-y-5">
              <TeamCollaborationCard
                entityType="opportunity"
                entityId={opp.id}
                entityName={opp.name}
                ownerName={opp.owner || ""}
                ownerDepartment="销售部"
                ownerRoleLabel="商机负责人"
                canManage={canManageOpportunityTeam}
                currentUserName={identity.name || author}
              />
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">跟进记录</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{opp.notes.length}</span>
                    {opp.notes.length > RECENT_NOTE_LIMIT && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => setTab("notes")}
                      >
                        查看全部
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">对照左侧基本信息记录销售进展；此处仅展示最近 {RECENT_NOTE_LIMIT} 条。</p>
                {!isClosed && editable && (
                  <div className="mt-3">
                    <FollowUpComposer
                      footerLeft={
                        opp.nextFollowAt ? (
                          <Pill label={`计划 ${opp.nextFollowAt.slice(0, 10)}`} tone="warning" />
                        ) : null
                      }
                      footerRight={
                        <Button className="shrink-0 gap-1.5" onClick={() => void submitNote()}>
                          <MessageSquarePlus className="size-4" />
                          添加进展
                        </Button>
                      }
                    >
                      <div className="w-full sm:max-w-xs">
                        <label className="mb-1 block text-xs font-medium text-foreground">下次跟进</label>
                        <DatePicker
                          value={noteNextFollowAt}
                          min={localToday()}
                          onChange={(v) => {
                            const day = (v || "").slice(0, 10)
                            if (day && day < localToday()) {
                              toast.error("下次计划跟进不能早于今天")
                              setNoteNextFollowAt(localToday())
                              return
                            }
                            setNoteNextFollowAt(day)
                          }}
                          placeholder="选择日期"
                        />
                      </div>
                      <MentionTextarea
                        rows={3}
                        placeholder="记录商机进展，输入 @ 可提及成员…"
                        value={note}
                        onChange={setNote}
                        onMentionsChange={setNoteMentions}
                        options={staffNames}
                      />
                    </FollowUpComposer>
                  </div>
                )}
                <FollowUpRecords
                  records={[...opp.notes]
                    .reverse()
                    .slice(0, RECENT_NOTE_LIMIT)
                    .map((n) => ({
                      id: n.id,
                      author: n.author,
                      date: n.date,
                      content: n.content,
                      pills: (
                        <>
                          {n.origin === "request" && <Pill label="需求带入" tone="warning" />}
                          {n.nextFollowAt ? (
                            <Pill label={`计划下次 ${n.nextFollowAt.slice(0, 10)}`} tone="warning" />
                          ) : null}
                        </>
                      ),
                    }))}
                />
              </section>

              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">顾问反馈</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{opp.advisorNotes.length}</span>
                    {opp.advisorNotes.length > RECENT_NOTE_LIMIT && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => setTab("advisor")}
                      >
                        查看全部
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">售前评估与方案建议；此处仅展示最近 {RECENT_NOTE_LIMIT} 条。</p>
                {canEditAdvisor && (
                  <div className="mt-3">
                    <FollowUpComposer
                      footerRight={
                        <Button className="shrink-0 gap-1.5" onClick={() => void submitAdvisorNote()}>
                          <MessageSquarePlus className="size-4" />
                          添加反馈
                        </Button>
                      }
                    >
                      <MentionTextarea
                        rows={3}
                        placeholder="记录售前顾问的评估与方案建议，输入 @ 可提及成员…"
                        value={advisorNote}
                        onChange={setAdvisorNote}
                        onMentionsChange={setAdvisorMentions}
                        options={staffNames}
                      />
                    </FollowUpComposer>
                  </div>
                )}
                <FollowUpRecords
                  emptyText="暂无顾问反馈"
                  records={[...opp.advisorNotes]
                    .reverse()
                    .slice(0, RECENT_NOTE_LIMIT)
                    .map((n) => ({
                      id: n.id,
                      author: n.author,
                      date: n.date,
                      content: n.content,
                    }))}
                />
              </section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            {!isClosed && editable && (
              <FollowUpComposer
                footerLeft={
                  opp.nextFollowAt ? (
                    <Pill label={`计划下次 ${opp.nextFollowAt.slice(0, 10)}`} tone="warning" />
                  ) : null
                }
                footerRight={
                  <Button size="sm" className="shrink-0 gap-1.5" onClick={() => void submitNote()}>
                    <MessageSquarePlus className="size-4" />
                    添加进展
                  </Button>
                }
              >
                <div className="w-full sm:max-w-xs">
                  <label className="mb-1 block text-xs text-muted-foreground">计划下次跟进（可选）</label>
                  <DatePicker
                    value={noteNextFollowAt}
                    min={localToday()}
                    onChange={(v) => {
                      const day = (v || "").slice(0, 10)
                      if (day && day < localToday()) {
                        toast.error("下次计划跟进不能早于今天")
                        setNoteNextFollowAt(localToday())
                        return
                      }
                      setNoteNextFollowAt(day)
                    }}
                    placeholder="不填则清除当前计划"
                  />
                </div>
                <MentionTextarea
                  rows={3}
                  placeholder="记录商机进展，输入 @ 可提及成员…"
                  value={note}
                  onChange={setNote}
                  onMentionsChange={setNoteMentions}
                  options={staffNames}
                />
              </FollowUpComposer>
            )}
            <FollowUpRecords
              className="max-h-[min(36rem,calc(100dvh-18rem))] overflow-y-auto overscroll-contain pr-1"
              records={[...opp.notes].reverse().map((n) => ({
                id: n.id,
                author: n.author,
                date: n.date,
                content: n.content,
                pills: (
                  <>
                    {n.origin === "request" && <Pill label="需求带入" tone="warning" />}
                    {n.nextFollowAt ? (
                      <Pill label={`计划下次 ${n.nextFollowAt.slice(0, 10)}`} tone="warning" />
                    ) : null}
                  </>
                ),
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="advisor" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            {canEditAdvisor && (
              <FollowUpComposer
                footerRight={
                  <Button className="shrink-0 gap-1.5" onClick={() => void submitAdvisorNote()}>
                    <MessageSquarePlus className="size-4" />
                    添加反馈
                  </Button>
                }
              >
                <MentionTextarea
                  rows={3}
                  placeholder="记录售前顾问的评估与方案建议，输入 @ 可提及成员…"
                  value={advisorNote}
                  onChange={setAdvisorNote}
                  onMentionsChange={setAdvisorMentions}
                  options={staffNames}
                />
              </FollowUpComposer>
            )}
            <FollowUpRecords
              className="max-h-[min(36rem,calc(100dvh-18rem))] overflow-y-auto overscroll-contain pr-1"
              emptyText="暂无顾问反馈"
              records={[...opp.advisorNotes].reverse().map((n) => ({
                id: n.id,
                author: n.author,
                date: n.date,
                content: n.content,
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-4 outline-none">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Paperclip className="size-4" />
                    商机附件
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    支持上传方案、报价单、会议纪要等；飞书「方案需求表」外链也会显示在此，可直接打开。
                  </p>
                </div>
                {editable && !isClosed && (
                  <Button type="button" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                    <Upload className="size-4" />
                    上传附件
                  </Button>
                )}
              </div>
              <div className="mt-4 space-y-2.5">
                {attachments.length === 0 ? (
                  <EmptyState text="暂无商机附件" />
                ) : (
                  [...attachments].reverse().map((attachment) => (
                    <CrmAttachmentRow
                      key={attachment.id}
                      attachment={attachment}
                      badge={
                        attachment.origin === "request"
                          ? { label: "需求带入", tone: "warning" }
                          : attachment.description === "方案需求表" || attachment.id.startsWith("att-link-")
                            ? { label: "方案需求表", tone: "info" }
                            : { label: "商机附件", tone: "info" }
                      }
                    />
                  ))
                )}
              </div>
            </div>

            {linkedContract && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Paperclip className="size-4" />
                      关联合同附件
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      来自合同「{linkedContract.name}」，签署扫描件请在合同详情维护。
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link href={`/contracts/${linkedContract.id}`}>打开合同</Link>
                  </Button>
                </div>
                <div className="mt-4 space-y-2.5">
                  {(linkedContract.attachments?.length ?? 0) === 0 ? (
                    <EmptyState text="合同暂无附件" />
                  ) : (
                    [...(linkedContract.attachments ?? [])].reverse().map((attachment) => (
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
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-4 flex h-[min(36rem,calc(100dvh-18rem))] min-h-[20rem] flex-col overflow-hidden outline-none"
        >
          <EntityAuditHistory
            entityId={opp.id}
            embedded
            hint="字段变更、阶段推进和输单记录会出现在这里（按操作时间倒序）。"
          />
        </TabsContent>
      </Tabs>

      {lostOpen && <LostOpportunityDialog oppId={opp.id} open={lostOpen} onOpenChange={setLostOpen} />}
      {editOpen && <EditOpportunityDialog opp={opp} open={editOpen} onOpenChange={setEditOpen} />}
      {assignAdvisorOpen && (
        <AssignAdvisorDialog opp={opp} open={assignAdvisorOpen} onOpenChange={setAssignAdvisorOpen} />
      )}
      {advanceOpen && nextStage && (
        <AdvanceOpportunityDialog
          opp={opp}
          targetStage={nextStage}
          open={advanceOpen}
          onOpenChange={setAdvanceOpen}
        />
      )}
      <Dialog open={managerRequestOpen} onOpenChange={(open) => !managerSaving && setManagerRequestOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>申请项目经理提前介入</DialogTitle>
            <DialogDescription>申请将通知客户成功 Leader，由 Leader 分配具体项目经理。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="project-manager-reason">申请说明（选填）</label>
            <Textarea id="project-manager-reason" value={managerReason} onChange={(event) => setManagerReason(event.target.value)} placeholder="简要说明希望项目经理提前介入的原因" rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={managerSaving} onClick={() => setManagerRequestOpen(false)}>取消</Button>
            <Button disabled={managerSaving} onClick={() => void submitProjectManagerRequest()}>{managerSaving ? "提交中…" : "提交申请"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={managerAssignOpen} onOpenChange={(open) => !managerSaving && setManagerAssignOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>分配项目经理</DialogTitle>
            <DialogDescription>从客户成功团队中选择一位在职项目经理；分配结果会通知申请人。</DialogDescription>
          </DialogHeader>
          <MemberPicker
            value={managerSelection}
            onChange={(value) => setManagerSelection(value.slice(-1))}
            options={projectManagerOptions}
            label="项目经理（单选）"
            placeholder={projectManagerOptionsLoading ? "正在加载客户成功团队成员…" : "选择项目经理"}
            disabled={projectManagerOptionsLoading || managerSaving}
          />
          <DialogFooter>
            <Button variant="outline" disabled={managerSaving} onClick={() => setManagerAssignOpen(false)}>取消</Button>
            <Button disabled={managerSaving || projectManagerOptionsLoading} onClick={() => void assignOpportunityProjectManager()}>{managerSaving ? "分配中…" : "确认分配"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="上传商机附件"
        description="请为每个附件填写用途说明，例如方案、报价单、会议纪要等。"
        onUploaded={handleAttachmentsUploaded}
      />
    </div>
  )
}
