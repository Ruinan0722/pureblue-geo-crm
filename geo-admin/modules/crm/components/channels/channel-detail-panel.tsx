"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, CalendarClock, Check, ChevronRight, Copy, ExternalLink, History, Mail, MessageSquarePlus, Pencil, Phone, Plus, Star, Target } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { InfoRow } from "../ui"
import { channelOpportunityUrl, channelContractUrl, channelContractCreateUrl, fetchChannelResource, type ChannelContact, type ChannelContract, type ChannelFollowUp, type ChannelHistory, type ChannelOpportunity, type ChannelPartner } from "@/modules/crm/services/channel-management"
import { ChannelResourceDialog, ChannelSignDialog, ChannelStageDialog, type ChannelResource, type StageTarget } from "./channel-action-dialogs"
import { ChannelPartnerDialog } from "./channel-partner-dialog"
import { ChannelBadge, ChannelEmpty, ChannelError, ChannelLoading, ChannelReturnFocusContext, NativeSelect, StageProgress, displayDate } from "./channel-ui"

import { ecosystemSource } from "../../lib/ecosystem-sources"
import { PartnerFollowUpTab } from "./partner-follow-up-tab"


export type ChannelTab = "requirements" | "execution" | "overview" | "follow-ups" | "contacts" | "opportunities" | "contracts" | "history"
const TABS: { key: ChannelTab; label: string }[] = [
  { key: "overview", label: "基本信息" }, { key: "contacts", label: "联系人" }, { key: "follow-ups", label: "跟进记录" },
  { key: "opportunities", label: "商机" }, { key: "contracts", label: "合同" }, { key: "history", label: "操作历史" },
]
type DetailData = { contacts: ChannelContact[]; followups: ChannelFollowUp[]; opportunities: ChannelOpportunity[]; contracts: ChannelContract[]; history: ChannelHistory[] }
const EMPTY: DetailData = { contacts: [], followups: [], opportunities: [], contracts: [], history: [] }

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  return <InfoRow label={label}>{value || "—"}</InfoRow>
}

function InfoCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b px-5 py-3.5"><h3 className="text-sm font-semibold">{title}</h3>{action}</div><div className="p-5">{children}</div></section>
}

export function ChannelDetailPanel({ partner, initialTab = "overview", onClose, onSaved, onChanged }: {
  partner: ChannelPartner; initialTab?: ChannelTab; onClose: () => void; onSaved: (partner: ChannelPartner) => void; onChanged: () => void
}) {
  const { user, canAccess } = useAuth()
  const ecosystem = partner.partnerType === "strategic_ecosystem"
  const canWrite = Boolean(user?.permissions.includes("channels:write"))
  const canCreate = canWrite || Boolean(user?.permissions.includes("channels:create"))
  const canViewOpportunities = canAccess("opportunities")
  const canViewContracts = canAccess("contracts")
  const canCreateOpportunity = canViewOpportunities && Boolean(user?.permissions.some((code) => ["opportunities:write", "opportunities:create"].includes(code)))
  const [tab, setTabState] = useState<ChannelTab>(initialTab === "requirements" || initialTab === "execution" ? "overview" : initialTab)
  function setTab(value: ChannelTab) {
    setTabState(value)
    window.history.replaceState(null, "", window.location.pathname + (value === "overview" ? "" : "?tab=" + value))
  }
  const [data, setData] = useState<DetailData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [resource, setResource] = useState<ChannelResource | null>(null)
  const [editing, setEditing] = useState(false)
  const [stageTarget, setStageTarget] = useState<StageTarget | null>(null)
  const [signTarget, setSignTarget] = useState<ChannelContract | null>(null)
  const [contactFilter, setContactFilter] = useState("")
  const requestId = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const load = useCallback(async (showLoading = true) => {
    const request = ++requestId.current
    if (showLoading) setLoading(true)
    setError("")
    try {
      const [contacts, followups, opportunities, contracts, history] = await Promise.all([
        fetchChannelResource<ChannelContact[]>(partner.id, "contacts"),
        fetchChannelResource<ChannelFollowUp[]>(partner.id, "follow-ups"),
        canViewOpportunities ? fetchChannelResource<ChannelOpportunity[]>(partner.id, "opportunities") : Promise.resolve([]),
        canViewContracts ? fetchChannelResource<ChannelContract[]>(partner.id, "contracts") : Promise.resolve([]),
        fetchChannelResource<ChannelHistory[]>(partner.id, "history"),
      ])
      if (request === requestId.current) setData({ contacts, followups, opportunities, contracts, history })
    } catch (caught) {
      if (request === requestId.current) setError(caught instanceof Error ? caught.message : "客户详情加载失败。")
    } finally { if (request === requestId.current) setLoading(false) }
  }, [partner.id, canViewOpportunities, canViewContracts])
  useEffect(() => { void load(); return () => { requestId.current += 1 } }, [load])

  function saved() {
    if (resource) setTab(resource)
    setResource(null); setStageTarget(null); setSignTarget(null)
    void load(false); onChanged()
  }
  const counts: Partial<Record<ChannelTab, number>> = { contacts: data.contacts.length, "follow-ups": data.followups.length, opportunities: data.opportunities.length, contracts: data.contracts.length }
  const primaryContact = data.contacts.find((contact) => contact.isPrimary) ?? data.contacts[0]
  const latest = data.followups[0]
  const nextDates = data.followups.map((follow) => follow.nextFollowAt).filter((value): value is string => Boolean(value)).sort()
  const upcoming = nextDates.find((value) => value >= new Date().toLocaleDateString("sv-SE"))
  const followups = contactFilter ? data.followups.filter((follow) => follow.contactId === contactFilter) : data.followups
  const website = partner.website && /^https?:\/\//i.test(partner.website) ? partner.website : null
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success("已复制") }
    catch { toast.error("复制失败，请手动选择后复制。") }
  }
  const actionButton = (type: ChannelResource, label: string) => type === "contracts" ? canAccess("contracts") && <Button asChild size="sm" variant="outline"><Link href={channelContractCreateUrl(partner.id, undefined, partner.partnerType)}><Plus className="size-3.5" />{label}</Link></Button> : <Button size="sm" variant="outline" onClick={() => setResource(type)}><Plus className="size-3.5" />{label}</Button>

  return <ChannelReturnFocusContext.Provider value={panelRef}>
    <div ref={panelRef} tabIndex={-1} className="relative mx-auto max-w-6xl px-5 py-6 pb-24 outline-none lg:px-8">
      <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回{ecosystem ? "战略生态" : "渠道"}列表</button>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight">{partner.level === "重点合作" && <Star className="size-5 fill-amber-400 text-amber-400" />}{ecosystem ? partner.brandName || partner.name : partner.name}{!ecosystem && <ChannelBadge value={partner.contractStatus} kind="contract" />}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ecosystem ? partner.name || "战略生态客户" : [partner.channelType, partner.region, partner.city, partner.ownerName].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && <><Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-4" />编辑</Button>{!ecosystem && <Button variant="outline" className="gap-1.5" disabled={loading} onClick={() => setTab("follow-ups")}><MessageSquarePlus className="size-4" />记录跟进</Button>}</>}
          {canCreateOpportunity && <Button className="gap-1.5" onClick={() => setResource("opportunities")}><Target className="size-4" />创建商机</Button>}
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as ChannelTab)} className="mt-6">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          {TABS.filter((item) => item.key !== "opportunities" || canViewOpportunities).filter((item) => item.key !== "contracts" || canViewContracts).map((item) => <TabsTrigger key={item.key} value={item.key}>{ecosystem ? ({ contacts: "对接人", opportunities: "关联商机", contracts: "关联合同", history: "历史记录" } as Partial<Record<ChannelTab, string>>)[item.key] || item.label : item.label}{counts[item.key] !== undefined ? " (" + (loading ? "…" : counts[item.key]) + ")" : ""}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <ChannelError message={error} retry={() => void load()} />
          {loading ? <ChannelLoading label={ecosystem ? "正在加载战略生态客户详情…" : "正在加载渠道详情…"} /> : error && data === EMPTY ? null : <>
            {tab === "overview" && ecosystem && <InfoCard title="基本信息"><dl>
              <InfoItem label="品牌名称" value={partner.brandName} />
              <InfoItem label="公司名称" value={partner.name} />
              <InfoItem label="行业" value={partner.industries.join("、")} />
              <InfoItem label="城市" value={partner.city} />
              <InfoItem label="项目来源（一级）" value={ecosystemSource(partner.source, partner.sourceDetail).source || partner.source} />
              <InfoItem label="项目来源（二级）" value={ecosystemSource(partner.source, partner.sourceDetail).sourceDetail} />
              <InfoItem label="BD 负责人" value={partner.bdNames?.join("、")} />
              <InfoItem label="战略生态对接部门" value={partner.ecosystemDepartment} />
            </dl></InfoCard>}
            {tab === "overview" && !ecosystem && <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]"><InfoCard title="基本信息"><dl>
                <InfoItem label={ecosystem ? "公司名称" : "渠道名称"} value={partner.name} />
                {ecosystem && <><InfoItem label="品牌名称" value={partner.brandName} /><InfoItem label="客户类型" value={partner.customerType} /><InfoItem label="子类型" value={partner.customerSubtype} /></>}
                <InfoItem label={ecosystem ? "所属行业" : "意向行业"} value={partner.industries.join("、")} />
                <InfoItem label="所在地区" value={[partner.region, partner.city].filter(Boolean).join(" · ")} />
                <InfoItem label={ecosystem ? "项目来源" : "渠道来源"} value={[partner.source, partner.sourceDetail].filter(Boolean).join(" / ")} />
                <InfoItem label={ecosystem ? "负责人" : "渠道负责人"} value={partner.ownerName} />
                <InfoItem label="合同状态" value={partner.contractStatus === "是" ? "已签约" : partner.contractStatus === "否" ? "未签约" : partner.contractStatus} />
                {!ecosystem && <><InfoItem label="渠道类型" value={partner.channelType} /><InfoItem label="合作级别" value={partner.level} /><InfoItem label="资料单渠道类型" value={partner.cooperationType} /><InfoItem label="意向签约方式" value={partner.signingMethod} /><InfoItem label="代理类型" value={partner.agencyTypes.join("、")} /><InfoItem label="团队支持" value={partner.teamSupport ? "有团队支持" : "无团队支持"} /><InfoItem label="主要客户" value={partner.majorCustomers} /></>}
                <InfoItem label="合作项目" value={partner.cooperationProject} />
                <InfoRow label="公司官网">{website ? <a className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline" href={website} target="_blank" rel="noopener noreferrer">{partner.website?.replace(/^https?:\/\//, "")}<ExternalLink className="size-3 shrink-0" /></a> : partner.website || "—"}</InfoRow>
                <InfoItem label="创建人" value={partner.createdByName} /><InfoItem label="创建时间" value={displayDate(partner.createdAt, true)} />
              </dl></InfoCard><div className="space-y-4"><InfoCard title="最近动态" action={<button type="button" className="flex items-center gap-1 text-xs text-primary" onClick={() => setTab("follow-ups")}>全部跟进<ChevronRight className="size-3" /></button>}>
                {latest ? <><p className="whitespace-pre-wrap break-words text-sm leading-7">{latest.content}</p><div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>{latest.authorName} · {displayDate(latest.createdAt, true)}</span>{upcoming && <span className="flex items-center gap-1 text-primary"><CalendarClock className="size-3.5" />下次跟进 {displayDate(upcoming)}</span>}</div></> : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">还没有跟进记录，记录第一次沟通吧。</p>{canWrite && actionButton("follow-ups", "记录跟进")}</div>}
              </InfoCard><InfoCard title="主要联系人" action={canWrite ? actionButton("contacts", "添加联系人") : undefined}>
                {primaryContact ? <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-sm font-medium">{primaryContact.name}</span>{primaryContact.title && <span className="ml-2 text-xs text-muted-foreground">{primaryContact.title}</span>}<p className="mt-2 text-xs text-muted-foreground">{primaryContact.phone || primaryContact.method || "暂未填写联系方式"}</p></div><Button variant="ghost" size="sm" onClick={() => setTab("contacts")}>查看联系人<ChevronRight className="size-3.5" /></Button></div> : <p className="text-sm text-muted-foreground">暂无联系人</p>}
              </InfoCard></div></div>}
            {tab === "follow-ups" && <PartnerFollowUpTab key={partner.id} partner={partner} contacts={data.contacts} followups={data.followups} opportunities={data.opportunities} canWrite={canWrite} onSaved={() => { void load(false); onChanged() }} />}
            {tab === "contacts" && <div className="space-y-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{ecosystem ? "战略生态对接人" : "渠道联系人"}</h3>{canWrite && actionButton("contacts", "添加联系人")}</div>
              {data.contacts.length ? <div className="grid gap-3 sm:grid-cols-2">{data.contacts.map((contact) => <article key={contact.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium">{contact.name.slice(0, 1)}</span><h4 className="text-sm font-semibold">{contact.name}</h4></div>{contact.isPrimary && <span className="rounded bg-primary/8 px-2 py-1 text-[10px] font-medium text-primary">主要联系人</span>}</div>
                <div className="mt-4 space-y-3 text-xs">{(contact.contactType || contact.department || contact.title) && <p className="text-muted-foreground">{[contact.contactType === "direct" ? "直客对接" : contact.contactType === "strategic_ecosystem" ? "战略生态对接" : null, contact.department, contact.title].filter(Boolean).join(" · ")}</p>}{contact.phone && <div className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground" /><a href={"tel:" + contact.phone} className="min-w-0 flex-1 truncate hover:text-primary">{contact.phone}</a><button type="button" aria-label={"复制" + contact.name + "的电话"} onClick={() => void copy(contact.phone!)} className="text-muted-foreground hover:text-primary"><Copy className="size-3.5" /></button></div>}{contact.method && <p className="flex items-start gap-2 break-all"><Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{contact.method}</p>}{!contact.phone && !contact.method && <p className="text-muted-foreground">暂未填写联系方式</p>}</div>
              </article>)}</div> : <ChannelEmpty title="还没有联系人" description="添加主要对接人，后续跟进时可直接选择沟通对象。" action={canWrite && actionButton("contacts", "添加联系人")} />}
            </div>}
            {tab === "opportunities" && <div className="space-y-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">合作商机</h3>{canCreateOpportunity && actionButton("opportunities", "创建商机")}</div>
              {data.opportunities.length ? data.opportunities.map((opportunity) => <article key={opportunity.id} className="rounded-xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{opportunity.name}</h4><p className="mt-2 text-xs text-muted-foreground">负责人：{opportunity.ownerName || "未分配"}</p></div><ChannelBadge value={opportunity.stage} kind="stage" /></div>
                {canAccess("opportunities") && <Link href={channelOpportunityUrl(opportunity.id, partner.partnerType)} className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline">在商机管理中查看<ChevronRight className="size-3" /></Link>}
                {canCreate && canAccess("contracts") && opportunity.stage !== "输单" && <div className="mt-4"><Button asChild variant="outline" size="sm"><Link href={channelContractCreateUrl(partner.id, opportunity.id, partner.partnerType)}>转为合同<ChevronRight className="size-3.5" /></Link></Button></div>}
                {opportunity.lostReason && <p className="mt-4 rounded-lg bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">输单原因：{opportunity.lostReason}</p>}
                {canViewOpportunities && <div className="mt-5 flex justify-end border-t pt-4"><Button asChild size="sm" variant="outline"><Link href={channelOpportunityUrl(opportunity.id)}>查看及推进商机<ChevronRight className="size-3.5" /></Link></Button></div>}
              </article>) : <ChannelEmpty title="还没有合作商机" description="将明确的合作意向创建为商机，持续跟踪从需求确认到赢单的进度。" action={canCreateOpportunity && actionButton("opportunities", "创建商机")} />}
            </div>}
            {tab === "contracts" && <div className="space-y-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{ecosystem ? "战略生态合同" : "渠道合作合同"}</h3>{canCreate && actionButton("contracts", "新建合同")}</div>
              {data.contracts.length ? data.contracts.map((contract) => <article key={contract.id} className="rounded-xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{contract.name}</h4><p className="mt-2 text-xs text-muted-foreground">合同编号：{contract.contractNumber || "未登记"}</p></div><ChannelBadge value={contract.status} kind="contract" /></div>
                <p className="mt-4 text-xs text-muted-foreground">关联商机：{data.opportunities.find((item) => item.id === contract.opportunityId)?.name || "未关联"}</p>
                {canAccess("contracts") && <Link href={channelContractUrl(contract.id, partner.partnerType)} className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">在{ecosystem ? "战略生态" : "渠道"}合同中查看<ChevronRight className="size-3" /></Link>}
                <div className="mt-5 flex items-center justify-between border-t pt-4">{contract.status === "是" ? <span className="flex items-center gap-1.5 text-xs text-emerald-700"><Check className="size-3.5" />{contract.signedAt ? displayDate(contract.signedAt) + " 已签约" : "已签约"}</span> : <><span className="text-xs text-muted-foreground">等待完成签署</span>{canWrite && <Button size="sm" variant="outline" onClick={() => setSignTarget(contract)}>确认已签约</Button>}</>}</div>
              </article>) : <ChannelEmpty title={ecosystem ? "还没有战略生态合同" : "还没有渠道合同"} description="登记合作协议并关联商机；完成签署后可同步合作进度。" action={canCreate && actionButton("contracts", "新建合同")} />}
            </div>}
            {tab === "history" && <section className="rounded-xl border bg-card p-5">
              <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold"><History className="size-4" />操作历史</h3>
              {data.history.length ? <ol className="ml-1 border-l pl-5">{data.history.map((item) => <li key={item.id} className="relative pb-6 last:pb-0"><span className="absolute -left-[25px] top-1.5 size-2 rounded-full border-2 border-card bg-primary/60 ring-2 ring-muted" /><p className="whitespace-pre-wrap break-words text-sm leading-6">{item.detail || item.action}</p><p className="mt-2 text-xs text-muted-foreground">{item.actorName} · {displayDate(item.createdAt, true)}</p></li>)}</ol> : <ChannelEmpty title="暂无操作记录" description="客户资料、跟进、商机和合同的变更会显示在这里。" />}
            </section>}
          </>}
        </TabsContent>
      </Tabs>
    </div>
      {resource && <ChannelResourceDialog key={resource} resource={resource} partnerId={partner.id} partnerName={partner.name || partner.brandName || ""} partnerType={partner.partnerType} contacts={data.contacts} opportunities={data.opportunities} onClose={() => setResource(null)} onSaved={saved} />}
      {stageTarget && <ChannelStageDialog target={stageTarget} onClose={() => setStageTarget(null)} onSaved={saved} />}
      {signTarget && <ChannelSignDialog contract={signTarget} partnerId={partner.id} partnerName={partner.name || partner.brandName || ""} opportunityName={data.opportunities.find((item) => item.id === signTarget.opportunityId)?.name} onClose={() => setSignTarget(null)} onSaved={saved} />}
      {editing && <ChannelPartnerDialog partner={partner} onClose={() => setEditing(false)} onSaved={(updated) => { setEditing(false); onSaved(updated) }} />}
  </ChannelReturnFocusContext.Provider>
}
