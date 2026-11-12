"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { CHANNEL_AGENCY_TYPES, CHANNEL_LEVELS, CHANNEL_REGIONS, CHANNEL_TYPES, INDUSTRIES, LEAD_SOURCES, leadSourceSecondaryConfig } from "@/modules/crm/lib/crm-data"
import { fetchStaffDirectoryMembers, type DirectoryMember } from "@/modules/crm/services/crm-directory"
import { fetchLeadSourceOptions, type LeadSourceOption } from "@/modules/crm/services/crm-api"
import { createChannel, updateChannel, type ChannelPartner } from "@/modules/crm/services/channel-management"
import { ChannelError, ChannelModal, Field, NativeSelect, SaveButton, useChannelFormId } from "./channel-ui"

import { EcosystemPartnerDialog } from "./ecosystem-partner-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { ecosystemForm, ecosystemBody, EcosystemFields } from "./ecosystem-fields"
import { fetchChannelResource, type ChannelOpportunity } from "../../services/channel-management"

function formFor(partner?: ChannelPartner | null) {
  return {
    ...ecosystemForm(partner),
    name: partner?.name ?? "", brandName: partner?.brandName ?? "", channelType: partner?.channelType ?? "", level: partner?.level ?? "",
    source: partner?.source ?? "", sourceDetail: partner?.sourceDetail ?? "", ownerUserId: partner?.ownerUserId ?? "",
    region: partner?.region ?? "", city: partner?.city ?? "", website: partner?.website ?? "",
    industries: partner?.industries ?? [], majorCustomers: partner?.majorCustomers ?? "",
    agencyTypes: partner?.agencyTypes ?? [], teamSupport: partner?.teamSupport ?? false,
    cooperationProject: partner?.cooperationProject ?? "",
  }
}

function LegacyChannelPartnerDialog({ partner, partnerType = "channel", onClose, onSaved }: {
  partner?: ChannelPartner | null; partnerType?: "channel" | "strategic_ecosystem"; onClose: () => void; onSaved: (partner: ChannelPartner) => void
}) {
  const ecosystem = (partner?.partnerType ?? partnerType) === "strategic_ecosystem"
  const { user } = useAuth()
  const formId = useChannelFormId()
  const [initial] = useState(() => formFor(partner))
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [formTab, setFormTab] = useState("company")
  const [opportunities, setOpportunities] = useState<ChannelOpportunity[]>([])
  const [directory, setDirectory] = useState<DirectoryMember[]>([])
  const [sources, setSources] = useState<LeadSourceOption[]>([])
  const [optionsError, setOptionsError] = useState("")
  const [more, setMore] = useState(Boolean(partner?.website || partner?.majorCustomers || partner?.industries.length || partner?.cooperationProject))
  const dirty = JSON.stringify(initial) !== JSON.stringify(form)
  const canAssign = ["admin", "super_admin", "ops", "leader", "sales_leader"].includes(user?.role ?? "")
  const secondary = useMemo(() => leadSourceSecondaryConfig(form.source, sources.filter((item) => item.primarySource === form.source && item.enabled).map((item) => item.displayName)), [form.source, sources])
  const ownerOptions = useMemo(() => {
    const members = new Map<string, { value: string; label: string }>()
    if (user) members.set(user.id, { value: user.id, label: user.name + "（我）" })
    directory.forEach((member) => members.set(member.id, { value: member.id, label: member.name + (member.id === user?.id ? "（我）" : member.departmentNames?.length ? " · " + member.departmentNames[0] : "") }))
    return [...members.values()]
  }, [directory, user])

  useEffect(() => {
    let active = true
    void fetchLeadSourceOptions().then((items) => { if (active) setSources(items) }).catch(() => { if (active) setOptionsError("来源选项暂时未加载，可稍后重试。") })
    if (partner && ecosystem) void fetchChannelResource<ChannelOpportunity[]>(partner.id, "opportunities").then((items) => { if (active) setOpportunities(items) }).catch(() => undefined)
    if (ecosystem || (canAssign && !partner)) {
      void fetchStaffDirectoryMembers({ managedOnly: ["leader", "sales_leader"].includes(user?.role ?? "") }).then((items) => { if (active) setDirectory(items) }).catch(() => { if (active) setOptionsError("通讯录暂时未加载，当前可由你本人负责。") })
    }
    return () => { active = false }
  }, [canAssign, ecosystem, partner, user?.role])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    if (error) setError("")
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!form.name.trim()) { setError(ecosystem ? "请填写公司名称。" : "请填写渠道主体名称。"); return }
    if ((secondary.mode === "select" || secondary.mode === "text") && !form.sourceDetail.trim()) {
      setError("请填写" + secondary.label + "。"); return
    }
    let website = form.website.trim()
    if (website) {
      if (!/^https?:\/\//i.test(website)) website = "https://" + website
      try { const url = new URL(website); if (!url.hostname.includes(".")) throw new Error() }
      catch { setError("请填写有效的公司官网地址，例如 pureblue.ai。"); return }
    }
    setBusy(true); setError("")
    try {
      const body = { ...form, ...ecosystemBody(form), partnerType: ecosystem ? "strategic_ecosystem" : "channel", brandName: form.brandName.trim() || null, name: form.name.trim(), ownerUserId: partner ? undefined : form.ownerUserId || user?.id,
        channelType: form.channelType || null, level: form.level || null, source: form.source || null, sourceDetail: form.sourceDetail.trim() || null,
        region: form.region || null, city: form.city || null, website: website || null,
        majorCustomers: form.majorCustomers.trim() || null, cooperationProject: form.cooperationProject.trim() || null }
      const result = partner ? await updateChannel(partner.id, body) : await createChannel(body)
      toast.success(partner ? (ecosystem ? "战略生态资料已保存" : "渠道资料已保存") : (ecosystem ? "战略生态客户已创建" : "渠道伙伴已创建"))
      onSaved(partner ? { ...result, contractStatus: partner.contractStatus } : result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，请重试。") }
    finally { setBusy(false) }
  }

  return <ChannelModal open onClose={onClose} dirty={dirty} busy={busy} wide
    title={partner ? (ecosystem ? "编辑战略生态资料" : "编辑渠道资料") : (ecosystem ? "新建战略生态客户" : "新建渠道伙伴")}
    description={partner ? partner.name : (ecosystem ? "直接建立战略生态客户档案，联系人、跟进和合作商机可在详情中继续添加。" : "先建立渠道档案，联系人、跟进和合作商机可在详情中继续添加。")}
    footer={<SaveButton busy={busy} form={formId} label={partner ? "保存修改" : (ecosystem ? "创建客户档案" : "创建渠道")} />}>
    <form id={formId} onSubmit={submit} className="space-y-6">
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <ChannelError message={error} />
        <Tabs value={formTab} onValueChange={setFormTab}>
          {ecosystem && <TabsList className="mb-4"><TabsTrigger value="company">企业信息</TabsTrigger><TabsTrigger value="requirements">合作需求</TabsTrigger><TabsTrigger value="execution">项目执行</TabsTrigger></TabsList>}
          <TabsContent value="company" className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">基本资料</h3>
          {ecosystem && <Field label="品牌" required><Input autoFocus required maxLength={255} value={form.brandName} placeholder="输入品牌名称" onChange={(e) => set("brandName", e.target.value)} /></Field>}
          <Field label={ecosystem ? "公司名称" : "渠道主体名称"} required><Input autoFocus={!ecosystem} required maxLength={255} value={form.name} placeholder={ecosystem ? "输入公司名称" : "输入公司、机构或个人名称"} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {!ecosystem && <><Field label="渠道类型"><NativeSelect label="渠道类型" value={form.channelType} options={CHANNEL_TYPES} onChange={(value) => set("channelType", value)} /></Field>
            <Field label="合作级别"><NativeSelect label="合作级别" value={form.level} options={CHANNEL_LEVELS} onChange={(value) => set("level", value)} /></Field></>}
            <Field label={ecosystem ? "项目来源" : "渠道来源"}><NativeSelect label={ecosystem ? "项目来源" : "渠道来源"} value={form.source} options={LEAD_SOURCES} onChange={(value) => setForm((current) => ({ ...current, source: value, sourceDetail: "" }))} /></Field>
            {secondary.mode !== "none" && <Field label={secondary.label} required>
              {secondary.mode === "select" ? <NativeSelect label={secondary.label} value={form.sourceDetail} options={secondary.options} placeholder={secondary.placeholder} required onChange={(value) => set("sourceDetail", value)} />
                : <Input value={form.sourceDetail} placeholder={secondary.placeholder} required onChange={(event) => set("sourceDetail", event.target.value)} />}
            </Field>}
            {ecosystem && <Field label="行业"><SearchableSelect multiple values={form.industries} onValuesChange={(values) => set("industries", values)} options={toSelectOptions(Object.keys(INDUSTRIES))} placeholder="搜索并选择行业，可多选" /></Field>}
            <Field label={ecosystem ? "负责人" : "渠道负责人"}>
              {partner ? <Input value={partner.ownerName || "未分配"} disabled /> : <NativeSelect label={ecosystem ? "负责人" : "渠道负责人"} value={form.ownerUserId || user?.id || ""} options={ownerOptions} onChange={(value) => set("ownerUserId", value)} disabled={!canAssign} placeholder="由我负责" />}
            </Field>
          </div>
          {ecosystem && <EcosystemFields section="company" form={form} partner={partner} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />}
          {optionsError && <p role="status" className="text-xs text-amber-700">{optionsError}</p>}
        </section>
        <section className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">合作信息</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="区域"><NativeSelect label="区域" value={form.region} options={Object.keys(CHANNEL_REGIONS)} onChange={(value) => setForm((current) => ({ ...current, region: value, city: "" }))} /></Field>
            <Field label={ecosystem ? "城市" : "省市"}><NativeSelect label={ecosystem ? "城市" : "省市"} value={form.city} options={CHANNEL_REGIONS[form.region] ?? []} disabled={!form.region} placeholder={form.region ? "请选择省市" : "请先选择区域"} onChange={(value) => set("city", value)} /></Field>
          </div>
          {!ecosystem && <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="mb-2 text-xs font-medium">代理类型</p><div className="flex flex-wrap gap-2">{CHANNEL_AGENCY_TYPES.map((value) => <button key={value} type="button" aria-pressed={form.agencyTypes.includes(value)}
              onClick={() => set("agencyTypes", form.agencyTypes.includes(value) ? form.agencyTypes.filter((item) => item !== value) : [...form.agencyTypes, value])}
              className={"rounded-lg border px-4 py-2 text-sm transition-colors " + (form.agencyTypes.includes(value) ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted")}>{value}</button>)}</div></div>
            <label className="flex min-h-16 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={form.teamSupport} onChange={(event) => set("teamSupport", event.target.checked)} />有团队支持</label>
          </div>}
        </section>
        <section className="border-t pt-4">
          <Button type="button" variant="ghost" className="-ml-2" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}补充资料<span className="font-normal text-muted-foreground">（选填）</span>
          </Button>
          {more && <div className="mt-4 space-y-4">
            <Field label="公司官网"><Input value={form.website} placeholder="例如 pureblue.ai" onChange={(event) => set("website", event.target.value)} /></Field>
            {!ecosystem && <Field label="意向行业"><SearchableSelect multiple values={form.industries} onValuesChange={(values) => set("industries", values)} options={toSelectOptions(Object.keys(INDUSTRIES))} placeholder="搜索并选择行业，可多选" /></Field>}
            {!ecosystem && <Field label="主要客户"><Textarea rows={2} value={form.majorCustomers} placeholder="填写该渠道服务的代表客户" onChange={(event) => set("majorCustomers", event.target.value)} /></Field>}
            <Field label="合作项目"><Textarea rows={2} value={form.cooperationProject} placeholder="填写拟开展的合作方向或项目" onChange={(event) => set("cooperationProject", event.target.value)} /></Field>
          </div>}
        </section>
          </TabsContent>
          {ecosystem && <><TabsContent value="requirements"><EcosystemFields section="requirements" form={form} partner={partner} opportunities={opportunities} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} /></TabsContent>
          <TabsContent value="execution"><EcosystemFields section="execution" form={form} partner={partner} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} /></TabsContent></>}
        </Tabs>
      </fieldset>
    </form>
  </ChannelModal>
}

export function ChannelPartnerDialog(props: Parameters<typeof LegacyChannelPartnerDialog>[0]) {
  return (props.partner?.partnerType ?? props.partnerType) === "strategic_ecosystem"
    ? <EcosystemPartnerDialog partner={props.partner} onClose={props.onClose} onSaved={props.onSaved} />
    : <LegacyChannelPartnerDialog {...props} />
}
