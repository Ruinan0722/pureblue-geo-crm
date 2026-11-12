"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, RefreshCw, Search, Star, Target } from "lucide-react"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { ListPagination } from "@/shared/ui/list-pagination"
import { ContentLoadingOverlay } from "@/shared/ui/content-loading"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"
import { CHANNEL_AGENCY_TYPES, CHANNEL_CONTRACT_STATUSES, CHANNEL_LEVELS, CHANNEL_REGIONS, CHANNEL_TYPES, LEAD_SOURCES } from "@/modules/crm/lib/crm-data"
import { fetchChannels, fetchAllChannelOpportunities, fetchAllChannelContracts, subscribeChannelOpportunityChanges, type ChannelPartner, type ChannelOpportunityRow, type ChannelContractRow } from "@/modules/crm/services/channel-management"
import { StatCards, FilterGrid, FilterField, FilterSelect, FilterChips, EmptyState } from "./ui"
import { MineOnlyToggle } from "./mine-only-toggle"
import { ChannelPartnerDialog } from "./channels/channel-partner-dialog"
import { ChannelResourceDialog } from "./channels/channel-action-dialogs"
import { ChannelBadge, ChannelError, ChannelLoading, displayDate } from "./channels/channel-ui"

type ChannelQuery = {
  name: string; type: string; level: string; region: string; owner: string
  agency: string; source: string; relation: string; contract: string; mineOnly: boolean
}
const EMPTY_QUERY: ChannelQuery = { name: "", type: "all", level: "all", region: "all", owner: "", agency: "all", source: "all", relation: "all", contract: "all", mineOnly: false }
type SortKey = "name" | "region" | "owner" | "counts" | "agency" | "level" | "contract" | "updated"
const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE
const options = (values: readonly string[], allLabel: string) => [{ value: "all", label: allLabel }, ...values.map((value) => ({ value, label: value }))]

export function ChannelManagementPage({ partnerType = "channel" }: { partnerType?: "channel" | "strategic_ecosystem" }) {
  const router = useRouter()
  const { user, canAccess } = useAuth()
  const canCreate = Boolean(user?.permissions.some((permission) => permission === "channels:create" || permission === "channels:write"))
  const canViewOpportunities = canAccess("opportunities")
  const canViewContracts = canAccess("contracts")
  const [channels, setChannels] = useState<ChannelPartner[]>([])
  const [opportunities, setOpportunities] = useState<ChannelOpportunityRow[]>([])
  const [contracts, setContracts] = useState<ChannelContractRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState<ChannelPartner | null>(null)
  const requestId = useRef(0)
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied<ChannelQuery>("crm:channels:customer-ui:" + (user?.id || "anonymous"), EMPTY_QUERY)
  const { sort, toggleSort } = useTableSort<SortKey>({ key: "updated", dir: "desc" })

  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError("")
    try {
      const [partners, opps, agreements] = await Promise.all([fetchChannels(partnerType), (canViewOpportunities ? fetchAllChannelOpportunities(partnerType) : Promise.resolve([])), (canViewContracts ? fetchAllChannelContracts(partnerType) : Promise.resolve([]))])
      if (request !== requestId.current) return
      setChannels(partners); setOpportunities(opps); setContracts(agreements)
    } catch (caught) {
      if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载渠道失败，请重试。")
    } finally {
      if (request === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [partnerType, canViewOpportunities, canViewContracts])

  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search)
    const partnerId = legacy.get("partner")
    if (partnerId) {
      router.replace((partnerType === "strategic_ecosystem" ? "/ecosystems/" : "/channels/") + encodeURIComponent(partnerId) + (legacy.get("tab") ? "?tab=" + encodeURIComponent(legacy.get("tab")!) : ""))
      return
    }
    void load(true)
    return () => { requestId.current += 1 }
  }, [load, router])
  useEffect(() => subscribeChannelOpportunityChanges(() => void load()), [load])

  const counts = useMemo(() => {
    const map = new Map<string, { opportunities: number; contracts: number }>()
    channels.forEach((partner) => map.set(partner.id, { opportunities: 0, contracts: 0 }))
    opportunities.forEach((row) => { const count = map.get(row.partnerId); if (count) count.opportunities += 1 })
    contracts.forEach((row) => { const count = map.get(row.partnerId); if (count) count.contracts += 1 })
    return map
  }, [channels, opportunities, contracts])

  const filtered = useMemo(() => {
    const q = applied.query
    return channels.filter((partner) => {
      const count = counts.get(partner.id)!
      const searchText = [partner.name, partner.brandName, partner.region, partner.city, ...(partner.industries || [])].filter(Boolean).join(" ").toLowerCase()
      return (!q.name.trim() || searchText.includes(q.name.trim().toLowerCase())) &&
        (q.type === "all" || partner.channelType === q.type) && (q.level === "all" || partner.level === q.level) &&
        (q.region === "all" || partner.region === q.region) && (q.agency === "all" || partner.agencyTypes.includes(q.agency)) &&
        (q.source === "all" || partner.source === q.source) && (q.contract === "all" || partner.contractStatus === q.contract) &&
        (!q.mineOnly || partner.ownerUserId === user?.id) && (!q.owner.trim() || (partner.ownerName || "").includes(q.owner.trim())) &&
        (q.relation === "all" || (q.relation === "opp" ? count.opportunities > 0 : q.relation === "contract" ? count.contracts > 0 : count.opportunities === 0 && count.contracts === 0))
    })
  }, [channels, applied.query, counts, user?.id])
  const sorted = useMemo(() => sortRows(filtered, sort, {
    name: (row) => row.name, region: (row) => [row.region, row.city].filter(Boolean).join(" "),
    owner: (row) => row.ownerName, counts: (row) => (counts.get(row.id)?.opportunities || 0) + (counts.get(row.id)?.contracts || 0),
    agency: (row) => row.agencyTypes.join("、"), level: (row) => row.level,
    contract: (row) => row.contractStatus, updated: (row) => row.updatedAt,
  }), [filtered, sort, counts])
  const currentPage = Math.min(applied.page, Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)))
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const active = loading || !listStateReady
  function patch<K extends keyof ChannelQuery>(key: K, value: ChannelQuery[K]) { setDraft((current) => ({ ...current, [key]: value })) }
  function search() { setApplied({ query: { ...draft }, page: 1 }) }
  function reset() { setDraft(EMPTY_QUERY); setApplied({ query: EMPTY_QUERY, page: 1 }) }
  function quickContract(value: string) {
    setDraft((current) => ({ ...current, contract: value }))
    setApplied((current) => ({ query: { ...current.query, contract: value }, page: 1 }))
  }
  function mineOnly(value: boolean) {
    setDraft((current) => ({ ...current, mineOnly: value, owner: value ? "" : current.owner }))
    setApplied((current) => ({ query: { ...current.query, mineOnly: value, owner: value ? "" : current.query.owner }, page: 1 }))
  }
  const detailUrl = (id: string, tab?: string) => (partnerType === "strategic_ecosystem" ? "/ecosystems/" : "/channels/") + encodeURIComponent(id) + (tab ? "?tab=" + tab : "")
  const title = partnerType === "strategic_ecosystem" ? "战略生态" : "渠道管理"

  return <div className="px-5 py-6 pb-24 lg:px-8">
    <h1 className="sr-only">{title}</h1>
    <div className="space-y-3">
      <StatCards dense cols={5} items={[
        { label: title + "总数", value: active ? "—" : channels.length },
        { label: "重点合作", value: active ? "—" : channels.filter((row) => row.level === "重点合作").length, tone: "text-amber-600" },
        { label: "已签约", value: active ? "—" : channels.filter((row) => row.contractStatus === "是").length, tone: "text-emerald-600" },
        { label: title + "商机", value: active ? "—" : opportunities.length, tone: "text-primary" },
        { label: "准备签约", value: active ? "—" : channels.filter((row) => row.contractStatus === "准备签约").length, tone: "text-amber-600" },
      ]} />
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{applied.query.mineOnly ? "当前仅显示本人（" + (user?.name || "我") + "）负责的" + title : "显示当前账号可见的" + title + "伙伴，可在详情中创建商机"}</p>
          <MineOnlyToggle value={applied.query.mineOnly} onChange={mineOnly} disabled={active || refreshing} />
        </div>
        <FilterGrid>
          <FilterField label={partnerType === "strategic_ecosystem" ? "品牌 / 公司名称" : "渠道名称"}><Input className="h-9" aria-label={title + "名称"} placeholder={"请输入" + title + "名称"} value={draft.name} onChange={(event) => patch("name", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search() }} /></FilterField>
          {partnerType === "channel" && <FilterField label="渠道类型"><FilterSelect value={draft.type} onChange={(value) => patch("type", value)} options={options(CHANNEL_TYPES, "全部类型")} /></FilterField>}
          <FilterField label="合作级别"><FilterSelect value={draft.level} onChange={(value) => patch("level", value)} options={options(CHANNEL_LEVELS, "全部级别")} /></FilterField>
          <FilterField label="区域"><FilterSelect value={draft.region} onChange={(value) => patch("region", value)} options={options(Object.keys(CHANNEL_REGIONS), "全部区域")} /></FilterField>
          <FilterField label={partnerType === "strategic_ecosystem" ? "负责人" : "渠道负责人"}><Input className="h-9" aria-label={partnerType === "strategic_ecosystem" ? "负责人" : "渠道负责人"} placeholder={draft.mineOnly ? user?.name || "本人" : "请输入负责人"} value={draft.mineOnly ? user?.name || "" : draft.owner} disabled={draft.mineOnly} onChange={(event) => patch("owner", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search() }} /></FilterField>
          {partnerType === "channel" && <FilterField label="代理类型"><FilterSelect value={draft.agency} onChange={(value) => patch("agency", value)} options={options(CHANNEL_AGENCY_TYPES, "全部代理类型")} /></FilterField>}
          <FilterField label="渠道来源"><FilterSelect value={draft.source} onChange={(value) => patch("source", value)} options={options(LEAD_SOURCES, "全部来源")} /></FilterField>
          <FilterField label="商机 / 合同"><FilterSelect value={draft.relation} onChange={(value) => patch("relation", value)} options={[{ value: "all", label: "全部渠道" }, { value: "opp", label: "有商机" }, { value: "contract", label: "有合同" }, { value: "none", label: "无商机且无合同" }]} /></FilterField>
        </FilterGrid>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1"><FilterChips value={applied.query.contract} onChange={quickContract} options={[{ value: "all", label: "全部合同状态" }, ...CHANNEL_CONTRACT_STATUSES.map((value) => ({ value, label: value === "是" ? "已签约" : value === "否" ? "未签约" : value }))]} /></div>
          {partnerType === "channel" && <Button asChild variant="outline"><Link href="/channels/leads">待跟进渠道线索</Link></Button>}
          {canCreate && <Button type="button" className="gap-1.5" onClick={() => setCreating(true)}><Plus className="size-4" />{partnerType === "strategic_ecosystem" ? "新建战略生态伙伴" : "新建渠道"}</Button>}
          <Button type="button" variant="outline" onClick={reset}>重置</Button>
          <Button type="button" className="gap-1.5" onClick={search}><Search className="size-4" />查询</Button>
          <Button type="button" variant="outline" size="icon" aria-label="刷新渠道列表" onClick={() => void load()} disabled={active || refreshing}><RefreshCw className={"size-4" + (refreshing ? " animate-spin" : "")} /></Button>
        </div>
      </div>
      <ChannelError message={error} retry={() => void load(channels.length === 0)} />
      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        {refreshing && <ContentLoadingOverlay label="正在刷新渠道列表…" />}
        {active ? <ChannelLoading label="正在加载渠道列表…" /> : <TableCellTip><div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
              <SortableTh label={partnerType === "strategic_ecosystem" ? "品牌 / 公司名称" : "渠道 / 类型"} sortKey="name" sort={sort} onToggle={toggleSort} />
              <SortableTh label="区域" sortKey="region" sort={sort} onToggle={toggleSort} />
              <SortableTh label="渠道负责人" sortKey="owner" sort={sort} onToggle={toggleSort} />
              <SortableTh label="商机 / 合同" sortKey="counts" sort={sort} onToggle={toggleSort} />
              {partnerType === "channel" && <SortableTh label="代理类型" sortKey="agency" sort={sort} onToggle={toggleSort} />}
              <SortableTh label="合作级别" sortKey="level" sort={sort} onToggle={toggleSort} />
              <SortableTh label="合同状态" sortKey="contract" sort={sort} onToggle={toggleSort} />
              <SortableTh label="最近更新" sortKey="updated" sort={sort} onToggle={toggleSort} />
              <th className="sticky right-0 z-10 border-l bg-card px-4 py-3 font-medium">操作</th>
            </tr></thead>
            <tbody>{pageRows.map((partner) => <tr key={partner.id} role="link" tabIndex={0} className="group cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/30"
              onClick={() => router.push(detailUrl(partner.id))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(detailUrl(partner.id)) } }}>
              <td className="max-w-56 px-4 py-3"><p className="flex items-center gap-1.5 truncate font-medium" title={partner.name}>{partner.level === "重点合作" && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}<span className="truncate">{partner.partnerType === "strategic_ecosystem" && partner.brandName ? partner.brandName + " · " : ""}{partner.name}</span></p><p className="mt-1 truncate text-xs text-muted-foreground">{partner.partnerType === "strategic_ecosystem" ? partner.industries?.join("、") || "战略生态伙伴" : partner.channelType || "未设置类型"}</p></td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{partner.region || "—"}<p className="mt-1">{partner.city}</p></td>
              <td className="whitespace-nowrap px-4 py-3">{partner.ownerName || "未分配"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Link href={detailUrl(partner.id, "opportunities")} className="hover:text-primary hover:underline">{counts.get(partner.id)?.opportunities || 0} / {counts.get(partner.id)?.contracts || 0}</Link></td>
              {partnerType === "channel" && <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{partner.agencyTypes.join("、") || "—"}</td>}
              <td className="px-4 py-3"><ChannelBadge value={partner.level} /></td>
              <td className="px-4 py-3"><ChannelBadge value={partner.contractStatus} kind="contract" /></td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{displayDate(partner.updatedAt)}</td>
              <td className="sticky right-0 border-l bg-card px-4 py-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><div className="flex items-center gap-2">
                {canViewOpportunities && user?.permissions.some((code) => ["opportunities:create", "opportunities:write"].includes(code)) && <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setGenerating(partner)}><Target className="size-3.5" />创建商机</Button>}
                <Button type="button" variant="outline" size="sm" onClick={() => router.push(detailUrl(partner.id))}>查看详情</Button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div></TableCellTip>}
        {!active && pageRows.length === 0 && !error && <EmptyState text={channels.length ? "没有符合条件的" + title + "伙伴" : "暂无" + title + "伙伴，可直接新建档案。"} />}
      </div>
      <div className="[&>div]:items-start [&>div]:sm:justify-start [&>div]:sm:gap-6 [&>div>div]:justify-start"><ListPagination total={filtered.length} page={currentPage} pageSize={PAGE_SIZE} onPageChange={(page) => setApplied((current) => ({ ...current, page }))} loading={active || refreshing} label={partnerType === "strategic_ecosystem" ? "家伙伴" : "家渠道"} /></div>
      {canAccess("opportunities") && <p className="text-xs text-muted-foreground">创建的商机自动显示在<Link href={partnerType === "strategic_ecosystem" ? "/opportunities/ecosystems" : "/opportunities?view=channel"} className="ml-1 text-primary hover:underline">商机管理 · {title}商机</Link>。</p>}
    </div>
    {creating && <ChannelPartnerDialog partnerType={partnerType} onClose={() => setCreating(false)} onSaved={(partner) => { setCreating(false); router.push(detailUrl(partner.id)) }} />}
    {generating && <ChannelResourceDialog resource="opportunities" partnerId={generating.id} partnerName={generating.name} contacts={[]} opportunities={[]} onClose={() => setGenerating(null)} onSaved={() => setGenerating(null)} />}
  </div>
}
