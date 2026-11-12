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
import { storageKey } from "@/shared/lib/storage"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { chinaDateISO } from "@/shared/lib/datetime"
import { CHANNEL_REGIONS } from "@/modules/crm/lib/crm-data"
import { channelContractStatus } from "@/modules/crm/lib/channel-contract-utils"
import { fetchAllChannelContracts, fetchAllChannelOpportunities, fetchChannels, channelContractUrl, subscribeChannelContractChanges, type ChannelContractRow, type ChannelPartner, type ChannelOpportunityRow } from "@/modules/crm/services/channel-management"
import { EmptyState, FilterChips, FilterField, FilterGrid, FilterSelect, StatCards } from "../ui"
import { MineOnlyToggle } from "../mine-only-toggle"
import { ChannelBadge, ChannelError, ChannelLoading, displayDate } from "./channel-ui"
import { ChannelContractForm } from "./channel-contract-form"

type Query = { keyword: string; status: string; region: string; subject: string; signer: string; project: string; mineOnly: boolean }
const EMPTY: Query = { keyword: "", status: "all", region: "all", subject: "all", signer: "all", project: "all", mineOnly: false }
type SortKey = "code" | "subject" | "contact" | "region" | "signingSubject" | "signer" | "status" | "project" | "effective" | "signed" | "months" | "end" | "created"
const allOptions = (values: string[], label: string) => [{ value: "all", label }, ...values.map((value) => ({ value, label: value }))]

export function ChannelContractRegistry({ create = false, partnerId, opportunityId, partnerType = "channel" }: { create?: boolean; partnerId?: string; opportunityId?: string; partnerType?: "channel" | "strategic_ecosystem" }) {
  const router = useRouter()
  const { user, canAccess, loading: authLoading } = useAuth()
  const allowed = canAccess("channels") && canAccess("contracts")
  const canCreate = Boolean(user?.permissions.some((permission) => ["channels:create", "channels:write"].includes(permission)))
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
  const { applied, setApplied, listStateReady } = usePersistedListApplied<Query>(storageKey("crm:channel-contract-list", 1, user?.id || "anonymous"), EMPTY)
  const q = applied.query
  const { sort, toggleSort } = useTableSort<SortKey>({ key: "created", dir: "desc" })
  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true); else setRefreshing(true)
    setError("")
    try {
      const [contracts, channels, opps] = await Promise.all([fetchAllChannelContracts(partnerType), fetchChannels(partnerType), (canViewOpportunities ? fetchAllChannelOpportunities(partnerType) : Promise.resolve([]))])
      if (request === requestId.current) { setRows(contracts); setPartners(channels); setOpportunities(opps) }
    } catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载渠道合同失败。") }
    finally { if (request === requestId.current) { setLoading(false); setRefreshing(false) } }
  }, [partnerType, canViewOpportunities, canViewContracts])
  useEffect(() => { if (!authLoading && allowed) void load(true); return () => { requestId.current += 1 } }, [load, allowed, authLoading])
  useEffect(() => { setCreating(create) }, [create])
  useEffect(() => {
    if (!allowed) return
    const unsubscribe = subscribeChannelContractChanges(() => void load())
    const visible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", visible)
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", visible) }
  }, [load, allowed])
  const scoped = useMemo(() => rows.filter((row) => !q.mineOnly || row.ownerUserId === user?.id || row.signer === user?.name), [rows, q.mineOnly, user?.id, user?.name])
  const filtered = useMemo(() => sortRows(scoped.filter((row) => {
    const keyword = q.keyword.trim().toLowerCase()
    return (!keyword || [row.name, row.contractNumber, row.channelSubject, row.partnerName, row.contactName, row.contactPhone, row.contactEmail].filter(Boolean).join(" ").toLowerCase().includes(keyword)) &&
      (q.status === "all" || row.status === q.status) && (q.region === "all" || row.region === q.region) &&
      (q.subject === "all" || row.signingSubject === q.subject) && (q.signer === "all" || row.signer === q.signer) && (q.project === "all" || (row.projectStatus || "无") === q.project)
  }), sort, {
    code: (row) => row.contractNumber || row.name, subject: (row) => row.channelSubject || row.partnerName,
    contact: (row) => row.contactName, region: (row) => row.region, signingSubject: (row) => row.signingSubject,
    signer: (row) => row.signer, status: (row) => row.status, project: (row) => row.projectStatus,
    effective: (row) => row.effectiveDate, signed: (row) => row.doubleSignedDate, months: (row) => row.termMonths,
    end: (row) => row.endDate, created: (row) => row.createdAt,
  }), [scoped, q, sort])
  const paged = paginateSlice(filtered, applied.page, DEFAULT_LIST_PAGE_SIZE)
  function patch<K extends keyof Query>(key: K, value: Query[K]) { setApplied((current) => ({ query: { ...current.query, [key]: value }, page: 1 })) }
  const contractRoot = partnerType === "strategic_ecosystem" ? "/contracts/ecosystems" : "/contracts/channels"
  function closeForm() { setCreating(false); if (create) router.replace(contractRoot, { scroll: false }) }
  const active = loading || !listStateReady
  const today = chinaDateISO()
  const soon = new Date(today + "T00:00:00Z"); soon.setUTCDate(soon.getUTCDate() + 30)
  const expiresSoon = scoped.filter((row) => row.status === "是" && row.endDate && row.endDate >= today && row.endDate <= soon.toISOString().slice(0, 10)).length
  const unique = (key: "signer" | "signingSubject") => [...new Set(rows.map((row) => row[key]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "zh-CN"))
  if (authLoading) return <ChannelLoading />
  if (!allowed) return <ChannelError message="当前账号需要合同管理及渠道管理的访问权限。" />
  const td = "whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"
  return <div className="space-y-3"><h1 className="sr-only">{partnerType === "strategic_ecosystem" ? "战略生态合同" : "渠道合同"}</h1>
    <StatCards dense items={[
      { label: "合同总数", value: active ? "—" : scoped.length },
      { label: "已签订", value: active ? "—" : scoped.filter((row) => row.status === "是").length, tone: "text-emerald-600" },
      { label: "待签订 / 入库中", value: active ? "—" : scoped.filter((row) => row.status !== "是").length, tone: "text-amber-600" },
      { label: "30 天内到期", value: active ? "—" : expiresSoon, tone: "text-primary" },
    ]} />
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">登记{partnerType === "strategic_ecosystem" ? "战略生态" : "渠道"}合作协议，串联伙伴、商机与合同。</p><div className="flex items-center gap-2"><MineOnlyToggle value={q.mineOnly} onChange={(value) => patch("mineOnly", value)} />{canCreate && <Button className="gap-1.5" onClick={() => setCreating(true)}><Plus className="size-4" />新增{partnerType === "strategic_ecosystem" ? "战略生态" : "渠道"}合同</Button>}</div></div>
      <FilterGrid>
        <FilterField label="关键词"><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-9" aria-label="搜索渠道合同" placeholder="合同名称、编号、渠道或联系人" value={q.keyword} onChange={(event) => patch("keyword", event.target.value)} /></div></FilterField>
        <FilterField label="区域"><FilterSelect value={q.region} onChange={(value) => patch("region", value)} options={allOptions(Object.keys(CHANNEL_REGIONS), "全部区域")} /></FilterField>
        <FilterField label="签约主体"><FilterSelect value={q.subject} onChange={(value) => patch("subject", value)} options={allOptions(unique("signingSubject"), "全部签约主体")} /></FilterField>
        <FilterField label="合同签订人"><FilterSelect value={q.signer} onChange={(value) => patch("signer", value)} options={allOptions(unique("signer"), "全部签订人")} /></FilterField>
        <FilterField label="项目状态"><FilterSelect value={q.project} onChange={(value) => patch("project", value)} options={allOptions(["有", "无"], "全部项目状态")} /></FilterField>
      </FilterGrid>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><FilterChips value={q.status} onChange={(value) => patch("status", value)} options={[{ value: "all", label: "全部状态" }, ...["准备签约", "走入库流程了", "是"].map((value) => ({ value, label: channelContractStatus(value) }))]} /><div className="flex gap-2"><Button variant="outline" onClick={() => setApplied({ query: EMPTY, page: 1 })}>重置</Button><Button variant="outline" size="icon" disabled={active || refreshing} aria-label="刷新渠道合同" onClick={() => void load()}><RefreshCw className={"size-4" + (refreshing ? " animate-spin" : "")} /></Button></div></div>
    </div>
    <ChannelError message={error} retry={() => void load(rows.length === 0)} />
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {refreshing && <ContentLoadingOverlay label="正在刷新渠道合同…" />}
      {active ? <ChannelLoading label="正在加载渠道合同…" /> : <TableCellTip><div className="overflow-x-auto"><table className="w-full min-w-[2200px] text-sm"><thead><tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
        <SortableTh label="合同编号 / 名称" sortKey="code" sort={sort} onToggle={toggleSort} /><SortableTh label="渠道主体名称" sortKey="subject" sort={sort} onToggle={toggleSort} /><SortableTh label="联系人" sortKey="contact" sort={sort} onToggle={toggleSort} /><th className={td}>电话</th><th className={td}>邮箱</th>
        <SortableTh label="区域" sortKey="region" sort={sort} onToggle={toggleSort} /><SortableTh label="签约主体" sortKey="signingSubject" sort={sort} onToggle={toggleSort} /><SortableTh label="合同签订人" sortKey="signer" sort={sort} onToggle={toggleSort} /><SortableTh label="合同状态" sortKey="status" sort={sort} onToggle={toggleSort} /><SortableTh label="项目状态" sortKey="project" sort={sort} onToggle={toggleSort} /><th className={td}>合同扫描件</th>
        <SortableTh label="生效日期" sortKey="effective" sort={sort} onToggle={toggleSort} /><SortableTh label="双签日期" sortKey="signed" sort={sort} onToggle={toggleSort} /><SortableTh label="有效期（月）" sortKey="months" sort={sort} onToggle={toggleSort} /><SortableTh label="结束日期" sortKey="end" sort={sort} onToggle={toggleSort} /><SortableTh label="创建时间" sortKey="created" sort={sort} onToggle={toggleSort} /><th className="sticky right-0 border-l bg-card px-4 py-3 font-medium">操作</th>
        </tr></thead><tbody>{paged.pageItems.map((row) => <tr key={row.id} role="link" tabIndex={0} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/30" onClick={() => router.push(channelContractUrl(row.id, partnerType))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(channelContractUrl(row.id, partnerType)) } }}>
        <td className="max-w-64 px-4 py-3"><p className="font-mono text-[10px] text-muted-foreground">{row.contractNumber || "未填写编号"}</p><p className="mt-1 truncate font-medium" title={row.name}>{row.name}</p></td><td className={td + " max-w-60 truncate"} title={row.channelSubject || row.partnerName}>{row.channelSubject || row.partnerName}</td><td className={td}>{row.contactName || "—"}</td><td className={td}>{row.contactPhone || "—"}</td><td className={td}>{row.contactEmail || "—"}</td><td className={td}>{row.region || "—"}</td><td className={td + " max-w-64 truncate"} title={row.signingSubject || ""}>{row.signingSubject || "—"}</td><td className={td}>{row.signer || "—"}</td><td className="px-4 py-3"><ChannelBadge value={row.status} kind="contract" /></td><td className={td}>{row.projectStatus || "无"}</td>
        <td className={td}>{row.attachments?.length ? <span className="text-primary">{row.attachments.length} 份文件</span> : "未上传"}</td><td className={td}>{displayDate(row.effectiveDate)}</td><td className={td}>{displayDate(row.doubleSignedDate)}</td><td className={td}>{row.termMonths ?? "—"}</td><td className={td}>{displayDate(row.endDate)}</td><td className={td}>{displayDate(row.createdAt)}</td><td className="sticky right-0 border-l bg-card px-4 py-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Button variant="outline" size="sm" onClick={() => router.push(channelContractUrl(row.id, partnerType))}>查看详情</Button></td>
      </tr>)}</tbody></table></div></TableCellTip>}
      {!active && !filtered.length && !error && <EmptyState text={rows.length ? "没有符合条件的渠道合同" : "暂无渠道合同，可从渠道商机点击「转为合同」。"} />}
    </div>
    <ListPagination total={paged.total} page={paged.currentPage} pageSize={DEFAULT_LIST_PAGE_SIZE} onPageChange={(page) => setApplied((current) => ({ ...current, page }))} label="份合同" />
    {creating && canCreate && !active && !error && <ChannelContractForm partners={partners} opportunities={opportunities} partnerId={partnerId} opportunityId={opportunityId} onClose={closeForm} onSaved={(row) => { setCreating(false); router.push(channelContractUrl(row.id, partnerType)) }} />}
  </div>
}
