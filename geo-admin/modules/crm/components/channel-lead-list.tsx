"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertCircle, FileText, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { canDo } from "@/modules/auth/lib/permissions"
import type { Lead } from "@/modules/crm/lib/crm-data"
import { LeadNavigation } from "./lead-navigation"

type ChannelLead = Lead & { duplicateCount: number }
type ListData = { items: ChannelLead[]; total: number }
type Sales = { id: string; name: string }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/channel-intake${path}`, { cache: "no-store", ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof (body.error || body.detail) === "string" ? body.error || body.detail : "操作失败，请稍后重试")
  return body as T
}

export function ChannelLeadList({ assigned = false }: { assigned?: boolean }) {
  const { user } = useAuth()
  const permissions = user?.permissions ?? []
  const canAssign = canDo(permissions, "leads:edit", "leads:write")
  const canConvert = assigned ? canDo(permissions, "channels:create", "channels:write") : canDo(permissions, "leads:convert", "leads:write")
  const canFollow = assigned ? permissions.includes("channels:write") : canAssign
  const [data, setData] = useState<ListData>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [action, setAction] = useState<{ type: "assign" | "convert" | "follow-up"; lead: ChannelLead } | null>(null)
  const [note, setNote] = useState("")
  const [notes, setNotes] = useState<Array<{ id: string; author: string; content: string; date: string }>>([])
  const [sales, setSales] = useState<Sales[]>([])
  const [salesId, setSalesId] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState("")
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setData(await request<ListData>(`/${assigned ? "assigned-leads" : "leads"}?page=${page}&name=${encodeURIComponent(query)}`)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : "加载失败") }
    finally { setLoading(false) }
  }, [page, query, assigned])
  useEffect(() => { void load() }, [load])

  async function openAssign(lead: ChannelLead) {
    setAction({ type: "assign", lead }); setSalesId(""); setSales([]); setActionError("")
    try { setSales(await request<Sales[]>("/sales")) }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "读取销售成员失败") }
  }

  async function openFollow(lead: ChannelLead) {
    setAction({ type: "follow-up", lead }); setNote(""); setNotes([]); setActionError("")
    try { setNotes(await request(`/leads/${encodeURIComponent(lead.id)}/follow-ups`)) }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "读取跟进记录失败") }
  }

  async function execute() {
    if (!action || busy) return
    setBusy(true); setActionError("")
    try {
      await request(`/leads/${encodeURIComponent(action.lead.id)}/${action.type}`, { method: "POST", headers: { "Content-Type": "application/json" }, ...(action.type === "assign" ? { body: JSON.stringify({ salesUserId: salesId }) } : action.type === "follow-up" ? { body: JSON.stringify({ content: note }) } : {}) })
      toast.success(action.type === "assign" ? "已分配渠道销售" : action.type === "follow-up" ? "跟进已记录" : "已转为渠道商，资料和联系人已保留")
      setAction(null); await load()
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "操作失败") }
    finally { setBusy(false) }
  }

  return <div className="px-5 py-6 lg:px-8">{assigned ? <Link href="/channels" className="mb-5 inline-block text-sm text-primary">← 返回渠道管理</Link> : <LeadNavigation active="channels" />}
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{assigned ? "待跟进渠道线索" : "渠道线索"}</h1><p className="mt-2 text-sm text-muted-foreground">{assigned ? "跟进分配给您的渠道线索，确认合作后转为渠道商。" : "承接渠道资料单提交的信息，分配销售并转为渠道商。"}</p></div>{!assigned && <Button asChild variant="outline" className="gap-2"><Link href="/leads/channel-profile"><FileText className="size-4" />分享渠道资料单</Link></Button>}</div>
    <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()) }} className="mb-5 flex max-w-md gap-2"><Input aria-label="搜索公司名称" placeholder="搜索公司名称" value={search} onChange={(e) => setSearch(e.target.value)} /><Button type="submit" className="gap-2"><Search className="size-4" />查询</Button></form>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}<button className="ml-3 underline" onClick={() => void load()}>重试</button></p>}
    <div className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-5 py-3 text-sm"><span>共 {data.total} 条渠道线索</span><span className="text-xs text-muted-foreground">来源：渠道资料单</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["公司 / 联系人", "联系方式 / 职位", "城市 / 行业", "渠道类型 / 签约方式", "归属 SDR / 销售", "状态", "提交时间", "操作"].map((label) => <th className="whitespace-nowrap px-4 py-3 font-medium" key={label}>{label}</th>)}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={8} className="p-12 text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中…</td></tr> : data.items.map((lead) => <tr className="border-t hover:bg-muted/30" key={lead.id}>
          <td className="max-w-64 px-4 py-4">{assigned ? <span className="font-medium">{lead.companyName}</span> : <Link href={`/leads/${lead.id}`} className="font-medium text-primary hover:underline">{lead.companyName}</Link>}<p className="mt-1 text-xs text-muted-foreground">{lead.contactName}</p>{lead.duplicateCount > 1 && <span className="mt-2 inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700"><AlertCircle className="size-3" />疑似重复 · {lead.duplicateCount} 条</span>}</td>
          <td className="px-4 py-4">{lead.contactPhone}<p className="mt-1 text-xs text-muted-foreground">{lead.contactTitle}</p></td>
          <td className="px-4 py-4">{lead.city}<p className="mt-1 text-xs text-muted-foreground">{lead.industry}</p></td>
          <td className="px-4 py-4">{lead.channelType}<p className="mt-1 text-xs text-muted-foreground">{lead.signingMethod}</p></td>
          <td className="px-4 py-4">{lead.sdr || "待分配 SDR"}<p className="mt-1 text-xs text-muted-foreground">{lead.sales || "未分配"}</p></td>
          <td className="whitespace-nowrap px-4 py-4"><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{lead.status === "converted" ? "已转渠道商" : lead.status === "invalid" ? "无效线索" : lead.sales && lead.sales !== "未分配" ? "已分配" : "待分配"}</span></td>
          <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">{lead.createdAt}</td>
          <td className="px-4 py-4"><div className="flex flex-wrap gap-2">{lead.status !== "converted" && lead.status !== "invalid" && <>{!assigned && canAssign && <Button size="sm" variant="outline" onClick={() => void openAssign(lead)}>分配销售</Button>}{canFollow && <Button size="sm" variant="outline" onClick={() => void openFollow(lead)}>记录跟进</Button>}{canConvert && <Button size="sm" disabled={!lead.sales || lead.sales === "未分配"} onClick={() => { setAction({ type: "convert", lead }); setActionError("") }}>转渠道商</Button>}</>}{lead.convertedPartnerId && <span className="text-xs text-muted-foreground">已归档至渠道管理</span>}</div></td>
        </tr>)}{!loading && !error && !data.items.length && <tr><td colSpan={8} className="px-5 py-16 text-center"><p className="text-sm font-medium">暂无渠道线索</p><p className="mt-2 text-xs text-muted-foreground">分享渠道资料单，客户提交后会显示在这里。</p></td></tr>}</tbody>
      </table></div>
      <div className="flex items-center justify-end gap-3 border-t px-4 py-3"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>上一页</Button><span className="text-xs text-muted-foreground">第 {page} / {Math.max(1, Math.ceil(data.total / 10))} 页</span><Button size="sm" variant="outline" disabled={page * 10 >= data.total || loading} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </div>
    <Dialog open={!!action} onOpenChange={(open) => { if (!open && !busy) setAction(null) }}><DialogContent><DialogHeader><DialogTitle>{action?.type === "assign" ? "分配渠道销售" : action?.type === "follow-up" ? "记录渠道线索跟进" : "转为渠道商"}</DialogTitle><DialogDescription>{action?.lead.companyName}{action?.type === "convert" ? "：将保留联系人、职位、城市、行业和合作意向，创建由已分配销售负责的渠道档案。" : action?.type === "assign" ? "：请选择在职销售成员负责后续跟进。" : "：记录本次沟通情况，转渠道商时会一并保留。"}</DialogDescription></DialogHeader>
      {action?.type === "follow-up" && <><div className="max-h-48 space-y-3 overflow-auto rounded-lg bg-muted/30 p-3">{notes.length ? notes.map((item) => <article key={item.id}><p className="whitespace-pre-wrap text-sm">{item.content}</p><p className="mt-1 text-xs text-muted-foreground">{item.author} · {item.date}</p></article>) : <p className="text-xs text-muted-foreground">暂无跟进记录</p>}</div><textarea aria-label="跟进内容" maxLength={4000} className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" placeholder="请输入本次跟进内容" value={note} onChange={(e) => setNote(e.target.value)} /></>}
      {action?.type === "assign" && <select aria-label="销售负责人" value={salesId} onChange={(e) => setSalesId(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">请选择销售负责人</option>{sales.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button><Button disabled={busy || (action?.type === "assign" && !salesId) || (action?.type === "follow-up" && !note.trim())} onClick={() => void execute()}>{busy ? "处理中…" : "确认"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
