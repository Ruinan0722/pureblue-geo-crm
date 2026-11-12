"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Info, Pencil, Tags } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { DatePicker } from "@/shared/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Pill, InfoRow, EmptyState } from "@/modules/crm/components/ui"
import { MemberPicker } from "@/modules/crm/components/member-picker"
import { money } from "@/modules/crm/lib/crm-data"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import { EntityAuditCount, EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import { ProjectWorkItemsPanel } from "@/modules/projects/components/project-work-items"
import { ProjectActivityPanel } from "@/modules/projects/components/project-activity-panel"
import { ProjectProblemPool } from "@/modules/projects/components/project-problem-pool"
import { ProjectTypeBadge } from "@/modules/projects/components/project-type-badge"
import { ProjectAttachmentsPanel } from "@/modules/projects/components/project-attachments-panel"
import { ProjectSowPanel } from "@/modules/projects/components/project-sow-panel"
import {
  PROJECT_HEALTH_META,
  PROJECT_PLATFORM_OPTIONS,
  PROJECT_RISK_META,
  PROJECT_STAGE_META,
  PROJECT_TYPE_OPTIONS,
} from "@/modules/projects/lib/labels"
import type {
  PatchProjectInput,
  ProjectHealth,
  ProjectRecord,
  ProjectRisk,
  ProjectStage,
} from "@/modules/projects/lib/types"
import { fetchProject, patchProject } from "@/modules/projects/services/projects-api"

type TabKey = "basic" | "scope" | "cycle" | "records" | "issues" | "changes" | "risks" | "attachments" | "history"

const DELAY_RISK_OPTIONS = ["数据不达标", "审稿速度慢", "未收到合同", "项目暂停"]

type FeishuKpiMeta = {
  feishuRecordId?: string
  urls?: { field?: string; url?: string; text?: string }[]
  followUp?: string
}

function singleMember(value: string): string[] {
  return value.trim() ? [value.trim()] : []
}

type ProjectContact = { name: string; phone: string; wechat: string }

function parseProjectContact(raw: string): ProjectContact {
  const fallback = { name: raw || "", phone: "", wechat: "" }
  if (!raw.trim().startsWith("{")) {
    const phone = raw.match(/(?:\+?86[- ]?)?1\d{10}/)?.[0] || ""
    if (!phone) return fallback
    const phoneIndex = raw.indexOf(phone)
    return {
      name: raw.slice(0, phoneIndex).replace(/[\s,，、:：/]+$/, "").trim(),
      phone,
      wechat: "",
    }
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      name: String(value.name ?? value.contactName ?? ""),
      phone: String(value.phone ?? value.contactPhone ?? ""),
      wechat: String(value.wechat ?? value.contactWechat ?? ""),
    }
  } catch {
    // 兼容旧版“一段文本”联系人：自动识别手机号，其余文字仍保留为姓名。
    const phone = raw.match(/(?:\+?86[- ]?)?1\d{10}/)?.[0] || ""
    if (!phone) return fallback
    const phoneIndex = raw.indexOf(phone)
    return {
      name: raw.slice(0, phoneIndex).replace(/[\s,，、:：/]+$/, "").trim(),
      phone,
      wechat: "",
    }
  }
}

function serializeProjectContact(contact: ProjectContact): string {
  const normalized = { name: contact.name.trim(), phone: contact.phone.trim(), wechat: contact.wechat.trim() }
  return Object.values(normalized).some(Boolean) ? JSON.stringify(normalized) : ""
}

/** 飞书导入把 urls/跟进写进 kpi_notes JSON；解析后单独展示，避免一整段 JSON 糊在 KPI 区 */
function parseFeishuKpiNotes(raw: string): { meta: FeishuKpiMeta | null; plain: string } {
  const trimmed = (raw || "").trim()
  if (!trimmed.startsWith("{")) return { meta: null, plain: trimmed }
  try {
    const parsed = JSON.parse(trimmed) as FeishuKpiMeta
    if (!parsed || typeof parsed !== "object") return { meta: null, plain: trimmed }
    return { meta: parsed, plain: "" }
  } catch {
    return { meta: null, plain: trimmed }
  }
}

function TabGuide({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
      <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/50"><Info className="size-4 text-blue-700 dark:text-blue-300" /></div>
      <div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
    </div>
  )
}

function CustomerTagsPopover({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium"><Tags className="size-3.5" />{tags.length} 个标签</span>
      <span className="invisible absolute left-0 top-full z-30 mt-2 w-56 translate-y-1 rounded-xl border border-border bg-popover p-3 opacity-0 shadow-xl transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus:visible group-focus:translate-y-0 group-focus:opacity-100">
        <span className="mb-2 block text-xs font-medium">客户标签</span>
        <span className="flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{tag}</span>)}</span>
      </span>
    </span>
  )
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { canEdit } = useRole()
  const writable = canEdit("projects")
  const [tab, setTab] = useState<TabKey>("basic")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [project, setProject] = useState<ProjectRecord | null>(null)
  const [draft, setDraft] = useState<PatchProjectInput>({})
  const [scopeEditing, setScopeEditing] = useState(false)
  const [scopeSaving, setScopeSaving] = useState(false)
  const [scopeDraft, setScopeDraft] = useState<PatchProjectInput>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = await fetchProject(projectId)
      setProject(p)
      setDraft({})
      setEditing(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败")
      setProject(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit() {
    if (!project) return
    const contact = parseProjectContact(project.contactInfo)
    setDraft({
      name: project.name,
      stage: project.stage,
      health: project.health,
      riskLevel: project.riskLevel,
      bizOwner: project.bizOwner,
      projectManager: project.projectManager,
      projectLeader: project.projectLeader,
      executor: project.executor,
      contentOps: project.contentOps,
      contentOpsMembers: [...project.contentOpsMembers],
      contactName: contact.name,
      contactPhone: contact.phone,
      contactWechat: contact.wechat,
      teamName: project.teamName,
      contentTeamName: project.contentTeamName,
      office: project.office,
      customerLevel: project.customerLevel,
      customerTags: [...project.customerTags],
      assistantMembers: [...project.assistantMembers],
      executionMembers: [...project.executionMembers],
      renewalStatus: project.renewalStatus,
      startDate: project.startDate || "",
      plannedStartDate: project.plannedStartDate || "",
      actualDeliveryDate: project.actualDeliveryDate || "",
      delayReason: project.delayReason,
      remediationPlan: project.remediationPlan,
      delayCustomerNote: project.delayCustomerNote,
    })
    setEditing(true)
  }

  function startScopeEdit() {
    if (!project) return
    setScopeDraft({
      projectTypes: [...project.projectTypes],
      optimizationIntentCount: project.intentBrand,
      monitoringIntentCount: project.monitoringIntentCount,
      platforms: [...project.platforms],
      detectionPlatforms: [...project.detectionPlatforms],
      kpiNotes: project.kpiNotes,
      acceptanceCriteria: project.acceptanceCriteria,
    })
    setScopeEditing(true)
  }

  async function saveScope() {
    if (!project) return
    setScopeSaving(true)
    try {
      const next = await patchProject(project.id, scopeDraft)
      setProject(next)
      setScopeEditing(false)
      toast.success("交付目标已保存")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存交付目标失败")
    } finally {
      setScopeSaving(false)
    }
  }

  async function save() {
    if (!project) return
    setSaving(true)
    try {
      const body: PatchProjectInput = {
        ...draft,
        contactInfo: serializeProjectContact({
          name: String(draft.contactName ?? ""),
          phone: String(draft.contactPhone ?? ""),
          wechat: String(draft.contactWechat ?? ""),
        }),
      }
      if (draft.startDate === "") {
        body.clearStartDate = true
        delete body.startDate
      }
      if (draft.plannedStartDate === "") {
        body.clearPlannedStartDate = true
        delete body.plannedStartDate
      }
      if (draft.actualDeliveryDate === "") { body.clearActualDeliveryDate = true; delete body.actualDeliveryDate }
      const next = await patchProject(project.id, body)
      setProject(next)
      setEditing(false)
      setDraft({})
      toast.success("已保存")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="px-5 py-10 text-center text-sm text-muted-foreground">加载项目详情中…</div>
  }
  if (!project) {
    return (
      <div className="px-5 py-10 text-center">
        <EmptyState text="项目不存在或无权查看" />
        <Button className="mt-4" variant="outline" onClick={() => router.push("/projects")}>
          返回列表
        </Button>
      </div>
    )
  }

  const stageMeta = PROJECT_STAGE_META[project.stage]
  const healthMeta = PROJECT_HEALTH_META[project.health]
  const riskMeta = PROJECT_RISK_META[project.riskLevel]
  const { meta: feishuKpi, plain: plainKpi } = parseFeishuKpiNotes(project.kpiNotes)
  const feishuUrls = (feishuKpi?.urls || []).filter((u) => Boolean(u.url))
  const val = <T,>(key: keyof PatchProjectInput, fallback: T): T =>
    (editing ? ((draft[key] as T | undefined) ?? fallback) : fallback)

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 lg:px-8">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回项目列表
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex sm:items-start sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{project.name}</h1>
            <Pill label={stageMeta.label} tone={stageMeta.tone} />
            <Pill label={healthMeta.label} tone={healthMeta.tone} />
            <Pill label={`风险 ${riskMeta.label}`} tone={riskMeta.tone} />
            {project.renewalWarning && <Pill label="续约预警" tone="warning" />}
            {project.overdue && <Pill label="已过期" tone="danger" />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            关联客户：
            <Link className="text-primary hover:underline" href={`/customers/${project.customerId}`}>
              {project.customerName}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {writable && (
            <Button variant="outline" className="mt-3 gap-1.5 sm:mt-0" onClick={startEdit}>
              <Pencil className="size-4" />
              编辑项目
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "项目经理", value: project.projectManager || "—" },
          { label: "项目负责人", value: project.projectLeader || "未设置" },
          { label: "交付团队", value: project.office || project.teamName || "未设置" },
          {
            label: "合同金额",
            value: project.contractAmount != null ? money(project.contractAmount) : "—",
          },
          { label: "最新 SOW 服务截止", value: project.latestDeliveryDate || project.sowEndDate || "未设置" },
          {
            label: "交付状态",
            value: project.deliveryDelayDays > 0 ? `延期 ${project.deliveryDelayDays} 天` : "按计划推进",
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 truncate text-sm font-medium">{s.value}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <TabsTrigger value="basic">项目概览</TabsTrigger>
          <TabsTrigger value="scope">交付目标</TabsTrigger>
          <TabsTrigger value="cycle">周期与延期</TabsTrigger>
          <TabsTrigger value="records">动态与跟进</TabsTrigger>
          <TabsTrigger value="issues">问题池</TabsTrigger>
          <TabsTrigger value="changes">需求变更</TabsTrigger>
          <TabsTrigger value="risks">风险与延期</TabsTrigger>
          <TabsTrigger value="attachments">附件</TabsTrigger>
          <TabsTrigger value="history">
            <EntityAuditCount entityId={project.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-4 space-y-4">
          <TabGuide title="项目概览" description="查看项目归属、客户、合同、成员和当前状态。需要调整负责人、地点、标签或状态时，点击右上角“编辑项目”。" />
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-4 text-sm font-medium">项目概况</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <InfoRow label="项目名称">{project.name}</InfoRow>
              <InfoRow label="关联客户">
                <Link className="text-primary hover:underline" href={`/customers/${project.customerId}`}>
                  {project.customerName}
                </Link>
              </InfoRow>
              <InfoRow label="关联合同">
                <Link
                  className="text-primary hover:underline"
                  href={`/contracts/${project.sourceContractId}`}
                >
                  {project.sourceContractId}
                </Link>
              </InfoRow>
              {project.opportunityId ? (
                <InfoRow label="关联商机">
                  <Link
                    className="text-primary hover:underline"
                    href={`/opportunities/${project.opportunityId}`}
                  >
                    {project.opportunityId}
                  </Link>
                </InfoRow>
              ) : null}
              <InfoRow label="项目阶段">
                <Pill label={stageMeta.label} tone={stageMeta.tone} />
              </InfoRow>
              <InfoRow label="健康度">
                <Pill label={healthMeta.label} tone={healthMeta.tone} />
              </InfoRow>
              <InfoRow label="风险级别">
                <Pill label={riskMeta.label} tone={riskMeta.tone} />
              </InfoRow>
              <InfoRow label="项目所属团队">{project.teamName || "—"}</InfoRow>
              <InfoRow label="内容所属团队">{project.contentTeamName || "—"}</InfoRow>
              <InfoRow label="客户级别">{project.customerLevel || "P2"}</InfoRow>
            </dl>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-4 text-sm font-medium">项目成员</p>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {[
                { label: "项目经理", value: project.projectManager || "—" },
                { label: "项目负责人（项目经理 Leader）", value: project.projectLeader || "—" },
                { label: "销售人员", value: project.bizOwner || "—" },
                { label: "解决方案人员", value: project.contentOps || "—" },
                { label: "项目执行（可多选）", value: project.executionMembers.join("、") || project.executor || "—" },
                { label: "内容运营（可多选）", value: project.contentOpsMembers.join("、") || "—" },
              ].map((member) => (
                <div key={member.label} className="min-w-0 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                  <dt className="min-h-9 text-xs leading-5 text-muted-foreground">{member.label}</dt>
                  <dd className="mt-1 truncate whitespace-nowrap text-sm font-medium text-foreground" title={member.value}>
                    {member.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-4 text-sm font-medium">客户信息</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <InfoRow label="客户行业">{project.customerIndustry || "—"}</InfoRow>
              <InfoRow label="客户类型">{project.customerType || "—"}</InfoRow>
              <InfoRow label="客户地区">{project.customerRegion || "—"}</InfoRow>
              {(() => { const contact = parseProjectContact(project.contactInfo); return <>
                <InfoRow label="联系人姓名">{contact.name || "—"}</InfoRow>
                <InfoRow label="联系人电话">{contact.phone || "—"}</InfoRow>
                <InfoRow label="联系人微信">{contact.wechat || "—"}</InfoRow>
              </> })()}
              <InfoRow label="客户标签"><CustomerTagsPopover tags={project.customerTags} /></InfoRow>
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="scope" className="mt-4 space-y-4">
          <TabGuide title="交付目标" description="项目团队可直接维护项目类型、优化/监控意图、优化/检测平台与验收标准。销售提出的重大范围变化仍会通过“需求变更”页回传新 SOW 并保留原版本。" />
          {writable ? <div className="flex justify-end gap-2">{scopeEditing ? <><Button variant="outline" onClick={() => setScopeEditing(false)}>取消</Button><Button onClick={() => void saveScope()} disabled={scopeSaving}>{scopeSaving ? "保存中…" : "保存交付目标"}</Button></> : <Button variant="outline" className="gap-1.5" onClick={startScopeEdit}><Pencil className="size-4" />编辑交付目标</Button>}</div> : null}
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-3 text-sm font-medium">项目类型</p>
            {scopeEditing ? <div className="flex flex-wrap gap-2">{PROJECT_TYPE_OPTIONS.map((item) => { const selected=(scopeDraft.projectTypes||[]).includes(item); return <button type="button" key={item} onClick={() => setScopeDraft((d)=>({...d,projectTypes:selected?(d.projectTypes||[]).filter((value)=>value!==item):[...(d.projectTypes||[]),item]}))} className={`rounded-full border px-3 py-1.5 text-sm ${selected?"border-primary bg-primary text-primary-foreground":"border-border bg-background"}`}>{item}</button> })}</div> : <div className="flex flex-wrap gap-2">{PROJECT_TYPE_OPTIONS.filter((t) => project.projectTypes.includes(t)).map((t) => <ProjectTypeBadge key={t} type={t} />)}{!project.projectTypes.length ? <span className="text-sm text-muted-foreground">未设置</span> : null}</div>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5"><p className="mb-2 text-sm font-medium">优化意图数量</p>{scopeEditing ? <Input type="number" min={0} value={Number(scopeDraft.optimizationIntentCount||0)} onChange={(e)=>setScopeDraft((d)=>({...d,optimizationIntentCount:Number(e.target.value)}))} /> : <p className="text-3xl font-semibold tabular-nums">{project.intentBrand}</p>}<p className="mt-1 text-xs text-muted-foreground">需要执行优化动作的意图数</p></div>
            <div className="rounded-2xl border border-border bg-card p-5"><p className="mb-2 text-sm font-medium">监控意图数量</p>{scopeEditing ? <Input type="number" min={0} value={Number(scopeDraft.monitoringIntentCount||0)} onChange={(e)=>setScopeDraft((d)=>({...d,monitoringIntentCount:Number(e.target.value)}))} /> : <p className="text-3xl font-semibold tabular-nums">{project.monitoringIntentCount}</p>}<p className="mt-1 text-xs text-muted-foreground">只监控、不纳入优化交付的意图数</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[{label:"优化平台",key:"platforms" as const,values:project.platforms},{label:"检测平台",key:"detectionPlatforms" as const,values:project.detectionPlatforms}].map((group)=><div key={group.key} className="rounded-2xl border border-border bg-card p-5"><p className="mb-3 text-sm font-medium">{group.label}</p>{scopeEditing?<div className="flex flex-wrap gap-2">{PROJECT_PLATFORM_OPTIONS.map((item)=>{const selected=(scopeDraft[group.key]||[]).includes(item);return <button type="button" key={item} onClick={()=>setScopeDraft((d)=>({...d,[group.key]:selected?(d[group.key]||[]).filter((value)=>value!==item):[...(d[group.key]||[]),item]}))} className={`rounded-full border px-3 py-1.5 text-sm ${selected?"border-blue-500 bg-blue-50 text-blue-700":"border-border"}`}>{item}</button>})}</div>:<div className="flex flex-wrap gap-2">{group.values.length?group.values.map((item)=><Pill key={item} label={item} tone="info" />):<span className="text-sm text-muted-foreground">未设置</span>}</div>}</div>)}
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-2 text-sm font-medium">核心交付目标 / KPI</p>
            {scopeEditing ? <Textarea rows={4} value={String(scopeDraft.kpiNotes||"")} onChange={(e)=>setScopeDraft((d)=>({...d,kpiNotes:e.target.value}))} /> : <p className="whitespace-pre-wrap text-sm">
              {plainKpi || feishuKpi?.followUp || (feishuUrls.length ? "—" : project.kpiNotes || "—")}
            </p>}
            {feishuUrls.length > 0 ? (
              <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium">飞书关联文档</p>
                <ul className="mt-2 space-y-1.5">
                  {feishuUrls.map((u) => (
                    <li key={`${u.field}-${u.url}`} className="text-sm">
                      <span className="text-muted-foreground">{u.field || "链接"}：</span>
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {u.text || u.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-2 text-sm font-medium">验收标准</p>
            {scopeEditing ? <Textarea rows={4} value={String(scopeDraft.acceptanceCriteria||"")} onChange={(e)=>setScopeDraft((d)=>({...d,acceptanceCriteria:e.target.value}))} /> : <p className="whitespace-pre-wrap text-sm">{project.acceptanceCriteria || "—"}</p>}
          </div>
        </TabsContent>

        <TabsContent value="cycle" className="mt-4 space-y-4">
          <TabGuide title="周期与延期" description="按合同执行时间维护启动与交付。实际交付只区分未交付/已交付；最新 SOW 服务截止前 30 天触发续约预警，并在确认后通知该项目销售。" />
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-4 text-sm font-medium">周期</p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <InfoRow label="项目启动时间">{project.startDate || "未设置"}</InfoRow>
              <InfoRow label="计划启动时间">{project.plannedStartDate || "未设置"}</InfoRow>
              <InfoRow label="最新 SOW 服务截止">{project.latestDeliveryDate || project.sowEndDate || "未设置"}</InfoRow>
              <InfoRow label="实际交付状态"><Pill label={project.actualDeliveryDate ? "已交付" : "未交付"} tone={project.actualDeliveryDate ? "success" : "warning"} /></InfoRow>
              <InfoRow label="实际交付时间">{project.actualDeliveryDate || "—"}</InfoRow>
              <InfoRow label="自动计算延期">{project.deliveryDelayDays > 0 ? `${project.deliveryDelayDays} 天` : "未延期"}</InfoRow>
            </dl>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">距到期天数</p>
                <p className="mt-1 text-sm font-medium">
                  {project.daysToSowEnd != null ? `${project.daysToSowEnd}` : "未设置 SOW"}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">延期时长</p>
                <p className="mt-1 text-sm font-medium">
                  {project.delayDurationDays != null ? `${project.delayDurationDays} 天` : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">续约预警</p>
                <p className="mt-1 text-sm font-medium">{project.renewalWarning ? "已触发（最新 SOW 服务截止前 30 天）" : "未触发"}</p>
                <p className="mt-1 text-xs text-muted-foreground">续约确认：{project.renewalStatus === "yes" ? "是" : project.renewalStatus === "no" ? "否" : "待确认"}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-2 text-sm font-medium">延期原因</p>
            <p className="whitespace-pre-wrap text-sm">{project.delayReason || "—"}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><p className="mb-1 text-sm font-medium">补救措施</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{project.remediationPlan || "—"}</p></div>
              <div><p className="mb-1 text-sm font-medium">客户沟通情况</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{project.delayCustomerNote || "—"}</p></div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="records" className="mt-4 outline-none">
          <ProjectActivityPanel project={project} writable={writable} />
        </TabsContent>

        <TabsContent value="issues" className="mt-4 outline-none">
          <ProjectProblemPool projectId={project.id} projectName={project.name} writable={writable} />
        </TabsContent>

        <TabsContent value="changes" className="mt-4 outline-none">
          <ProjectSowPanel projectId={project.id} writable={false} onPublished={load} />
        </TabsContent>

        <TabsContent value="risks" className="mt-4 space-y-4 outline-none">
          <TabGuide title="风险与延期" description="提前登记可能影响交付的风险；已经发生延期时记录原因、预计延期天数、补救措施和客户沟通情况。所有记录同步进入项目时间线。" />
          <ProjectWorkItemsPanel projectId={project.id} kinds={["risk", "delay"]} writable={writable} title="风险与延期" description="风险和延期新建后默认为处理中，问题排除或延期关闭后标记为已解决；延期天数依据计划交付日期自动计算。" />
        </TabsContent>

        <TabsContent value="attachments" className="mt-4 outline-none">
          <ProjectAttachmentsPanel projectId={project.id} writable={writable} />
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4 outline-none">
          <TabGuide title="操作历史" description="用于审计项目资料的修改记录。业务过程请查看“动态与跟进”，这里主要回答“谁在什么时候改了什么字段”。" />
          <EntityAuditHistory entityId={project.id} embedded />
        </TabsContent>

      </Tabs>

      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(false)
            setDraft({})
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑项目</DialogTitle>
            <DialogDescription>维护项目阶段、健康度、客户分层、团队成员、交付状态与续约结论。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">项目名称</span>
              <Input
                value={String(val("name", project.name))}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">项目状态</span>
                <SearchableSelect
                  value={String(val("stage", project.stage))}
                  onChange={(v) => setDraft((d) => ({ ...d, stage: v as ProjectStage }))}
                  options={(Object.keys(PROJECT_STAGE_META) as ProjectStage[]).map((x) => ({
                    value: x,
                    label: PROJECT_STAGE_META[x].label,
                  }))}
                  placeholder="选择阶段"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">健康度</span>
                <SearchableSelect
                  value={String(val("health", project.health))}
                  onChange={(v) => setDraft((d) => ({ ...d, health: v as ProjectHealth }))}
                  options={(Object.keys(PROJECT_HEALTH_META) as ProjectHealth[]).map((x) => ({
                    value: x,
                    label: PROJECT_HEALTH_META[x].label,
                  }))}
                  placeholder="选择健康度"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">风险级别</span>
                <SearchableSelect
                  value={String(val("riskLevel", project.riskLevel))}
                  onChange={(v) => setDraft((d) => ({ ...d, riskLevel: v as ProjectRisk }))}
                  options={(Object.keys(PROJECT_RISK_META) as ProjectRisk[]).map((x) => ({
                    value: x,
                    label: PROJECT_RISK_META[x].label,
                  }))}
                  placeholder="选择风险级别"
                />
              </label>
            </div>
            <MemberPicker
              label="项目经理（单选）"
              value={singleMember(String(val("projectManager", project.projectManager)))}
              onChange={(v) => setDraft((d) => ({ ...d, projectManager: v[v.length - 1] || "" }))}
            />
            <MemberPicker
              label="项目负责人 / 项目经理 Leader（单选）"
              value={singleMember(String(val("projectLeader", project.projectLeader)))}
              onChange={(v) => setDraft((d) => ({ ...d, projectLeader: v[v.length - 1] || "" }))}
            />
            <MemberPicker
              label="销售人员（单选）"
              value={singleMember(String(val("bizOwner", project.bizOwner)))}
              onChange={(v) => setDraft((d) => ({ ...d, bizOwner: v[v.length - 1] || "" }))}
            />
            <MemberPicker
              label="解决方案人员（单选）"
              value={singleMember(String(val("contentOps", project.contentOps)))}
              onChange={(v) => setDraft((d) => ({ ...d, contentOps: v[v.length - 1] || "" }))}
            />
            <MemberPicker
              label="项目执行（可多选）"
              value={val("executionMembers", project.executionMembers) as string[]}
              onChange={(v) => setDraft((d) => ({ ...d, executionMembers: v, executor: v[0] || "" }))}
            />
            <MemberPicker
              label="内容运营（可多选）"
              value={val("contentOpsMembers", project.contentOpsMembers) as string[]}
              onChange={(v) => setDraft((d) => ({ ...d, contentOpsMembers: v }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">项目所属团队</span><SearchableSelect value={String(val("teamName", project.teamName))} onChange={(v) => setDraft((d) => ({ ...d, teamName: v }))} options={["A组", "B组", "C组", "厦门组"].map((value)=>({value,label:value}))} placeholder="选择项目所属团队" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">内容所属团队</span><SearchableSelect value={String(val("contentTeamName", project.contentTeamName))} onChange={(v) => setDraft((d) => ({ ...d, contentTeamName: v }))} options={["A组", "B组", "C组", "厦门组"].map((value)=>({value,label:value}))} placeholder="选择内容所属团队" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">客户级别</span><SearchableSelect value={String(val("customerLevel", project.customerLevel || "P2"))} onChange={(v) => setDraft((d) => ({ ...d, customerLevel: v }))} options={["P0","P1","P2"].map((value)=>({value,label:value}))} placeholder="选择客户级别" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">客户标签（逗号分隔）</span><Input value={(val("customerTags", project.customerTags) as string[]).join("、")} onChange={(e) => setDraft((d) => ({ ...d, customerTags: e.target.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) }))} placeholder="重点客户、续约潜力" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">联系人姓名</span><Input value={String(val("contactName", ""))} onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))} placeholder="例如：张三" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">联系人电话</span><Input value={String(val("contactPhone", ""))} onChange={(e) => setDraft((d) => ({ ...d, contactPhone: e.target.value }))} placeholder="例如：13800000000" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">联系人微信</span><Input value={String(val("contactWechat", ""))} onChange={(e) => setDraft((d) => ({ ...d, contactWechat: e.target.value }))} placeholder="例如：zhangsan" /></label>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">项目类型、平台、优化与监控意图请在“交付目标”页直接编辑；销售回传的新 SOW 与原版本在“需求变更”页留存。</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">项目启动时间</span>
                <DatePicker
                  value={String(val("startDate", project.startDate || ""))}
                  onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="text-muted-foreground">计划启动时间</span>
                <DatePicker
                  value={String(val("plannedStartDate", project.plannedStartDate || ""))}
                  onChange={(v) => setDraft((d) => ({ ...d, plannedStartDate: v }))}
                />
              </label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">实际交付</span><SearchableSelect value={String(val("actualDeliveryDate", project.actualDeliveryDate || "")) ? "delivered" : "pending"} onChange={(v) => setDraft((d) => ({ ...d, actualDeliveryDate: v === "delivered" ? new Date().toISOString().slice(0,10) : "" }))} options={[{value:"pending",label:"未交付"},{value:"delivered",label:"已交付"}]} placeholder="选择交付状态" /></label>
              <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">是否续约</span><SearchableSelect value={String(val("renewalStatus", project.renewalStatus))} onChange={(v) => setDraft((d) => ({ ...d, renewalStatus: v as ""|"yes"|"no" }))} options={[{value:"",label:"待确认"},{value:"yes",label:"是"},{value:"no",label:"否"}]} placeholder="最新 SOW 服务截止前一个月确认" /></label>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">延期风险类型</span>
              <SearchableSelect value={DELAY_RISK_OPTIONS.includes(String(val("delayReason", project.delayReason))) ? String(val("delayReason", project.delayReason)) : "custom"} onChange={(v) => setDraft((d) => ({ ...d, delayReason: v === "custom" ? "" : v }))} options={[...DELAY_RISK_OPTIONS.map((value)=>({value,label:value})),{value:"custom",label:"自定义"}]} placeholder="选择延期风险类型" />
            </label>
            {!DELAY_RISK_OPTIONS.includes(String(val("delayReason", project.delayReason))) ? <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">自定义延期风险</span><Input value={String(val("delayReason", project.delayReason))} onChange={(e)=>setDraft((d)=>({...d,delayReason:e.target.value}))} placeholder="填写其他延期风险类型" /></label> : null}
            <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">补救措施</span><Textarea rows={3} value={String(val("remediationPlan", project.remediationPlan))} onChange={(e) => setDraft((d) => ({ ...d, remediationPlan: e.target.value }))} /></label><label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">延期客户沟通情况</span><Textarea rows={3} value={String(val("delayCustomerNote", project.delayCustomerNote))} onChange={(e) => setDraft((d) => ({ ...d, delayCustomerNote: e.target.value }))} /></label></div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(false)
                setDraft({})
              }}
            >
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
