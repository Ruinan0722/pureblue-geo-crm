"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, ChevronRight, CircleDollarSign, CircleHelp, Coins, Database, Download, Filter, Layers3, RefreshCw, Settings2, ShieldCheck, Target, TrendingDown, TrendingUp, Users, WalletCards, X } from "lucide-react"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useAuth } from "@/modules/auth"
import { fetchPaymentPlans } from "@/modules/crm/services/crm-api"
import type { Contract, Customer, Lead, Opportunity, PaymentPlan } from "@/modules/crm/lib/crm-data"
import { customerStatusMeta, money, normalizeCustomerStatus, normalizeLeadSource, normalizeOppStage, OPP_FLOW_STAGES, OPP_STAGE_META } from "@/modules/crm/lib/crm-data"
import { createDashboardDemoData, DASHBOARD_TEST_MODE } from "@/modules/crm/lib/dashboard-demo-data"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { FunnelChart } from "@/shared/charts"

type Theme = "overview" | "conversion" | "performance"
type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom"
type Filters = { range: Preset; from: string; to: string; owner: string; region: string }
type Row = { label: string; value: string; meta?: string; href?: string }
type Detail = { title: string; description: string; rows: Row[] }
type EmployeePerformance = { owner: string; quarterlyContractTarget: number; monthlyVisitTarget: number; monthlyOpportunityTarget: number }
const DAY = 86_400_000
const EMPTY: Filters = { range: "month", from: "", to: "", owner: "all", region: "all" }
const RANGE_OPTIONS = [{ value: "today", label: "今日" }, { value: "week", label: "本周" }, { value: "month", label: "本月" }, { value: "quarter", label: "本季度" }, { value: "year", label: "本年" }, { value: "custom", label: "自定义" }]

function pad(n: number) { return String(n).padStart(2, "0") }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function day(value?: string | null) { return String(value || "").slice(0, 10).replace(/\//g, "-") }
function bounds(filters: Filters): [string, string] {
  if (filters.range === "custom") return [filters.from || "0000-01-01", filters.to || "9999-12-31"]
  const end = new Date(); end.setHours(0, 0, 0, 0); const start = new Date(end)
  if (filters.range === "week") { const wd = start.getDay() || 7; start.setDate(start.getDate() - wd + 1) }
  if (filters.range === "month") start.setDate(1)
  if (filters.range === "quarter") start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1)
  if (filters.range === "year") start.setMonth(0, 1)
  return [ymd(start), ymd(end)]
}

function total(rows: Contract[]) { return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) }
function monthKeys(from: string, to: string) { const out: string[] = []; const start = new Date(`${from.slice(0, 7)}-01T00:00:00`); const end = new Date(`${to.slice(0, 7)}-01T00:00:00`); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return out; for (const d = new Date(start); d <= end && out.length < 24; d.setMonth(d.getMonth() + 1)) out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); return out }
function Trend({ rows, onSelect }: { rows: { key: string; label: string; value: number }[]; onSelect: (key: string) => void }) { if (!rows.some((x) => x.value > 0)) return <Empty text="当前筛选范围内没有有效签约金额" />; const max = Math.max(1, ...rows.map((x) => x.value)); return <div className="flex h-44 items-end gap-2 border-b px-1 pb-7">{rows.map((row) => <button type="button" key={row.key} onClick={() => onSelect(row.key)} title={`${row.label}：${wan(row.value)}`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center"><span className="w-full max-w-12 rounded-t-md bg-gradient-to-t from-blue-600 to-cyan-400 group-hover:from-blue-700 group-hover:to-cyan-500" style={{ height: `${Math.max(5, row.value / max * 100)}%` }} /><span className="absolute -bottom-6 whitespace-nowrap text-[10px] text-muted-foreground group-hover:text-primary">{row.label}</span></button>)}</div> }
function daysSince(value: string | undefined) { const time = new Date(`${day(value)}T00:00:00`).getTime(); return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / DAY)) : 0 }
function stageMetrics(opps: Opportunity[], stage: string, next?: string) { const left = opps.flatMap((opp) => (opp.stageHistory || []).filter((h) => h.stage === stage && h.leftAt).map((history) => ({ opp, history }))); if (!left.length) return { rate: "—", avg: "—" }; const advanced = next ? left.filter(({ opp, history }) => (opp.stageHistory || []).some((h) => h.stage === next && new Date(h.enteredAt).getTime() >= new Date(history.leftAt || "").getTime())).length : 0; const days = left.reduce((sum, { history }) => sum + Math.max(0, new Date(history.leftAt || "").getTime() - new Date(history.enteredAt).getTime()) / DAY, 0); return { rate: next ? pct(advanced, left.length) : "—", avg: `${Math.round(days / left.length * 10) / 10}天` } }
function allFollows(customers: Customer[], leads: Lead[], opps: Opportunity[]) { return [...customers.flatMap((x) => x.notes || []), ...leads.flatMap((x) => x.notes || []), ...opps.flatMap((x) => [...(x.notes || []), ...(x.advisorNotes || [])])] }
function followCount(customers: Customer[], leads: Lead[], opps: Opportunity[]) { return allFollows(customers, leads, opps).length }
function rankFollows(customers: Customer[], leads: Lead[], opps: Opportunity[]) { return group(allFollows(customers, leads, opps), (x) => x.author || "未填写").map((x) => ({ name: x.name, count: x.value })) }
function followDetailRows(customers: Customer[], leads: Lead[], opps: Opportunity[]): Row[] {
  const leadNotes = leads.flatMap((lead) => (lead.notes || []).map((note) => ({ label: `线索 · ${lead.companyName}`, value: note.author || "未填写", meta: `${day(note.date)} · ${note.content}` })))
  const customerNotes = customers.flatMap((customer) => (customer.notes || []).map((note) => ({ label: `客户 · ${customer.companyName}`, value: note.author || "未填写", meta: `${day(note.date)} · ${note.content}` })))
  const opportunityNotes = opps.flatMap((opp) => [...(opp.notes || []), ...(opp.advisorNotes || [])].map((note) => ({ label: `商机 · ${opp.name}`, value: note.author || "未填写", meta: `${day(note.date)} · ${note.content}` })))
  return [
    { label: "线索跟进次数", value: `${leadNotes.length} 次`, meta: "线索管理中的跟进记录" },
    { label: "客户跟进次数", value: `${customerNotes.length} 次`, meta: "客户管理中的跟进记录" },
    { label: "商机跟进次数", value: `${opportunityNotes.length} 次`, meta: "商机销售跟进与售前反馈" },
    ...[...leadNotes, ...customerNotes, ...opportunityNotes].sort((a, b) => String(b.meta).localeCompare(String(a.meta))),
  ]
}
function rankOwners(contracts: Contract[]) { const map = new Map<string, { name: string; amount: number; count: number }>(); contracts.forEach((c) => { const name = ownerOf(c); const row = map.get(name) || { name, amount: 0, count: 0 }; row.amount += Number(c.amount || 0); row.count += 1; map.set(name, row) }); return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count) }
function rankDepartments(contracts: Contract[]) { const map = new Map<string, { name: string; amount: number; count: number }>(); contracts.forEach((c) => { const name = c.dept || "部门未填写"; const row = map.get(name) || { name, amount: 0, count: 0 }; row.amount += Number(c.amount || 0); row.count += 1; map.set(name, row) }); return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count) }
function RankingBars({ title, description, rows, targets, onSelect }: { title: string; description: string; rows: { name: string; amount: number; count: number }[]; targets?: Record<string, number>; onSelect: (name: string) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.amount))
  return <Card title={title} description={description}>{rows.length ? <div className="space-y-3">{rows.map((row, i) => { const target = targets?.[row.name]; const completion = target ? Math.round(row.amount / target * 1000) / 10 : null; return <button type="button" key={row.name} onClick={() => onSelect(row.name)} className="group grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent bg-muted/25 px-3 py-3 text-left transition hover:border-primary/30 hover:bg-primary/5"><span className={`flex size-8 items-center justify-center rounded-full text-xs font-semibold ${i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span><span className="min-w-0"><span className="flex items-center justify-between gap-3"><strong className="truncate text-sm">{row.name}</strong><span className="text-xs text-muted-foreground">{row.count} 份合同{completion !== null ? ` · 目标完成 ${completion}%` : ""}</span></span><span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-500 group-hover:from-blue-700 group-hover:to-cyan-500" style={{ width: `${Math.max(6, row.amount / max * 100)}%` }} /></span></span><strong className="whitespace-nowrap text-sm tabular-nums text-emerald-600">{wan(row.amount)}</strong></button> })}</div> : <Empty text="本期暂无有效签约数据" />}</Card>
}
function previousBounds(filters: Filters): [string, string] {
  const [from, to] = bounds(filters); const start = new Date(`${from}T00:00:00`); const end = new Date(`${to}T00:00:00`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return ["0000-01-01", "0000-01-01"]
  const length = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1)
  const priorEnd = new Date(start.getTime() - DAY); const priorStart = new Date(priorEnd.getTime() - (length - 1) * DAY)
  return [ymd(priorStart), ymd(priorEnd)]
}
function yearAgoBounds(range: [string, string]): [string, string] {
  const shift = (value: string) => { const date = new Date(`${value}T00:00:00`); date.setFullYear(date.getFullYear() - 1); return ymd(date) }
  return [shift(range[0]), shift(range[1])]
}
function inBounds(value: string | undefined, range: [string, string]) { const d = day(value); return Boolean(d) && d >= range[0] && d <= range[1] }
function signDate(c: Contract) { return day(c.dualSignDate || c.effectiveDate || c.createdAt) }
function ownerOf(c: Contract) { return c.owner || c.owners?.[0] || "未分配" }
function wan(n: number) { return `${(n / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万` }
function pct(a: number, b: number) { return b > 0 ? `${Math.round(a / b * 1000) / 10}%` : "—" }
function uniq(values: string[]) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")) }
function compare(current: number, prior: number, label: "环比" | "同比") { if (!prior) return current ? `${label} 新增` : `${label} 持平`; const n = Math.round((current - prior) / Math.abs(prior) * 1000) / 10; return `${label} ${n > 0 ? "+" : ""}${n}%` }
function group<T>(rows: T[], key: (row: T) => string) { const map = new Map<string, number>(); rows.forEach((row) => { const name = key(row) || "未填写"; map.set(name, (map.get(name) || 0) + 1) }); return [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) }

function Section({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-600/25"><Icon className="size-5" /></span><div className="min-w-0"><h2 className="text-base font-semibold tracking-tight">{title}</h2><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p></div><span className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block" /></div>
}
function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"><header className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/15 px-5 py-4"><div><h3 className="text-sm font-semibold">{title}</h3>{description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}</div><span className="mt-0.5 rounded-lg bg-primary/8 p-1.5 text-primary"><BarChart3 className="size-3.5" /></span></header><div className="p-5">{children}</div></section>
}
function Empty({ text }: { text: string }) { return <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">{text}</div> }
function Metric({ label, value, hint, mom, yoy, tone, onClick }: { label: string; value: string | number; hint: string; mom?: string; yoy?: string; tone?: string; onClick?: () => void }) {
  const appearance = label.includes("回款") || label.includes("输单")
    ? { line: "bg-rose-500", surface: "from-rose-50/70", icon: CircleDollarSign, iconClass: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" }
    : label.includes("签约")
      ? { line: "bg-emerald-500", surface: "from-emerald-50/70", icon: Coins, iconClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" }
      : label.includes("续约")
        ? { line: "bg-amber-500", surface: "from-amber-50/70", icon: BriefcaseBusiness, iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" }
        : label.includes("商机")
          ? { line: "bg-violet-500", surface: "from-violet-50/70", icon: Target, iconClass: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" }
          : label.includes("客户")
            ? { line: "bg-cyan-500", surface: "from-cyan-50/70", icon: Users, iconClass: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300" }
            : { line: "bg-blue-500", surface: "from-blue-50/70", icon: Layers3, iconClass: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" }
  const Icon = appearance.icon
  const trendClass = (text: string) => text.includes("+") || text.includes("新增") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : text.includes("-") ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-muted text-muted-foreground"
  const trendIcon = (text: string) => text.includes("+") || text.includes("新增") ? <TrendingUp className="size-3" /> : text.includes("-") ? <TrendingDown className="size-3" /> : null
  const body = <><span className={`absolute inset-x-0 top-0 h-0.5 ${appearance.line}`} /><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-medium text-muted-foreground">{label}</span><strong className={`mt-2 block text-[1.65rem] leading-none tracking-tight tabular-nums ${tone || ""}`}>{value}</strong></div><span className={`rounded-xl p-2 ${appearance.iconClass}`}><Icon className="size-4" /></span></div><p className="mt-3 min-h-8 text-[11px] leading-4 text-muted-foreground">{hint}</p><div className="mt-2 flex min-h-6 items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10px]"><span className="flex min-w-0 flex-wrap gap-1">{mom ? <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 tabular-nums ${trendClass(mom)}`}>{trendIcon(mom)}{mom}</span> : null}{yoy ? <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 tabular-nums ${trendClass(yoy)}`}>{trendIcon(yoy)}{yoy}</span> : null}</span>{onClick ? <span className="inline-flex shrink-0 items-center font-medium text-primary">查看<ChevronRight className="size-3" /></span> : <CircleHelp className="size-3 text-muted-foreground/60" />}</div></>
  const cls = `relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br ${appearance.surface} to-card p-4 text-left shadow-sm transition dark:from-background dark:to-card`
  return onClick ? <button type="button" title={hint} onClick={onClick} className={`${cls} hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5`}>{body}</button> : <div title={hint} className={cls}>{body}</div>
}
function Bars({ rows, total, onSelect }: { rows: { name: string; value: number }[]; total: number; onSelect: (name: string) => void }) {
  if (!rows.length) return <Empty text="当前筛选范围内暂无数据" />
  const max = Math.max(1, ...rows.map((row) => row.value))
  return <div className="space-y-3">{rows.map((row) => <button type="button" key={row.name} onClick={() => onSelect(row.name)} className="group grid w-full grid-cols-[7rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-left text-xs"><span className="truncate group-hover:text-primary">{row.name}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-blue-500 group-hover:bg-blue-600" style={{ width: `${Math.max(4, row.value / max * 100)}%` }} /></span><span className="text-right tabular-nums text-muted-foreground">{row.value} · {pct(row.value, total)}</span></button>)}</div>
}
function Drawer({ detail, context, close }: { detail: Detail; context: string; close: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}><aside className="flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl"><header className="flex items-start gap-3 border-b p-5"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">{detail.title}</h2><p className="mt-1 text-sm text-muted-foreground">{detail.description}</p><p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">筛选：{context}</p></div><Button variant="ghost" size="icon" onClick={close}><X className="size-4" /></Button></header><div className="min-h-0 flex-1 overflow-auto p-5">{detail.rows.length ? <div className="overflow-hidden rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/80 text-xs text-muted-foreground"><tr><th className="px-4 py-3">名称</th><th className="px-4 py-3">数据</th><th className="px-4 py-3">说明</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{detail.rows.map((row, i) => <tr key={`${row.label}-${i}`} className="border-t"><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3">{row.value}</td><td className="px-4 py-3 text-xs text-muted-foreground">{row.meta || "—"}</td><td className="px-4 py-3">{row.href ? <a className="text-xs text-primary hover:underline" href={row.href}>查看</a> : "—"}</td></tr>)}</tbody></table></div> : <Empty text="当前筛选范围内确实为 0 条数据" />}</div></aside></div>
}

function PerformanceConfigurator({ rows, contractAmounts, visitCounts, opportunityCounts, close, save }: { rows: EmployeePerformance[]; contractAmounts: Record<string, number>; visitCounts: Record<string, number>; opportunityCounts: Record<string, number>; close: () => void; save: (rows: EmployeePerformance[]) => void }) {
  const [draft, setDraft] = useState(rows)
  const change = (owner: string, key: "quarterlyContractTarget" | "monthlyVisitTarget" | "monthlyOpportunityTarget", value: number) => setDraft((current) => current.map((row) => row.owner === owner ? { ...row, [key]: Math.max(0, Number.isFinite(value) ? value : 0) } : row))
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"><header className="flex items-start gap-3 border-b p-5"><span className="rounded-xl bg-primary/10 p-2 text-primary"><Settings2 className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">下属员工绩效配置</h2><p className="mt-1 text-sm text-muted-foreground">仅配置季度签约目标、月度有效拜访目标、月度有效商机目标三个指标。</p></div><Button variant="ghost" size="icon" onClick={close}><X className="size-4" /></Button></header><div className="min-h-0 flex-1 space-y-3 overflow-auto p-5"><div className="hidden grid-cols-[minmax(7rem,1fr)_9rem_9rem_9rem_minmax(13rem,1.2fr)] gap-3 px-3 text-xs text-muted-foreground lg:grid"><span>员工</span><span>季度签约目标（万）</span><span>有效拜访月目标（次）</span><span>有效商机月目标（个）</span><span>实时完成情况</span></div>{draft.map((row) => { const amount = contractAmounts[row.owner] || 0; const visits = visitCounts[row.owner] || 0; const validOpps = opportunityCounts[row.owner] || 0; const salesRate = row.quarterlyContractTarget ? Math.round(amount / row.quarterlyContractTarget * 1000) / 10 : 0; const visitRate = row.monthlyVisitTarget ? Math.round(visits / row.monthlyVisitTarget * 1000) / 10 : 0; const oppRate = row.monthlyOpportunityTarget ? Math.round(validOpps / row.monthlyOpportunityTarget * 1000) / 10 : 0; const previews = [{ label: "季度签约", value: salesRate, color: "bg-blue-500" }, { label: "有效拜访", value: visitRate, color: "bg-emerald-500" }, { label: "有效商机", value: oppRate, color: "bg-violet-500" }]; return <div key={row.owner} className="grid gap-3 rounded-xl border p-3 lg:grid-cols-[minmax(7rem,1fr)_9rem_9rem_9rem_minmax(13rem,1.2fr)] lg:items-center"><div><strong className="text-sm">{row.owner}</strong><p className="mt-1 text-[11px] text-muted-foreground">签约 {wan(amount)} · 拜访 {visits} · 商机 {validOpps}</p></div><Input aria-label={`${row.owner}季度签约目标`} type="number" min={0} value={row.quarterlyContractTarget / 10_000} onChange={(event) => change(row.owner, "quarterlyContractTarget", Number(event.target.value) * 10_000)} /><Input aria-label={`${row.owner}月度有效拜访目标`} type="number" min={0} value={row.monthlyVisitTarget} onChange={(event) => change(row.owner, "monthlyVisitTarget", Number(event.target.value))} /><Input aria-label={`${row.owner}月度有效商机目标`} type="number" min={0} value={row.monthlyOpportunityTarget} onChange={(event) => change(row.owner, "monthlyOpportunityTarget", Number(event.target.value))} /><div className="space-y-1.5">{previews.map((preview) => <div key={preview.label}><span className="flex justify-between text-[10px] text-muted-foreground"><span>{preview.label}</span><strong>{preview.value}%</strong></span><span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${preview.color}`} style={{ width: `${Math.min(100, preview.value)}%` }} /></span></div>)}</div></div> })}</div><footer className="flex items-center justify-between gap-3 border-t p-5"><p className="text-xs text-muted-foreground">本地验收配置保存在当前浏览器；接入正式绩效接口后可支持多人共享。</p><div className="flex gap-2"><Button variant="outline" onClick={close}>取消</Button><Button onClick={() => save(draft)}>保存配置</Button></div></footer></section></div>
}

function FiltersBar({ filters, change, owners, regions, scope }: { filters: Filters; change: (f: Filters) => void; owners: string[]; regions: string[]; scope: string }) {
  const activeCount = Number(filters.range !== "month") + Number(filters.owner !== "all") + Number(filters.region !== "all")
  return <section className="overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-lg shadow-slate-950/5 backdrop-blur xl:sticky xl:top-2 xl:z-20"><div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-3"><span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Filter className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">全局筛选</h2>{activeCount ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{activeCount} 项已生效</span> : <span className="text-[10px] text-muted-foreground">默认本月</span>}</div><p className="hidden text-[11px] text-muted-foreground sm:block">所有指标、图表和下钻明细同步响应</p></div><div className="hidden items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 md:flex"><ShieldCheck className="size-3.5" /><span className="max-w-40 truncate">{scope}</span></div><Button variant="ghost" size="sm" onClick={() => change(EMPTY)}><RefreshCw className="mr-1 size-3.5" />重置</Button></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.25fr]"><label><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">时间范围</span><SearchableSelect value={filters.range} onChange={(v) => change({ ...filters, range: v as Preset })} options={RANGE_OPTIONS} placeholder="时间范围" /></label><label><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">负责人</span><SearchableSelect value={filters.owner} onChange={(v) => change({ ...filters, owner: v })} options={[{ value: "all", label: "全部负责人" }, ...owners.map((v) => ({ value: v, label: v }))]} placeholder="负责人" /></label><label><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">销售区域</span><SearchableSelect value={filters.region} onChange={(v) => change({ ...filters, region: v })} options={[{ value: "all", label: "全部销售区域" }, ...regions.map((v) => ({ value: v, label: v }))]} placeholder="销售区域" /></label><label><span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">统计周期</span>{filters.range === "custom" ? <div className="flex gap-2"><Input aria-label="开始日期" type="date" value={filters.from} onChange={(e) => change({ ...filters, from: e.target.value })} /><Input aria-label="结束日期" type="date" value={filters.to} onChange={(e) => change({ ...filters, to: e.target.value })} /></div> : <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/20 px-3 text-xs text-muted-foreground"><CalendarDays className="size-3.5 text-primary" />{bounds(filters).join(" 至 ")}</div>}</label></div></section>
}

export function PrdDashboardV2() {
  const crm = useCrm(); const { user, role } = useAuth()
  const [filters, setFilters] = useState<Filters>(EMPTY); const [theme, setTheme] = useState<Theme>("overview"); const [detail, setDetail] = useState<Detail | null>(null)
  const [livePlans, setPlans] = useState<PaymentPlan[]>([]); const [livePlansState, setPlansState] = useState<"loading" | "ready" | "error">("loading"); const [updatedAt, setUpdatedAt] = useState(""); const [partial, setPartial] = useState(false)
  const [performanceOverrides, setPerformanceOverrides] = useState<Record<string, EmployeePerformance>>({}); const [configOpen, setConfigOpen] = useState(false)
  useEffect(() => { let active = true; void Promise.allSettled([crm.searchLeads({ page: 1, pageSize: 100 }), crm.searchCustomers({ page: 1, pageSize: 100 }), crm.ensureOpportunitiesLoaded(), crm.ensureContractsLoaded(), fetchPaymentPlans().then((rows) => { if (active) { setPlans(rows); setPlansState("ready") } }).catch(() => { if (active) setPlansState("error") })]).then((results) => { if (active) { setPartial(results.some((r) => r.status === "rejected")); setUpdatedAt(new Date().toLocaleString("zh-CN", { hour12: false })) } }); return () => { active = false } }, [crm.searchLeads, crm.searchCustomers, crm.ensureOpportunitiesLoaded, crm.ensureContractsLoaded])
  useEffect(() => { try { const saved = window.localStorage.getItem("geo-dashboard-performance-v2"); if (saved) setPerformanceOverrides(JSON.parse(saved) as Record<string, EmployeePerformance>) } catch { /* 浏览器禁用本地存储时继续使用默认测试配置 */ } }, [])
  const manager = ["admin", "super_admin", "ops", "leader", "marketing_leader"].includes(String(role))
  const demo = useMemo(() => createDashboardDemoData(user?.name || "当前用户"), [user?.name])
  const demoOwner = user?.name || "当前用户"
  const leads = DASHBOARD_TEST_MODE ? (manager ? demo.leads : demo.leads.filter((row) => row.sales === demoOwner)) : crm.leads
  const customers = DASHBOARD_TEST_MODE ? (manager ? demo.customers : demo.customers.filter((row) => row.owner === demoOwner)) : crm.customers
  const opportunities = DASHBOARD_TEST_MODE ? (manager ? demo.opportunities : demo.opportunities.filter((row) => row.owner === demoOwner)) : crm.opportunities
  const contracts = DASHBOARD_TEST_MODE ? (manager ? demo.contracts : demo.contracts.filter((row) => ownerOf(row) === demoOwner)) : crm.contracts
  const dashboardPlans = DASHBOARD_TEST_MODE ? (manager ? demo.paymentPlans : demo.paymentPlans.filter((row) => row.salesOwner === demoOwner)) : livePlans
  const plansState: "loading" | "ready" | "error" = DASHBOARD_TEST_MODE ? "ready" : livePlansState
  const owners = useMemo(() => uniq([...leads.map((x) => x.sales), ...customers.map((x) => x.owner), ...opportunities.map((x) => x.owner), ...contracts.map(ownerOf)]), [leads, customers, opportunities, contracts])
  const employeePerformance = owners.map((owner, index) => performanceOverrides[owner] || { owner, quarterlyContractTarget: [1_800_000, 1_350_000, 1_000_000, 750_000][index] || 600_000, monthlyVisitTarget: [24, 18, 14, 10][index] || 8, monthlyOpportunityTarget: [30, 24, 18, 12][index] || 10 })
  const savePerformance = (rows: EmployeePerformance[]) => { const next = Object.fromEntries(rows.map((row) => [row.owner, row])); setPerformanceOverrides(next); try { window.localStorage.setItem("geo-dashboard-performance-v2", JSON.stringify(next)) } catch { /* 保存失败时本次会话内仍即时生效 */ } setConfigOpen(false) }
  const regions = useMemo(() => uniq([...leads.map((x) => x.region), ...customers.map((x) => x.region), ...opportunities.map((x) => x.region), ...contracts.map((x) => x.region)]), [leads, customers, opportunities, contracts])
  const dimensions = (row: { owner?: string; sales?: string; customerId?: string; region?: string }) => (filters.owner === "all" || row.owner === filters.owner || row.sales === filters.owner) && (filters.region === "all" || row.region === filters.region)
  const select = <T extends { createdAt?: string; owner?: string; sales?: string; source?: string; customerId?: string; region?: string }>(rows: T[], range: [string, string], date: (row: T) => string | undefined = (row) => row.createdAt) => rows.filter((row) => dimensions(row) && inBounds(date(row), range))
  const now = bounds(filters); const prior = previousBounds(filters); const yearAgo = yearAgoBounds(now)
  const currentLeads = select(leads, now); const priorLeads = select(leads, prior)
  const currentCustomers = select(customers, now); const priorCustomers = select(customers, prior)
  const currentOpps = select(opportunities, now); const priorOpps = select(opportunities, prior)
  const currentContracts = select(contracts, now, signDate); const priorContracts = select(contracts, prior, signDate)
  const yearLeads = select(leads, yearAgo); const yearCustomers = select(customers, yearAgo); const yearOpps = select(opportunities, yearAgo); const yearContracts = select(contracts, yearAgo, signDate)
  const signed = currentContracts.filter((x) => x.status === "signed"); const priorSigned = priorContracts.filter((x) => x.status === "signed")
  const yearSigned = yearContracts.filter((x) => x.status === "signed")
  const lost = currentOpps.filter((x) => normalizeOppStage(x.stage) === "lost"); const inProgress = currentOpps.filter((x) => !["won", "lost"].includes(normalizeOppStage(x.stage))); const won = currentOpps.filter((x) => normalizeOppStage(x.stage) === "won")
  const pending = currentContracts.filter((x) => x.status === "pending"); const yearPending = yearContracts.filter((x) => x.status === "pending")
  const renewals = currentContracts.filter((x) => x.status === "signed" && inBounds(x.endDate, now)); const priorRenewals = priorContracts.filter((x) => x.status === "signed" && inBounds(x.endDate, prior)); const yearRenewals = yearContracts.filter((x) => x.status === "signed" && inBounds(x.endDate, yearAgo))
  const plansIn = (range: [string, string]) => dashboardPlans.filter((p) => { const c = contracts.find((x) => x.id === p.contractId); return inBounds(p.plannedDate, range) && (!c || dimensions({ owner: ownerOf(c), customerId: c.customerId, region: c.region })) })
  const unpaid = (rows: PaymentPlan[]) => rows.filter((p) => Number(p.outstandingAmount ?? p.plannedAmount - p.actualAmount) > 0)
  const outstanding = unpaid(plansIn(now)); const priorOutstanding = unpaid(plansIn(prior)); const yearOutstanding = unpaid(plansIn(yearAgo))
  const show = (title: string, description: string, rows: Row[]) => setDetail({ title, description, rows })
  const href = (value: string) => DASHBOARD_TEST_MODE ? undefined : value
  const leadRows = (rows: Lead[]) => rows.map((x) => ({ label: x.companyName, value: x.sales || "未分配", meta: `${normalizeLeadSource(x.source) || "来源未填写"} · ${day(x.createdAt)}`, href: href(`/leads/${x.id}`) }))
  const customerRows = (rows: Customer[]) => rows.map((x) => ({ label: x.companyName, value: x.owner || "未分配", meta: `${customerStatusMeta(normalizeCustomerStatus(x.status)).label} · ${day(x.createdAt)}`, href: href(`/customers/${x.id}`) }))
  const oppRows = (rows: Opportunity[]) => rows.map((x) => ({ label: x.name, value: money(Number(x.amount || 0)), meta: `${OPP_STAGE_META[normalizeOppStage(x.stage)]?.label || x.stage} · ${x.owner || "未分配"}`, href: href(`/opportunities/${x.id}`) }))
  const contractRows = (rows: Contract[]) => rows.map((x) => ({ label: `${x.company || x.name} · ${x.code}`, value: money(Number(x.amount || 0)), meta: `${x.status === "signed" ? "已签订" : x.status === "pending" ? "待签订" : x.status} · ${signDate(x)}`, href: href(`/contracts/${x.id}`) }))
  const context = `${now.join(" 至 ")}；${filters.owner === "all" ? "全部负责人" : filters.owner}；${filters.region === "all" ? "全部销售区域" : filters.region}`

  const overviewItems = [
    { label: "总线索数", value: currentLeads.length, raw: currentLeads.length, prior: priorLeads.length, year: yearLeads.length, hint: "按线索创建时间统计", rows: leadRows(currentLeads) },
    { label: "总客户数", value: currentCustomers.length, raw: currentCustomers.length, prior: priorCustomers.length, year: yearCustomers.length, hint: "按客户创建时间统计", rows: customerRows(currentCustomers) },
    { label: "总商机数", value: currentOpps.length, raw: currentOpps.length, prior: priorOpps.length, year: yearOpps.length, hint: "按商机创建时间统计", rows: oppRows(currentOpps) },
    { label: "输单商机数", value: lost.length, raw: lost.length, prior: priorOpps.filter((x) => normalizeOppStage(x.stage) === "lost").length, year: yearOpps.filter((x) => normalizeOppStage(x.stage) === "lost").length, hint: "当前阶段为输单的商机", rows: oppRows(lost), tone: "text-rose-600" },
    { label: "有效签约数", value: signed.length, raw: signed.length, prior: priorSigned.length, year: yearSigned.length, hint: "合同状态为已签订，按签约日期统计", rows: contractRows(signed), tone: "text-emerald-600" },
    { label: "有效签约金额", value: wan(total(signed)), raw: total(signed), prior: total(priorSigned), year: total(yearSigned), hint: "有效签约合同金额合计", rows: contractRows(signed), tone: "text-emerald-600" },
    { label: "待签约金额", value: wan(total(pending)), raw: total(pending), prior: total(priorContracts.filter((x) => x.status === "pending")), year: total(yearPending), hint: "合同状态为待签订的金额合计", rows: contractRows(pending), tone: "text-amber-600" },
  ]
  const sourceGroups = group(currentLeads, (x) => normalizeLeadSource(x.source) || "未填写")
  const statusGroups = group(currentCustomers, (x) => customerStatusMeta(normalizeCustomerStatus(x.status)).label)
  const trend = monthKeys(now[0], now[1]).map((key) => ({ key, label: `${Number(key.slice(5))}月`, value: total(signed.filter((x) => signDate(x).startsWith(key))) }))
  const paymentCustomers = (rows: PaymentPlan[]) => new Set(rows.map((plan) => contracts.find((contract) => contract.id === plan.contractId)?.customerId).filter(Boolean)).size
  const paymentAmount = (rows: PaymentPlan[]) => rows.reduce((sum, plan) => sum + Number(plan.outstandingAmount ?? plan.plannedAmount - plan.actualAmount), 0)
  const overviewMetric = (item: typeof overviewItems[number]) => <Metric key={item.label} label={item.label} value={item.value} hint={item.hint} mom={compare(item.raw, item.prior, "环比")} yoy={compare(item.raw, item.year, "同比")} tone={item.tone} onClick={() => show(`${item.label}明细`, item.hint, item.rows)} />
  const overview = (
    <div className="space-y-5">
      <Section title="经营总览" icon={WalletCards} description="核心指标统一展示当前数字、环比和同比；点击卡片可查看组成明细。" />
      <div className="space-y-3"><div className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-blue-500" /><h3 className="text-xs font-semibold">客户与商机资产</h3><span className="text-[10px] text-muted-foreground">看业务盘面规模</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{overviewItems.slice(0, 3).map(overviewMetric)}</div></div>
      <div className="space-y-3"><div className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-emerald-500" /><h3 className="text-xs font-semibold">成交进度</h3><span className="text-[10px] text-muted-foreground">看签约结果与风险</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{overviewItems.slice(3).map(overviewMetric)}</div></div>
      <div className="space-y-3"><div className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-rose-500" /><h3 className="text-xs font-semibold">资金与续约</h3><span className="text-[10px] text-muted-foreground">看现金回收与存量经营</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="待回款客户数" value={plansState === "error" ? "加载失败" : paymentCustomers(outstanding)} hint="计划收款日在筛选周期内且仍有未收金额，同一客户只计一次" mom={compare(paymentCustomers(outstanding), paymentCustomers(priorOutstanding), "环比")} yoy={compare(paymentCustomers(outstanding), paymentCustomers(yearOutstanding), "同比")} tone="text-rose-600" onClick={plansState === "ready" ? () => show("待回款明细", "筛选周期内应收金额减去实际已收金额", outstanding.map((p) => ({ label: p.contractName || p.contractCode || p.id, value: wan(Number(p.outstandingAmount ?? p.plannedAmount - p.actualAmount)), meta: p.periodName, href: href(`/contracts/${p.contractId}`) }))) : undefined} /><Metric label="待回款金额" value={plansState === "loading" ? "加载中…" : plansState === "error" ? "加载失败" : wan(paymentAmount(outstanding))} hint="筛选周期内计划收款金额减实际收款金额" mom={compare(paymentAmount(outstanding), paymentAmount(priorOutstanding), "环比")} yoy={compare(paymentAmount(outstanding), paymentAmount(yearOutstanding), "同比")} tone="text-rose-600" onClick={plansState === "ready" ? () => show("待回款金额明细", "按筛选周期内回款计划汇总未收金额", outstanding.map((p) => ({ label: p.contractName || p.contractCode || p.id, value: wan(Number(p.outstandingAmount ?? p.plannedAmount - p.actualAmount)), meta: `${p.periodName} · ${p.plannedDate}`, href: href(`/contracts/${p.contractId}`) }))) : undefined} /><Metric label="待续约客户数" value={renewals.length} hint="合同结束日期落在当前筛选范围内" mom={compare(renewals.length, priorRenewals.length, "环比")} yoy={compare(renewals.length, yearRenewals.length, "同比")} tone="text-amber-600" onClick={() => show("待续约客户明细", "仍需业务确认是否续签", contractRows(renewals))} /><Metric label="待续约金额" value={wan(total(renewals))} hint="待续约合同原合同金额合计" mom={compare(total(renewals), total(priorRenewals), "环比")} yoy={compare(total(renewals), total(yearRenewals), "同比")} tone="text-amber-600" onClick={() => show("待续约金额明细", "组成待续约金额的合同", contractRows(renewals))} /></div></div>
      <div className="grid gap-5 xl:grid-cols-3"><Card title="月度签约金额趋势" description="有效签约合同金额；点击月份查看合同"><Trend rows={trend} onSelect={(key) => show(`${key} 签约明细`, "该月份的有效签约合同", contractRows(signed.filter((x) => signDate(x).startsWith(key))))} /></Card><Card title="线索来源分布" description="按创建时间统计；点击来源查看线索"><Bars rows={sourceGroups} total={currentLeads.length} onSelect={(name) => show(`${name}线索`, "当前来源的线索明细", leadRows(currentLeads.filter((x) => (normalizeLeadSource(x.source) || "未填写") === name)))} /></Card><Card title="客户状态分布" description="按创建时间统计；点击状态查看客户"><Bars rows={statusGroups} total={currentCustomers.length} onSelect={(name) => show(`${name}客户`, "当前状态的客户明细", customerRows(currentCustomers.filter((x) => customerStatusMeta(normalizeCustomerStatus(x.status)).label === name)))} /></Card></div>
    </div>
  )

  const validLeads = currentLeads.filter((x) => x.status !== "invalid"); const converted = currentLeads.filter((x) => x.status === "converted" || Boolean(x.convertedCustomerId))
  const chain = [
    { label: "线索", value: currentLeads.length, note: `有效 ${validLeads.length} / 无效 ${currentLeads.length - validLeads.length}`, rows: leadRows(currentLeads) },
    { label: "已转客户线索", value: converted.length, note: `转客户率 ${pct(converted.length, currentLeads.length)}`, rows: leadRows(converted) },
    { label: "商机", value: currentOpps.length, note: `进行中 ${inProgress.length} / 输单 ${lost.length}`, rows: oppRows(currentOpps) },
    { label: "赢单商机", value: won.length, note: `赢单率 ${pct(won.length, currentOpps.length)}`, rows: oppRows(won) },
    { label: "有效签约", value: signed.length, note: `金额 ${wan(total(signed))}`, rows: contractRows(signed) },
  ]
  const losses = group(lost, (x) => x.lostReasonL2 || x.lostReasonL1 || x.lostReason || "未填写原因").slice(0, 5)
  const opportunityStages = OPP_FLOW_STAGES.map((stage, i) => {
    const rows = currentOpps.filter((x) => normalizeOppStage(x.stage) === stage)
    return {
      stage,
      label: OPP_STAGE_META[stage].label,
      rows,
      history: i === OPP_FLOW_STAGES.length - 1 ? { rate: "终点", avg: "已成交" } : stageMetrics(currentOpps, stage, OPP_FLOW_STAGES[i + 1]),
      stalled: rows.filter((x) => daysSince(x.lastFollowAt || x.createdAt) > 30).length,
    }
  })
  const conversion = (
    <div className="space-y-5">
      <Section title="销售转化" icon={Activity} description="从获客到签约看完整链路，定位商机卡点、阶段停留和输单原因。阶段历史缺失时显示“—”，不从当前阶段反推。" />
      <Card title="全链路转化漏斗" description="线索 → 客户 → 商机 → 赢单 → 合同；点击任一层查看明细">
        <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">{chain.map((step, i) => <div key={step.label} className="contents"><button type="button" onClick={() => show(`${step.label}明细`, step.note, step.rows)} className="rounded-xl border bg-muted/20 p-4 text-left transition hover:border-primary/50 hover:bg-primary/5"><span className="text-xs text-muted-foreground">{step.label}</span><strong className="mt-1 block text-2xl tabular-nums">{step.value}</strong><span className="mt-2 block text-[11px] text-muted-foreground">{step.note}</span></button>{i < chain.length - 1 ? <span className="hidden items-center text-muted-foreground xl:flex"><ArrowRight className="size-4" /></span> : null}</div>)}</div>
        <div className="mt-5 border-t pt-5"><p className="mb-2 text-xs font-medium">全链路漏斗图</p><p className="mb-3 text-[11px] text-muted-foreground">保留上方关键数字卡片，下方用漏斗直观看各环节收窄情况；悬浮和点击均可查看。</p><div className="mx-auto max-w-4xl"><FunnelChart data={chain.map((step, index) => ({ name: step.label, value: step.value, fill: ["#1d4ed8", "#2563eb", "#3b82f6", "#0ea5e9", "#16a34a"][index] }))} height={300} emptyText="本期没有全链路数据" onSelect={(datum, index) => { const step = chain[index]; if (step) show(`${String(datum.name)}明细`, step.note, step.rows) }} /></div></div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Card title="商机阶段漏斗" description="从上到下按销售阶段逐级收窄；数量为当前阶段存量">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.9fr)]">
            <FunnelChart
              data={opportunityStages.map((item, i) => ({
                name: item.label,
                value: item.rows.length,
                fill: ["#2563eb", "#3b82f6", "#60a5fa", "#38bdf8", "#22c55e", "#16a34a", "#15803d"][i],
              }))}
              height={390}
              emptyText="本期没有商机数据"
              onSelect={(datum, index) => { const item = opportunityStages[index]; if (item) show(`${String(datum.name)}商机`, "从漏斗阶段进入的商机明细；卡单口径为超过 30 天无跟进", oppRows(item.rows)) }}
            />
            <div>
              <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_5rem_4rem] gap-2 px-3 pb-2 text-[11px] text-muted-foreground">
                <span>阶段</span><span>数量</span><span>转化率</span><span>平均停留</span><span>卡单</span>
              </div>
              <div className="space-y-2">
                {opportunityStages.map((item) => <button type="button" key={item.stage} onClick={() => show(`${item.label}商机`, "当前阶段商机；卡单口径为超过 30 天无跟进", oppRows(item.rows))} className="grid w-full grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_5rem_4rem] items-center gap-2 rounded-xl border border-transparent bg-muted/35 px-3 py-2.5 text-left text-sm transition hover:border-primary/30 hover:bg-primary/5"><span className="truncate font-medium">{item.label}</span><strong className="tabular-nums">{item.rows.length}</strong><span className="text-xs tabular-nums text-muted-foreground">{item.history.rate}</span><span className="text-xs tabular-nums text-muted-foreground">{item.history.avg}</span><span className={`text-xs tabular-nums ${item.stalled ? "text-rose-600" : "text-muted-foreground"}`}>{item.stalled}</span></button>)}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">点击阶段查看商机明细；“—”表示阶段历史不足，暂不能可靠计算。</p>
            </div>
          </div>
        </Card>
        <Card title="商机结果分析" description="赢单 / 输单 / 进行中，以及输单原因 TOP 5"><div className="grid grid-cols-3 gap-2">{[{ name: "赢单", rows: won }, { name: "输单", rows: lost }, { name: "进行中", rows: inProgress }].map((item) => <button type="button" key={item.name} onClick={() => show(`${item.name}商机`, "按当前阶段统计", oppRows(item.rows))} className="rounded-xl bg-muted/40 p-3 text-left hover:bg-primary/5"><span className="text-xs text-muted-foreground">{item.name}</span><strong className="mt-1 block text-xl">{item.rows.length}</strong></button>)}</div><div className="mt-5 border-t pt-4"><p className="mb-3 text-xs font-medium">输单原因 TOP 5</p><Bars rows={losses} total={lost.length} onSelect={(name) => show(`${name} · 输单商机`, "按已填写原因归类", oppRows(lost.filter((x) => (x.lostReasonL2 || x.lostReasonL1 || x.lostReason || "未填写原因") === name)))} /></div></Card>
      </div>
    </div>
  )

  const quarterRange = bounds({ ...EMPTY, range: "quarter" }); const monthRange = bounds({ ...EMPTY, range: "month" })
  const quarterSigned = select(contracts, quarterRange, signDate).filter((contract) => contract.status === "signed")
  const monthValidOpps = select(opportunities, monthRange).filter((opp) => normalizeOppStage(opp.stage) !== "lost")
  const visibleFollows = allFollows(customers.filter(dimensions), leads.filter(dimensions), opportunities.filter(dimensions)); const monthVisits = visibleFollows.filter((note) => note.followType === "offline" && inBounds(note.date, monthRange))
  const visitCountByOwner = Object.fromEntries(group(monthVisits, (note) => note.author || "未填写").map((row) => [row.name, row.value])); const opportunityCountByOwner = Object.fromEntries(group(monthValidOpps, (opp) => opp.owner || "未分配").map((row) => [row.name, row.value]))
  const people = rankOwners(quarterSigned); const departments = rankDepartments(quarterSigned); const follows = rankFollows(currentCustomers, currentLeads, currentOpps)
  const personalAmount = total(quarterSigned.filter((x) => ownerOf(x) === user?.name)); const teamAmount = total(quarterSigned); const personalRank = people.findIndex((x) => x.name === user?.name) + 1; const average = people.length ? teamAmount / people.length : 0
  const performanceRows = manager ? employeePerformance : employeePerformance.filter((row) => row.owner === demoOwner)
  const performanceAmount = manager ? teamAmount : personalAmount
  const targetByOwner = Object.fromEntries(employeePerformance.map((row) => [row.owner, row.quarterlyContractTarget]))
  const amountByOwner = Object.fromEntries(people.map((row) => [row.name, row.amount]))
  const performanceTarget = performanceRows.reduce((sum, row) => sum + row.quarterlyContractTarget, 0)
  const performanceRate = performanceTarget > 0 ? `${Math.round(performanceAmount / performanceTarget * 1000) / 10}%` : "0%"
  const visitActual = performanceRows.reduce((sum, row) => sum + Number(visitCountByOwner[row.owner] || 0), 0); const visitTarget = performanceRows.reduce((sum, row) => sum + row.monthlyVisitTarget, 0)
  const opportunityActual = performanceRows.reduce((sum, row) => sum + Number(opportunityCountByOwner[row.owner] || 0), 0); const opportunityTarget = performanceRows.reduce((sum, row) => sum + row.monthlyOpportunityTarget, 0)
  const performance = (
    <div className="space-y-5">
      <Section title="业绩排行" icon={Target} description="绩效只使用三个指标：季度签约目标、月度有效拜访目标、月度有效商机目标。" />
      {manager ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/20"><div><p className="text-sm font-medium">下属员工绩效配置</p><p className="mt-1 text-xs text-muted-foreground">逐人设置季度签约金额，以及月度有效拜访和有效商机数量目标。</p></div><Button size="sm" onClick={() => setConfigOpen(true)}><Settings2 className="mr-1.5 size-3.5" />配置下属绩效</Button></div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label={manager ? "本季度团队签约金额" : "本季度本人签约金额"} value={wan(performanceAmount)} hint="当前自然季度有效签约合同金额" tone="text-emerald-600" onClick={() => show("季度签约合同明细", "当前自然季度有效签约合同", contractRows(manager ? quarterSigned : quarterSigned.filter((x) => ownerOf(x) === user?.name)))} />
        <Metric label="季度签约目标" value={wan(performanceTarget)} hint="销售管理配置的季度签约目标汇总" />
        <Metric label="季度签约完成率" value={performanceRate} hint="本季度签约金额 ÷ 季度签约目标" tone="text-primary" />
        <Metric label="月度有效拜访" value={`${visitActual} / ${visitTarget} 次`} hint={`当前自然月完成率 ${pct(visitActual, visitTarget)}`} tone="text-blue-600" />
        <Metric label="月度有效商机" value={`${opportunityActual} / ${opportunityTarget} 个`} hint={`当前自然月完成率 ${pct(opportunityActual, opportunityTarget)}`} tone="text-violet-600" />
        <Metric label="跟进次数" value={followCount(currentCustomers, currentLeads, currentOpps)} hint="点击查看线索、客户、商机跟进次数及记录" onClick={() => show("跟进次数明细", "先汇总线索、客户、商机三类跟进次数，再列出每条跟进记录", followDetailRows(currentCustomers, currentLeads, currentOpps))} />
      </div>
      {manager ? <div className="grid gap-5 xl:grid-cols-2"><RankingBars title="季度部门业绩排行" description="按本季度签约金额从高到低，以横向条形长度展示差距" rows={departments} onSelect={(name) => show(`${name}季度签约明细`, "按签约部门汇总", contractRows(quarterSigned.filter((x) => (x.dept || "部门未填写") === name)))} /><RankingBars title="季度个人业绩排行" description="横向排行条展示金额差异，并显示季度目标完成率" rows={people} targets={targetByOwner} onSelect={(name) => show(`${name}季度签约明细`, "按合同负责人汇总", contractRows(quarterSigned.filter((x) => ownerOf(x) === name)))} /></div> : <Card title="我的业绩位置" description="保护同事个人金额，只展示你的结果和团队平均"><div className="grid gap-3 sm:grid-cols-3"><Metric label="本人季度签约金额" value={wan(personalAmount)} hint="本人本季度有效签约合同金额" /><Metric label="本人季度排名" value={personalRank ? `第 ${personalRank} 名` : "本期暂无"} hint="不展示同事具体金额" /><Metric label="团队季度人均" value={wan(average)} hint="季度签约金额 ÷ 有业绩人数" /></div></Card>}
      <Card title="跟进活跃排行" description="按跟进记录作者统计，反映客户触达活跃度，不等同于任务完成率">{follows.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{(manager ? follows : follows.filter((x) => x.name === user?.name)).map((row, i) => <div key={row.name} className="flex items-center gap-3 rounded-xl border p-3"><span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span><strong>{row.count}</strong><span className="text-xs text-muted-foreground">次</span></div>)}</div> : <Empty text="本期暂无跟进记录" />}</Card>
    </div>
  )

  const loading = !DASHBOARD_TEST_MODE && (crm.opportunitiesLoading || crm.contractsLoading)
  return (
    <div className="space-y-5 pb-10">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-6 shadow-sm sm:px-7 sm:py-7">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl"><div className="flex flex-wrap items-center gap-2"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-5" /></span><div><p className="text-[11px] font-medium text-primary">数据看板</p><h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">经营数据驾驶舱</h1></div>{DASHBOARD_TEST_MODE ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">演示数据 · 不写入业务库</span> : null}</div><p className="mt-3 text-sm leading-6 text-muted-foreground">一屏掌握客户资产、销售转化、签约回款与团队绩效；所有指标均可点击下钻。</p><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Database className="size-3.5 text-primary" />更新于 {updatedAt || new Date().toLocaleString("zh-CN", { hour12: false })}</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" />{DASHBOARD_TEST_MODE ? manager ? "全量测试样本" : "本人测试样本" : manager ? "权限范围内数据" : "本人数据"}</span></div></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[34rem]"><div className="rounded-xl border border-border bg-muted/25 p-3"><span className="text-[10px] text-muted-foreground">本期签约</span><strong className="mt-1 block text-lg tabular-nums text-foreground">{wan(total(signed))}</strong></div><div className="rounded-xl border border-border bg-muted/25 p-3"><span className="text-[10px] text-muted-foreground">商机总额</span><strong className="mt-1 block text-lg tabular-nums text-foreground">{wan(currentOpps.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong></div><div className="rounded-xl border border-border bg-muted/25 p-3"><span className="text-[10px] text-muted-foreground">赢单率</span><strong className="mt-1 block text-lg tabular-nums text-foreground">{pct(won.length, currentOpps.length)}</strong></div><div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><span className="text-[10px] text-rose-600">待回款</span><strong className="mt-1 block text-lg tabular-nums text-rose-700">{plansState === "ready" ? wan(paymentAmount(outstanding)) : "加载中"}</strong></div></div>
        </div>
        <Button variant="outline" size="sm" disabled title="导出需由后端按数据权限生成" className="absolute right-5 top-5 hidden xl:inline-flex"><Download className="mr-1 size-3.5" />导出</Button>
      </section>
      {!DASHBOARD_TEST_MODE && (partial || plansState === "error") ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">部分数据加载失败，对应指标已标识，请稍后刷新。</div> : null}
      <FiltersBar filters={filters} change={setFilters} owners={manager ? owners : uniq([user?.name || ""])} regions={regions} scope={DASHBOARD_TEST_MODE ? manager ? "全量测试样本" : "本人测试样本" : manager ? user?.departmentNames?.join(" / ") || "权限范围内组织" : "本人数据"} />
      {loading ? <div className="rounded-2xl border bg-card py-20 text-center text-sm text-muted-foreground">加载看板数据中…</div> : <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)}><TabsList className="grid h-auto w-full grid-cols-3 gap-2 bg-transparent p-0"><TabsTrigger value="overview" className="group h-auto justify-start rounded-xl border bg-card px-3 py-3 text-left shadow-sm data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-primary sm:px-4"><span className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground"><WalletCards className="size-4" /></span><span><strong className="block text-xs sm:text-sm">经营总览</strong><small className="hidden font-normal text-muted-foreground sm:block">规模、签约与回款</small></span></TabsTrigger><TabsTrigger value="conversion" className="group h-auto justify-start rounded-xl border bg-card px-3 py-3 text-left shadow-sm data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-primary sm:px-4"><span className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground"><Activity className="size-4" /></span><span><strong className="block text-xs sm:text-sm">销售转化</strong><small className="hidden font-normal text-muted-foreground sm:block">漏斗、卡点与输单</small></span></TabsTrigger><TabsTrigger value="performance" className="group h-auto justify-start rounded-xl border bg-card px-3 py-3 text-left shadow-sm data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-primary sm:px-4"><span className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground"><Users className="size-4" /></span><span><strong className="block text-xs sm:text-sm">业绩排行</strong><small className="hidden font-normal text-muted-foreground sm:block">目标、排名与跟进</small></span></TabsTrigger></TabsList><TabsContent value="overview" className="mt-6">{overview}</TabsContent><TabsContent value="conversion" className="mt-6">{conversion}</TabsContent><TabsContent value="performance" className="mt-6">{performance}</TabsContent></Tabs>}
      {detail ? <Drawer detail={detail} context={context} close={() => setDetail(null)} /> : null}
      {configOpen ? <PerformanceConfigurator rows={employeePerformance} contractAmounts={amountByOwner} visitCounts={visitCountByOwner} opportunityCounts={opportunityCountByOwner} close={() => setConfigOpen(false)} save={savePerformance} /> : null}
    </div>
  )
}
