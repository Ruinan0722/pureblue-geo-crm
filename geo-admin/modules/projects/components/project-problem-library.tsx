"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, CircleAlert, LibraryBig, Search } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { EmptyState, Pill } from "@/modules/crm/components/ui"
import type { ProjectWorkItem } from "@/modules/projects/lib/types"
import { fetchProjectProblemPool } from "@/modules/projects/services/projects-api"

function done(item: ProjectWorkItem) { return item.status === "resolved" || item.status === "closed" }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")) }
function priorityLabel(value: string) { return value === "high" ? "高" : value === "low" ? "低" : "中" }
function riskLabel(value: string) { return value === "high" ? "高风险" : value === "medium" ? "中风险" : "低风险" }

export function ProjectProblemLibrary() {
  const [items, setItems] = useState<ProjectWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState("")
  const [status, setStatus] = useState("all")
  const [owner, setOwner] = useState("all")
  const [category, setCategory] = useState("all")

  useEffect(() => { void fetchProjectProblemPool().then(setItems).catch((error) => toast.error(error instanceof Error ? error.message : "加载公共问题库失败")).finally(() => setLoading(false)) }, [])
  const owners = useMemo(() => unique(items.map((item) => item.owner)), [items])
  const categories = useMemo(() => unique(items.map((item) => item.category)), [items])
  const resolved = items.filter(done).length
  const visible = items.filter((item) => {
    const text = `${item.title} ${item.description} ${item.solution} ${item.category} ${String(item.data?.projectName || "")}`.toLowerCase()
    return (!keyword.trim() || text.includes(keyword.trim().toLowerCase())) && (status === "all" || (status === "resolved") === done(item)) && (owner === "all" || item.owner === owner) && (category === "all" || item.category === category)
  })

  return <div className="mx-auto max-w-7xl px-5 py-6 lg:px-8">
    <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回项目管理</Link>
    <div className="mt-4 flex items-start gap-3"><span className="rounded-xl bg-primary/10 p-2.5"><LibraryBig className="size-5 text-primary" /></span><div><h1 className="text-xl font-semibold">公共问题库</h1><p className="mt-1 text-sm text-muted-foreground">跨项目沉淀历史问题与解决方案，所有具有项目模块权限的成员均可检索。</p></div></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">问题总数</p><p className="mt-2 text-2xl font-semibold">{items.length}</p></div><div className="rounded-2xl border bg-card p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-500" />已解决</p><p className="mt-2 text-2xl font-semibold text-emerald-600">{resolved}</p></div><div className="rounded-2xl border bg-card p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleAlert className="size-4 text-amber-500" />处理中</p><p className="mt-2 text-2xl font-semibold text-amber-600">{items.length - resolved}</p></div></div>
    <div className="mt-5 rounded-2xl border bg-card p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索问题、现象或解决方案" /></label><SearchableSelect value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "processing", label: "处理中" }, { value: "resolved", label: "已解决" }]} placeholder="状态" /><SearchableSelect value={owner} onChange={setOwner} options={[{ value: "all", label: "全部负责人" }, ...owners.map((value) => ({ value, label: value }))]} placeholder="负责人" /><SearchableSelect value={category} onChange={setCategory} options={[{ value: "all", label: "全部问题类型" }, ...categories.map((value) => ({ value, label: value }))]} placeholder="问题类型" /></div><p className="mt-3 text-xs text-muted-foreground">共 {visible.length} 条符合条件的问题</p></div>
    <div className="mt-5 space-y-3">{loading ? <div className="py-16 text-center text-sm text-muted-foreground">加载问题库中…</div> : visible.length ? visible.map((item) => <article key={item.id} className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{item.title}</h2><Pill label={item.category || "项目问题"} tone="neutral" /><Pill label={done(item) ? "已解决" : "处理中"} tone={done(item) ? "success" : "warning"} /><Pill label={riskLabel(item.riskLevel)} tone={item.riskLevel === "high" ? "danger" : item.riskLevel === "medium" ? "warning" : "muted"} /></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description || "未填写问题描述"}</p><div className={`mt-3 rounded-xl px-4 py-3 text-sm ${done(item) ? "bg-emerald-50/70 dark:bg-emerald-950/20" : "bg-muted/50"}`}><span className="font-medium">解决方案：</span>{item.solution || "尚在处理中，解决后由系统沉淀方案"}</div></div><dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 text-xs text-muted-foreground lg:w-72"><div><dt>负责人</dt><dd className="mt-0.5 font-medium text-foreground">{item.owner || "系统未识别"}</dd></div><div><dt>优先级</dt><dd className="mt-0.5 font-medium text-foreground">{priorityLabel(item.priority)}</dd></div><div><dt>自动截止</dt><dd className="mt-0.5 font-medium text-foreground">{item.dueDate || "—"}</dd></div><div><dt>登记时间</dt><dd className="mt-0.5 font-medium text-foreground">{item.createdAt || "—"}</dd></div></dl></div>{typeof item.data?.projectName === "string" && item.data.projectName ? <Link href={`/projects/${item.projectId}`} className="mt-3 inline-flex text-xs text-primary hover:underline">来源项目：{item.data.projectName}</Link> : null}</article>) : <div className="rounded-2xl border border-dashed bg-card py-16"><EmptyState text="没有符合当前筛选条件的问题" /></div>}</div>
  </div>
}
