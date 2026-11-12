"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight, RefreshCw, Search } from "lucide-react"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { ListPagination } from "@/shared/ui/list-pagination"
import { DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"
import { CHANNEL_CONTRACT_STATUSES, CHANNEL_OPPORTUNITY_STAGES } from "@/modules/crm/lib/crm-data"
import { fetchAllChannelContracts, fetchAllChannelOpportunities, channelContractCreateUrl, channelContractUrl, subscribeChannelOpportunityChanges, type ChannelContractRow, type ChannelOpportunityRow } from "@/modules/crm/services/channel-management"
import { ChannelSignDialog, ChannelStageDialog } from "./channels/channel-action-dialogs"
import { ChannelBadge, ChannelEmpty, ChannelError, ChannelLoading, NativeSelect, displayDate } from "./channels/channel-ui"

function useChannelRows<T>(fetcher: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  const reload = useCallback(async () => {
    const request = ++requestId.current
    setLoading(true); setError("")
    try { const data = await fetcher(); if (request === requestId.current) setRows(data) }
    catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载失败，请重试。") }
    finally { if (request === requestId.current) setLoading(false) }
  }, [fetcher])
  useEffect(() => { void reload(); return () => { requestId.current += 1 } }, [reload])
  useEffect(() => {
    const unsubscribe = subscribeChannelOpportunityChanges(() => void reload())
    function refreshVisible() { if (document.visibilityState === "visible") void reload() }
    document.addEventListener("visibilitychange", refreshVisible)
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", refreshVisible) }
  }, [reload])
  return { rows, loading, error, reload }
}

function WorkflowFrame({ title, description, search, onSearch, filter, loading, error, reload, children, total, page, setPage, partnerType = "channel" }: {
  title: string; description: string; search: string; onSearch: (value: string) => void; filter: ReactNode
  loading: boolean; error: string; reload: () => void; children: ReactNode; total: number; page: number; setPage: (value: number) => void
  partnerType?: "channel" | "strategic_ecosystem"
}) {
  return <section className="overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5">
      <div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
      <Link href={partnerType === "strategic_ecosystem" ? "/ecosystems" : "/channels"} className="inline-flex items-center gap-1 text-xs font-medium text-primary">{partnerType === "strategic_ecosystem" ? "战略生态客户" : "渠道伙伴"}<ArrowUpRight className="size-3.5" /></Link>
    </div>
    <div className="flex flex-wrap gap-2 border-b p-4">
      <div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-9" aria-label={"搜索" + title} placeholder="搜索名称、渠道伙伴…" value={search} onChange={(event) => onSearch(event.target.value)} /></div>
      <div className="w-40">{filter}</div><Button variant="outline" size="icon-lg" aria-label={"刷新" + title} onClick={reload} disabled={loading}><RefreshCw className={"size-4" + (loading ? " animate-spin" : "")} /></Button>
    </div>
    {error && <div className="p-4"><ChannelError message={error} retry={reload} /></div>}
    {loading ? <ChannelLoading /> : error && total === 0 ? null : children}
    {!loading && total > 0 && <div className="border-t p-4 [&>div]:items-start [&>div]:sm:justify-start [&>div]:sm:gap-6 [&>div>div]:justify-start"><ListPagination total={total} page={page} onPageChange={setPage} /></div>}
  </section>
}

function partnerLink(id: string, tab: string, partnerType: "channel" | "strategic_ecosystem") { return (partnerType === "strategic_ecosystem" ? "/ecosystems/" : "/channels/") + encodeURIComponent(id) + "?tab=" + tab }
const th = "whitespace-nowrap px-5 py-3 text-xs font-medium text-muted-foreground"
const td = "px-5 py-4 text-sm"

export function ChannelOpportunityList({ focusId, partnerType = "channel" }: { focusId?: string; partnerType?: "channel" | "strategic_ecosystem" }) {
  const { user, canAccess } = useAuth()
  const canWrite = Boolean(user?.permissions.includes("channels:write"))
  const canCreateContract = canAccess("contracts") && Boolean(user?.permissions.some((permission) => ["channels:create", "channels:write"].includes(permission)))
  const loadRows = useCallback(() => fetchAllChannelOpportunities(partnerType), [partnerType])
  const { rows, loading, error, reload } = useChannelRows(loadRows)
  const [search, setSearch] = useState("")
  const [stage, setStage] = useState("")
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<ChannelOpportunityRow | null>(null)
  const focusApplied = useRef<string | undefined>(undefined)
  const filtered = useMemo(() => rows.filter((row) => (!stage || row.stage === stage) && [row.name, row.partnerName, row.ownerName].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase())), [rows, search, stage])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / DEFAULT_LIST_PAGE_SIZE)))
  const pageRows = filtered.slice((currentPage - 1) * DEFAULT_LIST_PAGE_SIZE, currentPage * DEFAULT_LIST_PAGE_SIZE)
  useEffect(() => {
    if (!focusId || loading || focusApplied.current === focusId) return
    const index = filtered.findIndex((row) => row.id === focusId)
    if (index < 0) return
    const targetPage = Math.floor(index / DEFAULT_LIST_PAGE_SIZE) + 1
    if (currentPage !== targetPage) { setPage(targetPage); return }
    document.getElementById("channel-opportunity-" + focusId)?.scrollIntoView({ block: "center" })
    focusApplied.current = focusId
  }, [focusId, filtered, currentPage, loading])
  return <>
    <WorkflowFrame title={partnerType === "strategic_ecosystem" ? "战略生态商机" : "渠道商机"} description="跟踪合作进展，点击伙伴可查看完整合作记录。" search={search} onSearch={(value) => { setSearch(value); setPage(1) }}
      loading={loading} error={error} reload={() => void reload()} total={filtered.length} page={currentPage} setPage={setPage}
      filter={<NativeSelect label="筛选合作商机阶段" value={stage} onChange={(value) => { setStage(value); setPage(1) }} options={[...CHANNEL_OPPORTUNITY_STAGES, "输单"]} placeholder="全部阶段" />} partnerType={partnerType}>
      {pageRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="border-b bg-muted/30"><tr>{["合作商机", partnerType === "strategic_ecosystem" ? "战略生态伙伴" : "渠道伙伴", "负责人", "当前阶段", "最近更新", "操作"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
        <tbody className="divide-y">{pageRows.map((row) => <tr key={row.id} id={"channel-opportunity-" + row.id} aria-current={row.id === focusId ? "true" : undefined} className={row.id === focusId ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : "hover:bg-muted/20"}><td className={td}><Link href={partnerLink(row.partnerId, "opportunities", partnerType)} className="font-medium hover:text-primary">{row.name}</Link>{row.lostReason && <p className="mt-1 max-w-60 truncate text-xs text-muted-foreground" title={row.lostReason}>输单原因：{row.lostReason}</p>}</td><td className={td}><Link href={partnerLink(row.partnerId, "opportunities", partnerType)} className="text-xs text-primary hover:underline">{row.partnerName}</Link></td><td className={td + " whitespace-nowrap text-xs"}>{row.ownerName || "—"}</td><td className={td}><ChannelBadge value={row.stage} kind="stage" /></td><td className={td + " whitespace-nowrap text-xs text-muted-foreground"}>{displayDate(row.updatedAt)}</td><td className={td}><div className="flex items-center gap-2">{canCreateContract && row.stage !== "输单" && <Button asChild variant="outline" size="sm"><Link href={channelContractCreateUrl(row.partnerId, row.id, partnerType)}>转为合同</Link></Button>}{canWrite && !["赢单", "输单"].includes(row.stage) ? <Button size="sm" variant="outline" onClick={() => setTarget(row)}>更新阶段</Button> : <span className="text-xs text-muted-foreground">{["赢单", "输单"].includes(row.stage) ? "已结束" : "只读"}</span>}</div></td></tr>)}</tbody>
      </table></div> : <ChannelEmpty title={rows.length ? "没有匹配的商机" : "还没有合作商机"} description={rows.length ? "请调整搜索关键词或阶段筛选。" : "在伙伴详情中创建合作商机，统一跟进合作进度。"} action={<Link href={partnerType === "strategic_ecosystem" ? "/ecosystems" : "/channels"} className="text-sm font-medium text-primary">前往伙伴管理 →</Link>} />}
    </WorkflowFrame>
    {target && <ChannelStageDialog target={target} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); void reload() }} />}
  </>
}

export function ChannelContractList() {
  const { user } = useAuth()
  const canWrite = Boolean(user?.permissions.includes("channels:write"))
  const { rows, loading, error, reload } = useChannelRows(fetchAllChannelContracts)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<ChannelContractRow | null>(null)
  const filtered = useMemo(() => rows.filter((row) => (!status || row.status === status) && [row.name, row.partnerName, row.contractNumber].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase())), [rows, search, status])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / DEFAULT_LIST_PAGE_SIZE)))
  const pageRows = filtered.slice((currentPage - 1) * DEFAULT_LIST_PAGE_SIZE, currentPage * DEFAULT_LIST_PAGE_SIZE)
  return <>
    <WorkflowFrame title="渠道合作合同" description="登记合作协议与签约结果，关联商机可同步推进至赢单。" search={search} onSearch={(value) => { setSearch(value); setPage(1) }}
      loading={loading} error={error} reload={() => void reload()} total={filtered.length} page={currentPage} setPage={setPage}
      filter={<NativeSelect label="筛选渠道合同状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={CHANNEL_CONTRACT_STATUSES.filter((value) => value !== "否").map((value) => ({ value, label: value === "是" ? "已签约" : value }))} placeholder="全部合同状态" />}>
      {pageRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="border-b bg-muted/30"><tr>{["合作合同", "渠道伙伴", "合同编号", "合同状态", "签约日期", "操作"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead><tbody className="divide-y">{pageRows.map((row) => <tr key={row.id} className="hover:bg-muted/20"><td className={td}><Link href={channelContractUrl(row.id)} className="font-medium hover:text-primary">{row.name}</Link></td><td className={td}><Link href={channelContractUrl(row.id)} className="text-xs text-primary hover:underline">{row.partnerName}</Link></td><td className={td + " text-xs text-muted-foreground"}>{row.contractNumber || "未登记"}</td><td className={td}><ChannelBadge value={row.status} kind="contract" /></td><td className={td + " whitespace-nowrap text-xs text-muted-foreground"}>{displayDate(row.signedAt)}</td><td className={td}>{canWrite && row.status !== "是" ? <Button size="sm" variant="outline" onClick={() => setTarget(row)}>确认已签约</Button> : <span className="text-xs text-muted-foreground">{row.status === "是" ? "已签约" : "只读"}</span>}</td></tr>)}</tbody></table></div> : <ChannelEmpty title={rows.length ? "没有匹配的合同" : "还没有渠道合作合同"} description={rows.length ? "请调整关键词或合同状态筛选。" : "在渠道伙伴详情中登记合作合同，签署后确认签约结果。"} action={<Link href="/channels" className="text-sm font-medium text-primary">前往渠道管理 →</Link>} />}
    </WorkflowFrame>
    {target && <ChannelSignDialog contract={target} partnerId={target.partnerId} partnerName={target.partnerName} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); void reload() }} />}
  </>
}
