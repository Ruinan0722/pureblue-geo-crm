"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Plus,
  Star,
  Waves,
  Target,
  Upload,
  UserPlus,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Checkbox } from "@/shared/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import {
} from "@/shared/ui/dropdown-menu"
import { Pill, InfoRow, EmptyState } from "@/modules/crm/components/ui"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import { CustomerFollowUpTab, type UnifiedCustomerFollowUp } from "./customer-follow-up-tab"
import { NewContractDialog } from "@/modules/crm/components/contract-form-dialog"
import { LeadFormDialog } from "@/modules/crm/components/lead-actions"
import { useSessionRestoredOpen } from "@/shared/hooks/use-form-draft"
import { chinaDateISO } from "@/shared/lib/datetime"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { ROLE_META, useRole } from "@/modules/crm/hooks/use-crm-access"
import { canDo, canSeeTeamPools } from "@/modules/auth/lib/permissions"
import { useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { EntityAuditCount, EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import {
  COMPANY_NATURES,
  INDUSTRIES,
  LEAD_SOURCES,
  REGIONS,
  money,
  customerStatusMeta,
  daysSinceDate,
  oppStageMeta,
  latestFollowDateForContact,
  sanitizeCreditCodeInput,
  validateCreditCode,
  type Contact,
  type Customer,
  type CustomerStatus,
  type FollowType,
} from "@/modules/crm/lib/crm-data"
import { chinaCityOptions, applyRegionCityChange } from "@/modules/crm/lib/china-cities"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { CONTRACT_STATUS_META, normalizeContractStatus } from "@/modules/crm/lib/crm-data"
import { STATUS_META, brandDisplay } from "@/modules/crm/lib/request-display"
import { sortFollowUpsNewestFirst } from "@/modules/crm/lib/follow-up-sort"
import { CreateOpportunityDialog } from "@/modules/crm/components/opportunity-actions"
import { useMentionNames } from "@/modules/crm/hooks/use-directory-options"
import { AttachmentUploadDialog } from "@/modules/crm/components/attachment-upload-dialog"
import { fetchRequests } from "@/modules/requests/services/requests-api"
import {
  fetchAssignableContactOwners,
  releaseCustomerToPublicPool,
  type AssignableContactOwner,
} from "@/modules/crm/services/crm-api"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import { ContentLoadingBlock, ContentLoadingOverlay } from "@/shared/ui/content-loading"
import { RelatedProjectLinks } from "@/modules/projects/components/related-project-links"
import { TeamCollaborationCard } from "@/modules/crm/components/team-collaboration-card"

const STATUS_OPTIONS: CustomerStatus[] = [
  "awaiting_contact",
  "connected",
  "opportunity_following",
  "cooperating",
  "stopped",
]

type CustomerOpportunityFollowUp = {
  id: string
  opportunityId: string
  opportunityName: string
  stageLabel: string
  author: string
  content: string
  date: string
  followType?: FollowType
  nextFollowAt?: string
  sourceLabel: "销售跟进" | "售前反馈"
}



export function CustomerDetail({ id }: { id: string }) {
  const router = useRouter()
  const {
    getCustomer,
    opportunities,
    contracts,
    updateCustomer: _updateCustomer,
    addCustomerNote,
    addCustomerAttachment,
    addSubsidiary,
    setPrimaryContact,
    updateContact,
    transferContact,
    loadCustomerById,
    replaceCustomerFromServer,
    ensureOpportunitiesLoaded,
    ensureContractsLoaded,
    loading,
  } = useCrm()
  const { canEdit: _canEdit, identity, role, user } = useRole()
  const permissions = user?.permissions ?? []
  const canCreateOpp = canDo(permissions, "opportunities:create", "opportunities:write")
  const canCreateContract = canDo(permissions, "contracts:create", "contracts:write")
  const _canCreateCustomer = canDo(permissions, "customers:create", "customers:write")
  const canEditMaster = canDo(permissions, "customers:master_edit", "customers:write")
  const canAddContact = canDo(permissions, "customers:contact_add", "customers:write")
  const canEditContact = canDo(permissions, "customers:contact_edit", "customers:write")
  const canAssignContact =
    canDo(permissions, "customers:contact_assign", "customers:write") &&
    (user ? canSeeTeamPools(user) : false)
  const canAddFollow = canDo(permissions, "customers:follow_add", "customers:write")
  const canUploadAttachment = canDo(permissions, "customers:attachment_upload", "customers:write")
  const canReleaseToPool = canDo(permissions, "public_pool:release")
  const customer = getCustomer(id)
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()
  const coverageScope = mineOnlyAvailable ? (mineOnly ? "self" : "managed") : undefined
  const { names: staffNames } = useMentionNames("customers", id)
  const [detailLoading, setDetailLoading] = useState(false)
  const [assignableOwners, setAssignableOwners] = useState<AssignableContactOwner[]>([])
  const [linkedRequests, setLinkedRequests] = useState<
    Awaited<ReturnType<typeof fetchRequests>>["items"]
  >([])

  useEffect(() => {
    if (loading) return
    let cancelled = false
    setDetailLoading(true)
    void loadCustomerById(id, coverageScope ? { coverageScope } : undefined).finally(() => {
      if (!cancelled) setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, loading, loadCustomerById, coverageScope])

  useEffect(() => {
    void Promise.all([ensureOpportunitiesLoaded(), ensureContractsLoaded()]).catch(() => undefined)
  }, [ensureOpportunitiesLoaded, ensureContractsLoaded])

  // 改派归属下拉：只渲染服务端可指派集合（与后端 transfer 校验同一规则）
  useEffect(() => {
    if (!canAssignContact || !id) {
      setAssignableOwners([])
      return
    }
    let cancelled = false
    void fetchAssignableContactOwners(id)
      .then((items) => {
        if (!cancelled) setAssignableOwners(items)
      })
      .catch(() => {
        if (!cancelled) setAssignableOwners([])
      })
    return () => {
      cancelled = true
    }
  }, [id, canAssignContact])

  useEffect(() => {
    const companyName = customer?.companyName?.trim()
    if (!companyName) {
      setLinkedRequests([])
      return
    }
    let cancelled = false
    void fetchRequests({ keyword: companyName, page: 1, pageSize: 50 })
      .then((result) => {
        if (cancelled) return
        setLinkedRequests(
          result.items.filter((r) => (r.data.companyName || "").trim() === companyName),
        )
      })
      .catch(() => {
        if (!cancelled) setLinkedRequests([])
      })
    return () => {
      cancelled = true
    }
  }, [customer?.companyName])

  const [contactOpen, setContactOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [subsidiaryOpen, setSubsidiaryOpen] = useState(false)
  const [oppOpen, setOppOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseReason, setReleaseReason] = useState("")
  const [releasing, setReleasing] = useState(false)
  const [contractCreateOpen, setContractCreateOpen] = useSessionRestoredOpen((key) =>
    key.startsWith("crm:create-contract:"),
  )
  const [newSubsidiary, setNewSubsidiary] = useState({ name: "", shortName: "", creditCode: "", city: "" })

  const linkedOpps = useMemo(
    () => (customer ? opportunities.filter((o) => o.customerId === customer.id) : []),
    [opportunities, customer],
  )
  /**
   * 商机跟进在客户详情中只做聚合展示，不复制写入客户 notes：
   * 这样商机详情仍是唯一编辑入口，客户详情始终读取最新记录。
   */
  const linkedOpportunityFollowUps = useMemo<CustomerOpportunityFollowUp[]>(
    () =>
      sortFollowUpsNewestFirst(
        linkedOpps.flatMap((opp) => {
          const allOpportunityNotes = [...(opp.notes ?? []), ...(opp.advisorNotes ?? [])]
          const latestNoteId = sortFollowUpsNewestFirst(allOpportunityNotes)[0]?.id
          // 商机当前的计划时间属于商机级字段；如果历史记录本身没有快照，
          // 只回写到该商机最新一条动态，避免把当前计划误显示到旧记录上。
          const nextPlanFor = (note: (typeof allOpportunityNotes)[number]) =>
            note.nextFollowAt || (note.id === latestNoteId ? opp.nextFollowAt : undefined)

          return [
            ...(opp.notes ?? []).map((note) => ({
              id: `opportunity-${opp.id}-sales-${note.id}`,
              opportunityId: opp.id,
              opportunityName: opp.name,
              stageLabel: oppStageMeta(opp.stage).label,
              author: note.author,
              content: note.content,
              date: note.date,
              followType: note.followType,
              nextFollowAt: nextPlanFor(note),
              sourceLabel: "销售跟进" as const,
            })),
            ...(opp.advisorNotes ?? []).map((note) => ({
              id: `opportunity-${opp.id}-advisor-${note.id}`,
              opportunityId: opp.id,
              opportunityName: opp.name,
              stageLabel: oppStageMeta(opp.stage).label,
              author: note.author,
              content: note.content,
              date: note.date,
              nextFollowAt: nextPlanFor(note),
              sourceLabel: "售前反馈" as const,
            })),
          ]
        }),
      ),
    [linkedOpps],
  )
  const linkedContracts = useMemo(
    () => (customer ? contracts.filter((c) => c.customerId === customer.id) : []),
    [contracts, customer],
  )

  if (!customer) {
    return (
      <div className="p-8">
        {detailLoading || loading ? (
          <ContentLoadingBlock label="加载客户详情中…" minHeightClassName="min-h-40" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">未找到该客户，或无权查看。</p>
            <Link href="/customers" className="mt-3 inline-block text-sm text-primary hover:underline">
              返回客户列表
            </Link>
          </>
        )}
      </div>
    )
  }

  const hasMyCoverage = Boolean(customer.myCoverageId)
  const coverages = customer.coverages ?? []
  /** 数据范围非 own（Leader/运营/管理员/超管）：非「只看自己」时汇总可见对接池并标归属 */
  const aggregateTeamPools = Boolean(mineOnlyAvailable && !mineOnly && coverages.length > 0)
  /** 编辑入口：主档编辑或本人有池且可维护对接内容（首次写入自动建池） */
  const canOpenMasterEdit =
    canEditMaster || (hasMyCoverage && (canAddFollow || canEditContact))
  const myCoverage = coverages.find((cv) => cv.id === customer.myCoverageId)
  const hasFormalOpportunity = linkedOpps.length > 0
  const isCooperating = customer.status === "cooperating" || (myCoverage?.contacts ?? []).some((contact) => contact.active !== false && contact.status === "cooperating")
  const releaseDisabledReason = hasFormalOpportunity
    ? "已有正式商机，不允许释放至公海"
    : isCooperating
      ? "合作中的客户不允许释放至公海"
      : ""
  const followContacts = (myCoverage?.contacts ?? customer.contacts ?? []).filter((contact) => contact.active !== false)

  const displayContacts = aggregateTeamPools
    ? coverages.flatMap((cv) =>
        (cv.contacts ?? []).map((c) => ({
          ...c,
          coverageOwner: cv.ownerName || "未命名销售",
        })),
      )
    : (customer.contacts ?? []).map((c) => ({
        ...c,
        coverageOwner: String((c as { coverageOwner?: string }).coverageOwner || ""),
      }))

  const displayNotes = sortFollowUpsNewestFirst(
    aggregateTeamPools
      ? coverages.flatMap((cv) =>
          (cv.notes ?? []).map((n) => ({
            ...n,
            coverageOwner: cv.ownerName || "未命名销售",
          })),
        )
      : (customer.notes ?? []).map((n) => ({
          ...n,
          coverageOwner: String((n as { coverageOwner?: string }).coverageOwner || ""),
        })),
  )

  const unifiedFollowUps = sortFollowUpsNewestFirst<UnifiedCustomerFollowUp>([
    ...displayNotes.map((n) => ({
      id: `customer-${n.coverageOwner || "self"}-${n.id}`,
      source: "customer" as const,
      author: n.author,
      content: n.content,
      date: n.date,
      followType: n.followType,
      nextFollowAt: n.nextFollowAt,
      contactName: n.contactName,
      coverageOwner: n.coverageOwner,
      fromLead: n.origin === "lead",
      sourceLabel: "客户跟进" as const,
    })),
    ...linkedOpportunityFollowUps.map((n) => ({
      id: n.id,
      source: "opportunity" as const,
      author: n.author,
      content: n.content,
      date: n.date,
      followType: n.followType,
      nextFollowAt: n.nextFollowAt,
      opportunityId: n.opportunityId,
      opportunityName: n.opportunityName,
      stageLabel: n.stageLabel,
      sourceLabel: n.sourceLabel === "售前反馈" ? ("售前反馈" as const) : ("商机跟进" as const),
    })),
  ])
  const displayAttachments = aggregateTeamPools
    ? coverages.flatMap((cv) =>
        (cv.attachments ?? []).map((a) => ({
          ...a,
          coverageOwner: cv.ownerName || "未命名销售",
        })),
      )
    : (customer.attachments ?? []).map((a) => ({
        ...a,
        coverageOwner: String((a as { coverageOwner?: string }).coverageOwner || ""),
      }))

  const ownerSummary =
    coverages.length > 0
      ? coverages.map((cv) => cv.ownerName || "未命名").join("、")
      : customer.owner || "—"
  const canManageCustomerTeam =
    canEditMaster ||
    identity.name === customer.owner ||
    coverages.some((coverage) => coverage.ownerName === identity.name)

  async function submitReleaseToPool() {
    if (!releaseReason.trim()) {
      toast.error("请填写释放原因")
      return
    }
    setReleasing(true)
    try {
      await releaseCustomerToPublicPool(id, {
        reason: releaseReason.trim(),
        coverageId: customer?.myCoverageId || undefined,
      })
      toast.success("客户已释放至公海池")
      setReleaseOpen(false)
      router.push("/public-pool")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "释放失败")
    } finally {
      setReleasing(false)
    }
  }

  async function submitSubsidiary() {
    if (!customer) return
    if (!newSubsidiary.name.trim() || !newSubsidiary.shortName.trim()) {
      toast.error("请填写子公司全称和简称")
      return
    }
    const creditCode = newSubsidiary.creditCode.trim()
    const creditErr = validateCreditCode(creditCode)
    if (creditErr) {
      toast.error(creditErr)
      return
    }
    await addSubsidiary(customer.id, {
      ...newSubsidiary,
      name: newSubsidiary.name.trim(),
      shortName: newSubsidiary.shortName.trim(),
      creditCode,
      city: newSubsidiary.city.trim(),
    })
    setNewSubsidiary({ name: "", shortName: "", creditCode: "", city: "" })
    setSubsidiaryOpen(false)
    toast.success("子公司已关联到一级客户")
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
    if (!customer) return
    const author = identity.name || ROLE_META[role]?.label || String(role)
    for (const file of items) {
      await addCustomerAttachment(customer.id, {
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
    toast.success(`已上传 ${items.length} 个附件`)
  }

  return (
    <div className="relative mx-auto max-w-6xl px-5 py-6 lg:px-8">
      {detailLoading ? <ContentLoadingOverlay label="正在切换可见范围…" /> : null}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回客户列表
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
              {customer.isKey && <Star className="size-5 fill-amber-400 text-amber-400" />}
              {customer.brandName || customer.companyName}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.companyName} · {customer.region} · 对接销售：{ownerSummary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mineOnlyAvailable ? (
            <MineOnlyToggle value={mineOnly} onChange={setMineOnly} disabled={detailLoading} />
          ) : null}
          {canOpenMasterEdit && (
            <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              编辑
            </Button>
          )}
          {canReleaseToPool && hasMyCoverage ? (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={Boolean(releaseDisabledReason)}
              title={releaseDisabledReason || "释放客户至公海池"}
              onClick={() => { setReleaseReason(""); setReleaseOpen(true) }}
            >
              <Waves className="size-4" />
              释放至公海
            </Button>
          ) : null}
          {canCreateOpp && (
            <Button className="gap-1.5" onClick={() => setOppOpen(true)}>
              <Target className="size-4" />
              创建商机
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="info" className="mt-6">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="info">基本信息</TabsTrigger>
          <TabsTrigger value="contacts">联系人 ({displayContacts.length})</TabsTrigger>
          <TabsTrigger value="follow">
            跟进记录 ({unifiedFollowUps.length})
          </TabsTrigger>
          <TabsTrigger value="companies">公司架构 ({customer.subsidiaries?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="opps">商机 ({linkedOpps.length})</TabsTrigger>
          <TabsTrigger value="requests">需求单 ({linkedRequests.length})</TabsTrigger>
          <TabsTrigger value="files">附件 ({displayAttachments.length})</TabsTrigger>
          <TabsTrigger value="contracts">合同 ({linkedContracts.length})</TabsTrigger>
          <TabsTrigger value="history">
            <EntityAuditCount entityId={customer.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        {/* 基本信息 */}
        <TabsContent value="info" className="mt-4">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <div className="rounded-2xl border border-border bg-card p-5">
              <dl>
              <InfoRow label="公司名称">{customer.companyName}</InfoRow>
              <InfoRow label="品牌名称">{customer.brandName || "—"}</InfoRow>
              <InfoRow label="所属行业">
                {customer.industryL1}
                {customer.industryL2 ? ` / ${customer.industryL2}` : ""}
              </InfoRow>
              <InfoRow label="所在地区">
                {customer.region} · {customer.city}
              </InfoRow>
              <InfoRow label="成立时间">{customer.foundedDate || "—"}</InfoRow>
              <InfoRow label="统一社会信用代码">{customer.creditCode || "—"}</InfoRow>
              <InfoRow label="注册资金">{customer.registeredCapital ? `${customer.registeredCapital} 万元` : "—"}</InfoRow>
              <InfoRow label="年营业收入">{customer.annualRevenue ? `${customer.annualRevenue} 万元` : "—"}</InfoRow>
              <InfoRow label="公司规模">{customer.scale || "—"}</InfoRow>
              <InfoRow label="企业性质">{customer.nature || "—"}</InfoRow>
              <InfoRow label="客户来源">{customer.source}</InfoRow>
              <InfoRow label="创建时间">{customer.createdAt || "—"}</InfoRow>
              <InfoRow label="销售负责人">{ownerSummary}</InfoRow>
              <InfoRow label="SDR 转出日期">{customer.sdrTransferDate || "—"}</InfoRow>
              <InfoRow label="下次计划跟进">
                {customer.nextFollowAt ? (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <CalendarClock className="size-3.5" />
                    {customer.nextFollowAt.slice(0, 10)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">未安排（在跟进记录中计划）</span>
                )}
              </InfoRow>
              <InfoRow label="重点客户">{customer.isKey ? "是" : "否"}</InfoRow>
                <RelatedProjectLinks customerId={customer.id} />
              </dl>
            </div>
            <TeamCollaborationCard
              entityType="customer"
              entityId={customer.id}
              entityName={customer.companyName}
              ownerName={ownerSummary === "—" ? "" : ownerSummary}
              ownerDepartment="销售部"
              ownerRoleLabel="客户负责人"
              canManage={canManageCustomerTeam}
              currentUserName={identity.name || "当前用户"}
            />
          </div>
        </TabsContent>

        <TabsContent value="companies" className="mt-4">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div>
              <p className="text-sm font-semibold">一级客户：{customer.companyName}</p>
            </div>
            {canEditMaster && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSubsidiaryOpen(true)}>
                <Building2 className="size-4" />
                添加子公司
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(customer.subsidiaries ?? []).map((subsidiary) => (
              <div key={subsidiary.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{subsidiary.shortName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{subsidiary.name}</p>
                  </div>
                  <Pill label="二级公司" tone="info" />
                </div>
                <dl className="mt-3 space-y-1 text-xs">
                  <div className="flex gap-2"><dt className="text-muted-foreground">公司全称</dt><dd>{subsidiary.name || "—"}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">信用代码</dt><dd>{subsidiary.creditCode || "—"}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">城市</dt><dd>{subsidiary.city || "—"}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          {!customer.subsidiaries?.length && <EmptyState text="暂无子公司，可新增二级公司档案" />}
        </TabsContent>

        {/* 联系人 */}
        <TabsContent value="contacts" className="mt-4">
          {canAddContact && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setContactOpen(true)}>
                <UserPlus className="size-4" />
                添加联系人
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {displayContacts.map((ct) => (
              <div key={ct.id} className="flex h-full flex-col space-y-1.5">
                {ct.coverageOwner ? (
                  <p className="px-0.5 text-[11px] font-medium text-muted-foreground">
                    归属：{ct.coverageOwner}
                  </p>
                ) : null}
                <ContactCard
                  contact={ct}
                  unfollowDays={daysSinceDate(latestFollowDateForContact(customer.notes, ct.id, ct.name))}
                  editable={canEditContact}
                  canAssign={canAssignContact}
                  assignOptions={assignableOwners.map((o) => o.name)}
                  onSetPrimary={async () => {
                    await setPrimaryContact(customer.id, ct.id)
                    toast.success(`已将 ${ct.name} 设为主联系人`)
                  }}
                  onToggleActive={async () => {
                    await updateContact(customer.id, ct.id, { active: !ct.active })
                  }}
                  onSave={async (patch) => {
                    await updateContact(customer.id, ct.id, patch)
                    toast.success("联系人已更新")
                  }}
                  onTransfer={async (ownerName) => {
                    await transferContact(customer.id, ct.id, ownerName)
                    toast.success(`已将 ${ct.name} 的归属改派为 ${ownerName}`)
                    const refreshed = await loadCustomerById(
                      customer.id,
                      coverageScope ? { coverageScope } : undefined,
                    )
                    if (!refreshed) {
                      toast.warning("改派成功，但刷新客户详情失败，请稍后刷新页面确认")
                    }
                  }}
                />
              </div>
            ))}
          </div>
          {displayContacts.length === 0 && <EmptyState text="暂无联系人" />}
        </TabsContent>

        {/* 商机 */}
        <TabsContent value="opps" className="mt-4">
          <div className="space-y-2.5">
            {linkedOpps.map((o) => (
              <Link
                key={o.id}
                href={`/opportunities/${o.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
              >
                <div>
                  <p className="font-medium">{o.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.projectTypes.join(" / ")} · 预计签约 {o.expectedSignDate || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">{money(o.amount)}</span>
                  <Pill label={oppStageMeta(o.stage).label} tone={oppStageMeta(o.stage).tone} />
                </div>
              </Link>
            ))}
          </div>
          {linkedOpps.length === 0 && <EmptyState text="暂无商机，点击右上角「创建商机」" />}
        </TabsContent>

        {/* 需求单 */}
        <TabsContent value="requests" className="mt-4">
          <div className="space-y-2.5">
            {linkedRequests.map((r) => (
              <Link
                key={r.id}
                href={`/requests/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
              >
                <div>
                  <p className="font-medium">{brandDisplay(r.data)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                </div>
                <Pill label={STATUS_META[r.status]?.label ?? r.status} tone={STATUS_META[r.status]?.tone ?? "muted"} />
              </Link>
            ))}
          </div>
          {linkedRequests.length === 0 && <EmptyState text="暂无关联需求单" />}
        </TabsContent>

         {/* 统一客户跟进时间线：客户与关联商机记录按发生时间混合展示 */}
         <TabsContent value="follow" className="mt-4">
           <CustomerFollowUpTab unifiedFollowUps={unifiedFollowUps} canAddFollow={canAddFollow} followContacts={followContacts} nextFollowAt={customer.nextFollowAt} staffNames={staffNames}
             onSave={async ({ content, ...options }) => { await addCustomerNote(customer.id, content, { ...options, author: identity.name || ROLE_META[role]?.label || String(role) }) }} />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  客户附件
                </h2>
              </div>
              {canUploadAttachment && (
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  上传附件
                </Button>
              )}
            </div>
            <div className="mt-4 space-y-2.5">
              {displayAttachments.length === 0 ? (
                <EmptyState text="暂无附件" />
              ) : (
                [...displayAttachments].reverse().map((attachment) => {
                  const fromLead = attachment.origin === "lead"
                  return (
                    <div key={`${attachment.coverageOwner}-${attachment.id}`} className="space-y-1">
                      {attachment.coverageOwner ? (
                        <p className="text-[11px] font-medium text-muted-foreground">
                          归属：{attachment.coverageOwner}
                        </p>
                      ) : null}
                      <CrmAttachmentRow
                        attachment={attachment}
                        badge={
                          fromLead
                            ? { label: "线索带入", tone: "warning" }
                            : { label: "客户附件", tone: "info" }
                        }
                        className={fromLead ? "border-amber-200 bg-amber-50/40" : undefined}
                      />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </TabsContent>

        {/* 合同 */}
        <TabsContent value="contracts" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">客户合同</p>
              </div>
              {canCreateContract && (
                <Button className="gap-1.5" onClick={() => setContractCreateOpen(true)}>
                  <Plus className="size-4" />
                  新增合同
                </Button>
              )}
            </div>
            <div className="space-y-2.5">
              {linkedContracts.map((c) => {
                const opp = c.opportunityId
                  ? opportunities.find((o) => o.id === c.opportunityId)
                  : undefined
                return (
                  <Link
                    key={c.id}
                    href={`/contracts/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/20 p-4 transition-colors hover:bg-accent/30"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.code || "-"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {opp ? `关联商机：${opp.name}` : "未绑定商机"}
                        {c.attachments?.length ? ` · 附件 ${c.attachments.length}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{money(c.amount)}</span>
                      <Pill
                        label={CONTRACT_STATUS_META[normalizeContractStatus(c.status)].label}
                        tone={CONTRACT_STATUS_META[normalizeContractStatus(c.status)].tone}
                      />
                    </div>
                  </Link>
                )
              })}
            </div>
            {linkedContracts.length === 0 && <EmptyState text="暂无合同" />}
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-4 flex h-[min(36rem,calc(100dvh-18rem))] min-h-[20rem] flex-col overflow-hidden"
        >
          <EntityAuditHistory entityId={customer.id} embedded />
        </TabsContent>
      </Tabs>

      <LeadFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        customerContext={customer}
        onCustomerUpdated={async (updated) => {
          if (updated) replaceCustomerFromServer(updated)
          await loadCustomerById(customer.id, coverageScope ? { coverageScope } : undefined)
        }}
      />

      <Dialog open={subsidiaryOpen} onOpenChange={setSubsidiaryOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加二级子公司</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 whitespace-nowrap text-sm font-medium text-foreground">完整名称 *</span>
              <Input
                className="flex-1"
                placeholder="子公司完整名称"
                value={newSubsidiary.name}
                onChange={(e) => setNewSubsidiary({ ...newSubsidiary, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 whitespace-nowrap text-sm font-medium text-foreground">简称 *</span>
              <Input
                className="flex-1"
                placeholder="子公司简称（用于商机命名）"
                value={newSubsidiary.shortName}
                onChange={(e) => setNewSubsidiary({ ...newSubsidiary, shortName: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 whitespace-nowrap text-sm font-medium text-foreground">
                统一社会信用代码
              </span>
              <Input
                className="flex-1"
                placeholder="18 位数字或字母"
                maxLength={18}
                autoComplete="off"
                spellCheck={false}
                value={newSubsidiary.creditCode}
                onChange={(e) =>
                  setNewSubsidiary({ ...newSubsidiary, creditCode: sanitizeCreditCodeInput(e.target.value) })
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 whitespace-nowrap text-sm font-medium text-foreground">所在城市</span>
              <SearchableSelect
                className="flex-1"
                value={newSubsidiary.city}
                onChange={(city) => setNewSubsidiary({ ...newSubsidiary, city })}
                options={chinaCityOptions()}
                placeholder="输入搜索所在城市"
                allowCustom
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubsidiaryOpen(false)}>取消</Button>
            <Button onClick={submitSubsidiary}>保存子公司</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>释放客户至公海</DialogTitle>
            <DialogDescription>
              释放后你将失去客户及联系人查看权限，历史跟进记录会随客户保留并在认领后回流。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="rounded-lg bg-muted p-3 font-medium">{customer.companyName}</p>
            <label htmlFor="release-reason" className="text-sm font-medium">释放原因 *</label>
            <Textarea id="release-reason" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} rows={4} placeholder="请说明释放至公海的原因" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseOpen(false)} disabled={releasing}>取消</Button>
            <Button variant="destructive" onClick={() => void submitReleaseToPool()} disabled={releasing}>{releasing ? "释放中…" : "确认释放"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {oppOpen && (
        <CreateOpportunityDialog
          customerId={customer.id}
          open={oppOpen}
          onOpenChange={setOppOpen}
          onCreated={(oid) => router.push(`/opportunities/${oid}`)}
        />
      )}
      {editOpen && <EditCustomerDialog customer={customer} open={editOpen} onOpenChange={setEditOpen} />}
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="上传客户附件"
        description="请为每个附件填写用途说明，例如合同扫描件、需求材料、会议纪要等。"
        onUploaded={handleAttachmentsUploaded}
      />
      {contractCreateOpen && (
        <NewContractDialog
          open={contractCreateOpen}
          onOpenChange={setContractCreateOpen}
          defaultCustomerId={customer.id}
          onCreated={(cid) => router.push(`/contracts/${cid}`)}
        />
      )}
    </div>
  )
}

function localToday(): string {
  // 与 DatePicker / 工作台「今日」一致：中国时区自然日，避免浏览器本地时区偏差
  return chinaDateISO()
}

/** 兼容历史客户空列：API 修复部署前的已加载数据也不应让编辑提交崩溃。 */
function customerFormText(value: unknown): string {
  return String(value ?? "")
}

function EditCustomerDialog({ customer, open, onOpenChange }: { customer: Customer; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { updateCustomer } = useCrm()
  const minFollowDate = localToday()
  const [form, setForm] = useState({
    companyName: customerFormText(customer.companyName),
    brandName: customerFormText(customer.brandName),
    region: customerFormText(customer.region),
    city: customerFormText(customer.city),
    industryL1: customerFormText(customer.industryL1),
    industryL2: customerFormText(customer.industryL2),
    foundedDate: customerFormText(customer.foundedDate),
    creditCode: customerFormText(customer.creditCode),
    registeredCapital: customer.registeredCapital ? String(customer.registeredCapital) : "",
    annualRevenue: customer.annualRevenue ? String(customer.annualRevenue) : "",
    scale: customerFormText(customer.scale),
    nature: customerFormText(customer.nature),
    owner: customerFormText(customer.owner),
    source: customerFormText(customer.source),
    sdrTransferDate: customerFormText(customer.sdrTransferDate).slice(0, 10),
    nextFollowAt: customerFormText(customer.nextFollowAt).slice(0, 10),
    isKey: customer.isKey,
  })
  const { names: salesOptions } = useSalesNames(form.owner ? [form.owner] : [])

  function setRegion(region: string) {
    setForm((current) => ({ ...current, ...applyRegionCityChange(current, { region }) }))
  }

  function setCity(city: string) {
    setForm((current) => ({ ...current, ...applyRegionCityChange(current, { city }) }))
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit() {
    if (!form.companyName.trim()) {
      toast.error("请填写公司名称")
      return
    }
    const creditCode = form.creditCode.trim()
    const creditErr = validateCreditCode(creditCode)
    if (creditErr) {
      toast.error(creditErr)
      return
    }
    const nextFollowAt = form.nextFollowAt.slice(0, 10)
    if (customer.myCoverageId && nextFollowAt && nextFollowAt < minFollowDate) {
      toast.error("下次计划跟进不能早于今天")
      return
    }
    const patch: Partial<Customer> = {
      companyName: form.companyName.trim(),
      brandName: form.brandName.trim(),
      region: form.region,
      city: form.city.trim(),
      industryL1: form.industryL1,
      industryL2: form.industryL2,
      foundedDate: form.foundedDate,
      creditCode,
      registeredCapital: Number(form.registeredCapital) || 0,
      annualRevenue: Number(form.annualRevenue) || 0,
      scale: form.scale.trim(),
      nature: form.nature,
      owner: form.owner,
      source: form.source,
      sdrTransferDate: form.sdrTransferDate.slice(0, 10),
    }
    // 池字段仅在有本人对接时写入，避免 Leader 主档编辑回写下属 isKey/计划跟进
    if (customer.myCoverageId) {
      patch.nextFollowAt = nextFollowAt
      patch.isKey = form.isKey
    }
    await updateCustomer(customer.id, patch)
    onOpenChange(false)
    toast.success("客户字段已保存，变更记录已留痕")
  }

  const industryOptions = INDUSTRIES[form.industryL1] ?? []
  const industryL1Options = toSelectOptions(Object.keys(INDUSTRIES))
  const industryL2Options = toSelectOptions(industryOptions)
  const fieldLabel = "mb-1 block text-xs text-muted-foreground"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 须用 sm:max-w-* 覆盖 DialogContent 默认的 sm:max-w-sm，否则桌面端弹窗过窄无法完整展示基本信息 */}
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑客户</DialogTitle>
          <DialogDescription>
            修改「基本信息」页全部字段：公司档案、行业地区、负责人与跟进计划。客户状态请在详情页标题旁切换。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={fieldLabel}>公司名称 *</label>
            <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </div>
          <div>
            <label className={fieldLabel}>品牌名称</label>
            <Input value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>一级行业</label>
              <SearchableSelect
                value={form.industryL1}
                onChange={(next) => setForm((current) => ({ ...current, industryL1: next, industryL2: INDUSTRIES[next]?.[0] || "" }))}
                options={industryL1Options}
                placeholder="选择或搜索行业"
              />
            </div>
            <div>
              <label className={fieldLabel}>二级行业</label>
              <SearchableSelect
                value={form.industryL2}
                onChange={(v) => set("industryL2", v)}
                options={industryL2Options}
                placeholder="选择或搜索子行业"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>所在地区 · 区域</label>
              <SearchableSelect value={form.region} onChange={setRegion} options={toSelectOptions(REGIONS)} placeholder="选择区域" />
            </div>
            <div>
              <label className={fieldLabel}>所在地区 · 城市</label>
              <SearchableSelect
                value={form.city}
                onChange={setCity}
                options={chinaCityOptions()}
                placeholder="输入搜索城市"
                allowCustom
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>成立时间</label>
              <DatePicker value={form.foundedDate} onChange={(v) => set("foundedDate", v)} placeholder="选择成立日期" />
            </div>
            <div>
              <label className={fieldLabel}>统一社会信用代码</label>
              <Input
                placeholder="18 位数字或英文字母"
                maxLength={18}
                autoComplete="off"
                spellCheck={false}
                value={form.creditCode}
                onChange={(e) => set("creditCode", sanitizeCreditCodeInput(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">须为 18 位；仅支持数字与大小写英文字母，可不填</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>注册资金（万元）</label>
              <Input
                inputMode="numeric"
                value={form.registeredCapital}
                onChange={(e) => set("registeredCapital", e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
            <div>
              <label className={fieldLabel}>年营业收入（万元）</label>
              <Input
                inputMode="decimal"
                value={form.annualRevenue}
                onChange={(e) => set("annualRevenue", e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="可选"
              />
            </div>
            <div>
              <label className={fieldLabel}>公司规模</label>
              <Input value={form.scale} onChange={(e) => set("scale", e.target.value)} placeholder="如：50-100 人" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>企业性质</label>
              <SearchableSelect
                value={form.nature}
                onChange={(v) => set("nature", v)}
                options={toSelectOptions(COMPANY_NATURES)}
                placeholder="选择企业性质"
              />
            </div>
            <div>
              <label className={fieldLabel}>客户来源</label>
              <SearchableSelect
                value={form.source}
                onChange={(v) => set("source", v)}
                options={toSelectOptions(LEAD_SOURCES)}
                placeholder="选择或搜索来源"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabel}>销售负责人</label>
              <SearchableSelect
                value={form.owner}
                onChange={(v) => set("owner", v)}
                options={toSelectOptions(salesOptions)}
                placeholder="选择或搜索销售"
              />
            </div>
            <div>
              <label className={fieldLabel}>SDR 转出日期</label>
              <DatePicker
                value={form.sdrTransferDate}
                onChange={(v) => set("sdrTransferDate", v)}
                placeholder="选择转出日期"
              />
            </div>
          </div>
          {customer.myCoverageId ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>下次计划跟进</label>
                <DatePicker
                  value={form.nextFollowAt}
                  onChange={(v) => {
                    if (v && v < minFollowDate) {
                      toast.error("下次计划跟进不能早于今天")
                      set("nextFollowAt", minFollowDate)
                      return
                    }
                    set("nextFollowAt", v)
                  }}
                  min={minFollowDate}
                  placeholder="日常请在跟进记录中计划"
                />
              </div>
              <div>
                <label className={fieldLabel}>是否重点客户</label>
                <SearchableSelect
                  value={form.isKey ? "yes" : "no"}
                  onChange={(v) => set("isKey", v === "yes")}
                  options={[
                    { value: "yes", label: "是" },
                    { value: "no", label: "否" },
                  ]}
                  placeholder="选择是否重点客户"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              当前无本人对接池：本次仅保存公司主档；重点客户与计划跟进将在首次维护（添加跟进/联系人等）时自动建立本人对接池后，再次打开即可编辑。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>保存修改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContactCard({
  contact,
  unfollowDays,
  editable,
  canAssign,
  assignOptions,
  onSetPrimary,
  onToggleActive,
  onSave,
  onTransfer,
}: {
  contact: Contact & { coverageOwner?: string }
  unfollowDays: number | null
  editable: boolean
  canAssign: boolean
  assignOptions: string[]
  onSetPrimary: () => void | Promise<void>
  onToggleActive: () => void | Promise<void>
  onSave: (patch: Partial<Contact>) => Promise<void>
  onTransfer: (ownerName: string) => Promise<void>
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState({
    name: contact.name,
    title: contact.title,
    phone: contact.phone,
    email: contact.email,
    wechatAdded: contact.wechatAdded,
    status: contact.status || "awaiting_contact",
    owner: contact.coverageOwner || "",
  })
  const [saving, setSaving] = useState(false)

  function openEdit() {
    setDraft({
      name: contact.name,
      title: contact.title || "",
      phone: contact.phone || "",
      email: contact.email || "",
      wechatAdded: Boolean(contact.wechatAdded),
      status: contact.status || "awaiting_contact",
      owner: contact.coverageOwner || "",
    })
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!draft.name.trim()) {
      toast.error("请输入联系人姓名")
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: draft.name.trim(),
        title: draft.title.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        wechatAdded: draft.wechatAdded,
        status: draft.status,
      })
      if (canAssign && draft.owner.trim() && draft.owner.trim() !== contact.coverageOwner) {
        await onTransfer(draft.owner.trim())
      }
      setEditOpen(false)
    } catch {
      // 错误已由 updateContact toast
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-[15.5rem] flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex min-h-6 flex-wrap items-center gap-1.5 font-medium">
            {contact.name}
            <span className="inline-flex h-5 min-w-[3.75rem] items-center">
              {contact.isPrimary ? <Pill label="主联系人" tone="info" /> : null}
            </span>
            {!contact.active && <Pill label="已离职" tone="neutral" />}
            <Pill
              label={customerStatusMeta(contact.status || "awaiting_contact").label}
              tone={customerStatusMeta(contact.status || "awaiting_contact").tone}
            />
          </p>
          <p className="text-xs text-muted-foreground">{contact.title || "—"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {contact.wechatAdded && <Pill label="已加企微" tone="success" />}
          {editable && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={openEdit}>
              <Pencil className="size-3" />
              编辑
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-1 items-start justify-between gap-3">
        <dl className="min-w-0 flex-1 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">电话</dt>
            <dd>{contact.phone || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">邮箱</dt>
            <dd className="truncate">{contact.email || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">新增</dt>
            <dd>{contact.createdAt || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">未跟进</dt>
            <dd className="text-amber-600">{unfollowDays == null ? "—" : `未跟进 ${unfollowDays}天`}</dd>
          </div>
          {contact.source ? (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">一级来源</dt>
              <dd>{contact.source}</dd>
            </div>
          ) : null}
          {contact.sourceDetail ? (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">二级来源</dt>
              <dd className="break-words">{contact.sourceDetail}</dd>
            </div>
          ) : null}
        </dl>
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 self-start text-xs text-muted-foreground"
            onClick={() => void onToggleActive()}
          >
            {contact.active ? "标记离职" : "恢复在职"}
          </Button>
        )}
      </div>
      {/* 预留底栏高度，避免设/取消主联系人时「标记离职」随 flex 居中跳动 */}
      {editable && contact.active ? (
        <div className="mt-3 flex min-h-7 items-center">
          {!contact.isPrimary ? (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void onSetPrimary()}>
              <Star className="size-3" />
              设为主联系人
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑联系人</DialogTitle>
            <DialogDescription>修改联系人信息与当前状态。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium text-foreground">姓名 *</span>
              <Input
                className="flex-1"
                placeholder="请输入姓名"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium text-foreground">职位</span>
              <Input
                className="flex-1"
                placeholder="请输入职位"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium text-foreground">手机号</span>
              <Input
                className="flex-1"
                placeholder="请输入手机号"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium text-foreground">邮箱</span>
              <Input
                className="flex-1"
                placeholder="请输入邮箱"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium text-foreground">状态</span>
              <SearchableSelect
                className="flex-1"
                value={draft.status}
                onChange={(v) => setDraft({ ...draft, status: v })}
                options={STATUS_OPTIONS.map((s) => ({ value: s, label: customerStatusMeta(s).label }))}
                placeholder="选择状态"
              />
            </div>
            {canAssign ? (
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-sm font-medium text-foreground">归属</span>
                <SearchableSelect
                  className="flex-1"
                  value={draft.owner}
                  onChange={(v) => setDraft({ ...draft, owner: v })}
                  options={Array.from(
                    new Set([...(assignOptions ?? []), contact.coverageOwner || ""].filter(Boolean)),
                  ).map((name) => ({ value: name, label: name }))}
                  placeholder="选择成员"
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={draft.wechatAdded}
                onCheckedChange={(v) => setDraft({ ...draft, wechatAdded: v === true })}
              />
              已添加企业微信
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void submitEdit()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
