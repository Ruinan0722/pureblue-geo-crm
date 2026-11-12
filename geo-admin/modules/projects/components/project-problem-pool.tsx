"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, LibraryBig, Search, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { EmptyState, Pill } from "@/modules/crm/components/ui"
import { ProjectWorkItemsPanel } from "@/modules/projects/components/project-work-items"
import type { ProjectWorkItem } from "@/modules/projects/lib/types"
import { fetchProjectProblemPool, fetchProjectWorkItems } from "@/modules/projects/services/projects-api"

export function ProjectProblemPool({ projectId, projectName, writable }: { projectId: string; projectName: string; writable: boolean }) {
  const [keyword, setKeyword] = useState("")
  const [results, setResults] = useState<ProjectWorkItem[]>([])
  const [library, setLibrary] = useState<ProjectWorkItem[]>([])
  const [projectIssues, setProjectIssues] = useState<ProjectWorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const searchPool = useCallback(async (term = "") => {
    setLoading(true)
    try { setResults(await fetchProjectProblemPool(term)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "搜索问题池失败") }
    finally { setLoading(false) }
  }, [])

  const loadOverview = useCallback(async () => {
    const [all, own] = await Promise.all([fetchProjectProblemPool(), fetchProjectWorkItems(projectId)])
    setLibrary(all)
    setResults(all)
    setProjectIssues(own.filter((item) => item.kind === "issue" || item.kind === "help"))
  }, [projectId])

  useEffect(() => {
    void loadOverview().catch((error) => toast.error(error instanceof Error ? error.message : "加载问题数据失败")).finally(() => setLoading(false))
    const refresh = (event: Event) => { const detail = (event as CustomEvent<{ projectId?: string }>).detail; if (!detail?.projectId || detail.projectId === projectId) void loadOverview() }
    window.addEventListener("project-work-items-changed", refresh)
    return () => window.removeEventListener("project-work-items-changed", refresh)
  }, [loadOverview, projectId])

  const resolved = library.filter((item) => item.status === "resolved" || item.status === "closed").length
  const processing = library.length - resolved

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">问题池概览</h3><p className="mt-1 text-xs text-muted-foreground">当前项目与公共知识库一屏查看</p></div><span className="rounded-xl bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/30"><CircleAlert className="size-5" /></span></div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">当前项目问题</p><p className="mt-1 text-2xl font-semibold tabular-nums">{projectIssues.length}</p></div>
            <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">公共问题总数</p><p className="mt-1 text-2xl font-semibold tabular-nums">{library.length}</p></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20"><p className="text-xs text-muted-foreground">已解决</p><p className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-300">{resolved}</p></div>
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20"><p className="text-xs text-muted-foreground">处理中</p><p className="mt-1 text-xl font-semibold text-blue-700 dark:text-blue-300">{processing}</p></div>
          </div>
          <div className="mt-4 rounded-xl bg-muted/35 p-3 text-xs leading-5 text-muted-foreground"><Sparkles className="mr-1.5 inline size-4 text-primary" />先搜索历史方案；无匹配结果再登记问题，解决后系统自动沉淀到公共问题库。</div>
          <Button asChild variant="outline" size="sm" className="mt-3 w-full"><Link href="/knowledge?department=%E9%A1%B9%E7%9B%AE%E8%BF%90%E8%90%A5"><LibraryBig className="mr-1.5 size-4" />进入完整问题库</Link></Button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 space-y-1.5 text-xs font-medium"><span>搜索公共问题库 · 仅展示 TOP 3</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPool(keyword) }} placeholder="输入问题现象、类型或关键词" /></div></label><Button variant="outline" onClick={() => void searchPool(keyword)}>搜索</Button></div>
          <div className="mt-4">
            {loading ? <p className="py-8 text-center text-sm text-muted-foreground">正在搜索问题池…</p> : results.length === 0 ? <EmptyState text={keyword ? "没有匹配方案，可以在下方登记新问题" : "问题池暂无记录"} /> : <div className="space-y-2">{results.slice(0, 3).map((item, index) => <article key={item.id} className="rounded-xl border border-border p-3 transition hover:border-primary/30 hover:bg-muted/20"><div className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-medium">{item.title}</h4><Pill label={item.category || "项目问题"} tone="neutral" /><Pill label={item.status === "resolved" || item.status === "closed" ? "已解决" : "处理中"} tone={item.status === "resolved" || item.status === "closed" ? "success" : "warning"} /></div><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.description || "暂无问题描述"}</p><p className="mt-2 line-clamp-2 rounded-lg bg-emerald-50/70 px-3 py-2 text-xs dark:bg-emerald-950/20"><span className="font-medium text-emerald-700 dark:text-emerald-300">方案：</span>{item.solution || "尚在处理中"}</p></div></div></article>)}</div>}
          </div>
        </section>
      </div>

      <ProjectWorkItemsPanel projectId={projectId} projectName={projectName} kinds={["help", "issue"]} primaryKind="issue" hideKindSelector writable={writable} title="当前项目问题" description="只填写需要人工判断的内容和截止日期；项目、状态、负责人、创建人及时间由系统自动生成。填写解决方案后状态自动变为已解决，并沉淀到公共问题库。" />
    </div>
  )
}
