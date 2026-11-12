"use client"

import { ecosystemSourceLabel } from "../../lib/ecosystem-sources"
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
import { INDUSTRIES } from "@/modules/crm/lib/crm-data"
import { fetchChannels, type ChannelPartner } from "@/modules/crm/services/channel-management"
import { EmptyState, FilterField, FilterGrid, FilterSelect } from "../ui"
import { MineOnlyToggle } from "../mine-only-toggle"
import { ChannelPartnerDialog } from "../channels/channel-partner-dialog"
import { ChannelResourceDialog } from "../channels/channel-action-dialogs"
import { ChannelError, ChannelLoading } from "../channels/channel-ui"

type Query = { company: string; brand: string; industry: string; city: string; owner: string; source: string; mineOnly: boolean }
const EMPTY: Query = { company: "", brand: "", industry: "all", city: "", owner: "", source: "", mineOnly: false }
type SortKey = "brand" | "company" | "industry" | "city" | "source" | "owner" | "department" | "contact"
const sourceDetail = (row: ChannelPartner) => ecosystemSourceLabel(row.source, row.sourceDetail)
const allOptions = (items: string[], label: string) => [{ value: "all", label }, ...items.map((value) => ({ value, label: value }))]

export function EcosystemManagementPage() {
  const router = useRouter()
  const { user, canAccess, loading: authLoading } = useAuth()
  const allowed = canAccess("channels")
  const canWrite = Boolean(user?.permissions.includes("channels:write"))
  const canCreate = canWrite || Boolean(user?.permissions.includes("channels:create"))
  const canViewOpportunities = canAccess("opportunities")
  const [rows, setRows] = useState<ChannelPartner[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ChannelPartner | null>(null)
  const [creatingOpportunity, setCreatingOpportunity] = useState<ChannelPartner | null>(null)
  const requestId = useRef(0)
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied<Query>("crm:ecosystems:customers:v2:" + (user?.id || "anonymous"), EMPTY)
  const { sort, toggleSort } = useTableSort<SortKey>()
  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true); else setRefreshing(true)
    setError("")
    try {
      const partners = await fetchChannels("strategic_ecosystem")
      if (request === requestId.current) setRows(partners)
    } catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载战略生态客户失败") }
    finally { if (request === requestId.current) { setLoading(false); setRefreshing(false) } }
  }, [])
  useEffect(() => { if (!authLoading && allowed) void load(true); return () => { requestId.current += 1 } }, [authLoading, allowed, load])
  const scoped = useMemo(() => rows.filter((row) => !applied.query.mineOnly || row.ownerUserId === user?.id), [rows, applied.query.mineOnly, user?.id])
  const filtered = useMemo(() => {
    const q = applied.query
    const matches = (value: string | null | undefined, term: string) => (value || "").toLowerCase().includes(term.trim().toLowerCase())
    return sortRows(scoped.filter((row) => matches(row.name, q.company) && matches(row.brandName, q.brand) &&
      (q.industry === "all" || row.industries.includes(q.industry)) && matches(row.city, q.city) &&
      matches(row.bdNames?.join("、"), q.owner) && matches(sourceDetail(row), q.source)), sort, {
        brand: (r) => r.brandName, company: (r) => r.name, industry: (r) => r.industries.join("、"), city: (r) => r.city,
        source: sourceDetail, owner: (r) => r.bdNames?.join("、"), department: (r) => r.ecosystemDepartment, contact: (r) => r.primaryContactName,
      })
  }, [scoped, applied.query, sort])
  const paged = paginateSlice(filtered, applied.page, DEFAULT_LIST_PAGE_SIZE)
  const active = loading || !listStateReady
  const detailUrl = (id: string, tab?: string) => "/ecosystems/" + encodeURIComponent(id) + (tab ? "?tab=" + tab : "")
  function patch<K extends keyof Query>(key: K, value: Query[K]) { setDraft((current) => ({ ...current, [key]: value })) }
  function search() { setApplied({ query: { ...draft }, page: 1 }) }
  if (authLoading) return <ChannelLoading />
  if (!allowed) return <ChannelError message="当前账号没有战略生态管理访问权限。" />
  return <div className="px-5 py-6 lg:px-8"><h1 className="sr-only">战略生态管理</h1><div className="space-y-3">
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{applied.query.mineOnly ? "当前仅显示本人（" + (user?.name || "我") + "）负责的生态客户" : "显示当前账号可见的战略生态客户"}</p><MineOnlyToggle value={applied.query.mineOnly} onChange={(mineOnly) => { patch("mineOnly", mineOnly); setApplied((current) => ({ query: { ...current.query, mineOnly }, page: 1 })) }} /></div>
      <FilterGrid>
        <FilterField label="公司名称"><Input className="h-9" placeholder="请输入公司名称" value={draft.company} onChange={(e) => patch("company", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search() }} /></FilterField>
        <FilterField label="品牌名称"><Input className="h-9" placeholder="请输入品牌名称" value={draft.brand} onChange={(e) => patch("brand", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search() }} /></FilterField>
        <FilterField label="行业"><FilterSelect value={draft.industry} onChange={(v) => patch("industry", v)} options={allOptions(Object.keys(INDUSTRIES), "全部行业")} /></FilterField>
        <FilterField label="城市"><Input value={draft.city} onChange={(e) => patch("city", e.target.value)} /></FilterField>
        <FilterField label="BD 负责人"><Input value={draft.owner} onChange={(e) => patch("owner", e.target.value)} /></FilterField>
        <FilterField label="项目来源"><Input value={draft.source} onChange={(e) => patch("source", e.target.value)} /></FilterField>
      </FilterGrid>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {canCreate && <Button className="gap-1.5" onClick={() => setCreating(true)}><Plus className="size-4" />新建生态客户</Button>}
        <Button variant="outline" onClick={() => { setDraft(EMPTY); setApplied({ query: EMPTY, page: 1 }) }}>重置</Button><Button className="gap-1.5" onClick={search}><Search className="size-4" />查询</Button><Button variant="outline" size="icon" aria-label="刷新战略生态客户" onClick={() => void load()} disabled={active || refreshing}><RefreshCw className={"size-4" + (refreshing ? " animate-spin" : "")} /></Button>
      </div>
    </div>
    <ChannelError message={error} retry={() => void load(rows.length === 0)} />
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">{refreshing && <ContentLoadingOverlay label="正在刷新生态客户…" />}
      {active ? <ChannelLoading label="正在加载战略生态客户…" /> : <TableCellTip><div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-sm"><thead><tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
        {([['brand', '品牌名称'], ['company', '公司名称'], ['industry', '行业'], ['city', '城市'], ['source', '项目来源'], ['owner', 'BD 负责人'], ['department', '战略生态对接部门'], ['contact', '主要对接人']] as [SortKey, string][]).map(([key, label]) => <SortableTh key={key} label={label} sortKey={key} sort={sort} onToggle={toggleSort} />)}<th className="px-4 py-3 font-medium">操作</th>
      </tr></thead><tbody>{paged.pageItems.map((row) => <tr key={row.id} role="link" tabIndex={0} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/30" onClick={() => router.push(detailUrl(row.id))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(detailUrl(row.id)) } }}>
        {[row.brandName, row.name, row.industries.join("、"), row.city, sourceDetail(row), row.bdNames?.join("、"), row.ecosystemDepartment, row.primaryContactName].map((value, index) => <td key={index} className="max-w-40 truncate px-4 py-3" title={value || undefined}>{value || "—"}</td>)}
        <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => router.push(detailUrl(row.id))}>查看</Button>{canWrite && <Button variant="outline" size="sm" onClick={() => setEditing(row)}>编辑</Button>}{canViewOpportunities && user?.permissions.some((code) => ["opportunities:create", "opportunities:write"].includes(code)) && <Button variant="outline" size="sm" onClick={() => setCreatingOpportunity(row)}>创建商机</Button>}</div></td>
      </tr>)}</tbody></table></div></TableCellTip>}
      {!active && !paged.pageItems.length && !error && <EmptyState text={rows.length ? "没有符合条件的生态客户" : "暂无战略生态客户，点击「新建生态客户」直接建档"} />}
    </div>
    <ListPagination total={filtered.length} page={paged.currentPage} pageSize={DEFAULT_LIST_PAGE_SIZE} onPageChange={(page) => setApplied((current) => ({ ...current, page }))} loading={active || refreshing} label="家生态客户" />
    {creating && <ChannelPartnerDialog partnerType="strategic_ecosystem" onClose={() => setCreating(false)} onSaved={(row) => { setCreating(false); router.push(detailUrl(row.id)) }} />}
    {editing && <ChannelPartnerDialog partner={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    {creatingOpportunity && <ChannelResourceDialog resource="opportunities" partnerId={creatingOpportunity.id} partnerName={creatingOpportunity.name || creatingOpportunity.brandName || ""} partnerType="strategic_ecosystem" contacts={[]} opportunities={[]} onClose={() => setCreatingOpportunity(null)} onSaved={() => { setCreatingOpportunity(null); void load() }} />}
  </div></div>
}
