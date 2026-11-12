"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, RefreshCw, Search } from "lucide-react"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { ListPagination } from "@/shared/ui/list-pagination"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { ContentLoadingOverlay } from "@/shared/ui/content-loading"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import { chinaDateISO } from "@/shared/lib/datetime"
import { CHANNEL_REGIONS } from "@/modules/crm/lib/crm-data"
import { fetchChannels, fetchAllChannelOpportunities, fetchAllChannelContracts, channelContractUrl, subscribeChannelContractChanges, type ChannelPartner, type ChannelOpportunityRow, type ChannelContractRow } from "@/modules/crm/services/channel-management"
import { EmptyState, FilterChips, FilterField, FilterGrid, FilterSelect, StatCards } from "../ui"
import { MineOnlyToggle } from "../mine-only-toggle"
import { ChannelContractForm } from "../channels/channel-contract-form"
import { ChannelBadge, ChannelError, ChannelLoading, displayDate } from "../channels/channel-ui"

type Query = { keyword: string; region: string; signer: string; subject: string; project: string; status: string; mineOnly: boolean }
const EMPTY: Query = { keyword: "", region: "all", signer: "all", subject: "all", project: "all", status: "all", mineOnly: false }
type SortKey = "code" | "company" | "signer" | "region" | "project" | "status" | "end"
const allOptions = (items: string[], label: string) => [{ value: "all", label }, ...items.map((value) => ({ value, label: value }))]

export function EcosystemContractRegistry({ create = false, partnerId, opportunityId }: { create?: boolean; partnerId?: string; opportunityId?: string }) {
  const router = useRouter()
  const { user, canAccess, loading: authLoading } = useAuth()
  const allowed = canAccess("contracts") && canAccess("channels")
  const canCreate = Boolean(user?.permissions.some((p) => ["channels:create", "channels:write"].includes(p)))
  const canViewOpportunities = canAccess("opportunities")
  const canViewContracts = canAccess("contracts")
  const [rows, setRows] = useState<ChannelContractRow[]>([])
  const [partners, setPartners] = useState<ChannelPartner[]>([])
  const [opportunities, setOpportunities] = useState<ChannelOpportunityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(create)
  const requestId = useRef(0)
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied<Query>("crm:ecosystems:contracts:v1:" + (user?.id || "anonymous"), EMPTY)
  const { sort, toggleSort } = useTableSort<SortKey>()
  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true); else setRefreshing(true)
    setError("")
    try {
      const [contracts, clients, opps] = await Promise.all([fetchAllChannelContracts("strategic_ecosystem"), fetchChannels("strategic_ecosystem"), (canViewOpportunities ? fetchAllChannelOpportunities("strategic_ecosystem") : Promise.resolve([]))])
      if (request === requestId.current) { setRows(contracts); setPartners(clients); setOpportunities(opps) }
    } catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载战略生态合同失败") }
    finally { if (request === requestId.current) { setLoading(false); setRefreshing(false) } }
  }, [canViewOpportunities, canViewContracts])
  useEffect(() => { if (!authLoading && allowed) void load(true); return () => { requestId.current += 1 } }, [authLoading, allowed, load])
  useEffect(() => { setCreating(create) }, [create])
  useEffect(() => { if (allowed) return subscribeChannelContractChanges(() => void load()) }, [allowed, load])
  const scoped = useMemo(() => rows.filter((row) => !applied.query.mineOnly || row.ownerUserId === user?.id || row.signer === user?.name), [rows, applied.query.mineOnly, user?.id, user?.name])
  const filtered = useMemo(() => {
    const q = applied.query
    return sortRows(scoped.filter((row) => [row.name, row.contractNumber, row.partnerName, row.contactName, row.signer].filter(Boolean).join(" ").toLowerCase().includes(q.keyword.trim().toLowerCase()) &&
      (q.region === "all" || row.region === q.region) && (q.signer === "all" || row.signer === q.signer) && (q.subject === "all" || row.signingSubject === q.subject) && (q.project === "all" || (row.projectStatus || "无") === q.project) && (q.status === "all" || row.status === q.status)), sort,
      { code: (r) => r.contractNumber || r.name, company: (r) => r.partnerName, signer: (r) => r.signer || r.ownerName, region: (r) => r.region, project: (r) => r.projectStatus, status: (r) => r.status, end: (r) => r.endDate })
  }, [scoped, applied.query, sort])
  const paged = paginateSlice(filtered, applied.page, DEFAULT_LIST_PAGE_SIZE)
  const today = chinaDateISO()
  const cutoff = new Date(today + "T00:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate() + 30)
  const active = loading || !listStateReady
  const unique = (key: "signer" | "signingSubject") => [...new Set(rows.map((r) => r[key]).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "zh-CN"))
  function patch<K extends keyof Query>(key: K, value: Query[K]) { setDraft((current) => ({ ...current, [key]: value })) }
  function search() { setApplied({ query: { ...draft }, page: 1 }) }
  function closeForm() { setCreating(false); if (create) router.replace("/contracts/ecosystems", { scroll: false }) }
  if (authLoading) return <ChannelLoading />
  if (!allowed) return <ChannelError message="当前账号需要合同管理及合作伙伴管理的访问权限。" />
  return <div className="space-y-3"><h1 className="sr-only">战略生态合同</h1>
    <StatCards dense items={[
      { label: "合同总数", value: active ? "—" : scoped.length }, { label: "已签订", value: active ? "—" : scoped.filter((r) => r.status === "是").length, tone: "text-emerald-600" },
      { label: "待签订", value: active ? "—" : scoped.filter((r) => r.status !== "是").length, tone: "text-amber-600" }, { label: "30 天内到期", value: active ? "—" : scoped.filter((r) => r.status === "是" && r.endDate && r.endDate >= today && r.endDate <= cutoff.toISOString().slice(0, 10)).length, tone: "text-primary" },
    ]} />
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{applied.query.mineOnly ? "当前仅显示本人相关的战略生态合同" : "显示当前账号可见的战略生态合同"}</p><div className="flex items-center gap-2"><MineOnlyToggle value={applied.query.mineOnly} onChange={(mineOnly) => { patch("mineOnly", mineOnly); setApplied((current) => ({ query: { ...current.query, mineOnly }, page: 1 })) }} />{canCreate && <Button className="gap-1.5" onClick={() => setCreating(true)}><Plus className="size-4" />新增合同</Button>}</div></div>
      <FilterGrid>
        <FilterField label="关键词"><Input className="h-9" aria-label="搜索战略生态合同" placeholder="合同编号、名称、客户或经办人" value={draft.keyword} onChange={(e) => patch("keyword", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search() }} /></FilterField>
        <FilterField label="区域"><FilterSelect value={draft.region} onChange={(v) => patch("region", v)} options={allOptions(Object.keys(CHANNEL_REGIONS), "全部区域")} /></FilterField>
        <FilterField label="合同经办人"><FilterSelect value={draft.signer} onChange={(v) => patch("signer", v)} options={allOptions(unique("signer"), "全部经办人")} /></FilterField>
        <FilterField label="签约主体"><FilterSelect value={draft.subject} onChange={(v) => patch("subject", v)} options={allOptions(unique("signingSubject"), "全部签约主体")} /></FilterField>
        <FilterField label="项目状态"><FilterSelect value={draft.project} onChange={(v) => patch("project", v)} options={allOptions(["有", "无"], "全部项目状态")} /></FilterField>
      </FilterGrid>
      <div className="mt-3 flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><FilterChips value={applied.query.status} onChange={(status) => { patch("status", status); setApplied((current) => ({ query: { ...current.query, status }, page: 1 })) }} options={[{ value: "all", label: "全部状态" }, { value: "准备签约", label: "待签订" }, { value: "走入库流程了", label: "入库中" }, { value: "是", label: "已签订" }]} /></div><Button variant="outline" onClick={() => { setDraft(EMPTY); setApplied({ query: EMPTY, page: 1 }) }}>重置</Button><Button className="gap-1.5" onClick={search}><Search className="size-4" />查询</Button><Button variant="outline" size="icon" aria-label="刷新战略生态合同" disabled={active || refreshing} onClick={() => void load()}><RefreshCw className={"size-4" + (refreshing ? " animate-spin" : "")} /></Button></div>
    </div>
    <ChannelError message={error} retry={() => void load(rows.length === 0)} />
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">{refreshing && <ContentLoadingOverlay label="正在刷新合同…" />}{active ? <ChannelLoading label="正在加载战略生态合同…" /> : <TableCellTip><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead><tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
      <SortableTh label="合同编号 / 名称" sortKey="code" sort={sort} onToggle={toggleSort} /><SortableTh label="生态客户" sortKey="company" sort={sort} onToggle={toggleSort} /><th className="px-4 py-3 font-medium">合同类型</th><SortableTh label="合同经办人" sortKey="signer" sort={sort} onToggle={toggleSort} /><SortableTh label="区域" sortKey="region" sort={sort} onToggle={toggleSort} /><SortableTh label="项目状态" sortKey="project" sort={sort} onToggle={toggleSort} /><SortableTh label="合同状态" sortKey="status" sort={sort} onToggle={toggleSort} /><SortableTh label="到期日期" sortKey="end" sort={sort} onToggle={toggleSort} /><th className="px-4 py-3 font-medium" />
    </tr></thead><tbody>{paged.pageItems.map((row) => <tr key={row.id} role="link" tabIndex={0} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/30" onClick={() => router.push(channelContractUrl(row.id, "strategic_ecosystem"))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(channelContractUrl(row.id, "strategic_ecosystem")) } }}>
      <td className="max-w-64 px-4 py-3"><p className="font-mono text-[10px] text-muted-foreground">{row.contractNumber || "待补充编号"}</p><p className="mt-1 truncate font-medium" title={row.name}>{row.name}</p></td><td className="max-w-48 truncate px-4 py-3 text-muted-foreground" title={row.partnerName}>{row.partnerName}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">战略生态合同</td><td className="whitespace-nowrap px-4 py-3">{row.signer || row.ownerName || "—"}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{row.region || "—"}</td><td className="px-4 py-3 text-muted-foreground">{row.projectStatus || "无"}</td><td className="px-4 py-3"><ChannelBadge value={row.status} kind="contract" /></td><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{displayDate(row.endDate)}</td><td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><Button variant="outline" size="sm" onClick={() => router.push(channelContractUrl(row.id, "strategic_ecosystem"))}>查看详情</Button></td>
    </tr>)}</tbody></table></div></TableCellTip>}{!active && !filtered.length && !error && <EmptyState text={rows.length ? "没有符合条件的合同" : "暂无战略生态合同，可从生态商机进入「签署中」自动生成"} />}</div>
    <ListPagination total={filtered.length} page={paged.currentPage} pageSize={DEFAULT_LIST_PAGE_SIZE} onPageChange={(page) => setApplied((current) => ({ ...current, page }))} label="份合同" />
    {creating && canCreate && !active && !error && <ChannelContractForm partnerType="strategic_ecosystem" partners={partners} opportunities={opportunities} partnerId={partnerId} opportunityId={opportunityId} onClose={closeForm} onSaved={(row) => { setCreating(false); router.push(channelContractUrl(row.id, "strategic_ecosystem")) }} />}
  </div>
}
