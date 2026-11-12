"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, ExternalLink, FileText, FolderKanban, HeartHandshake, RefreshCw, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { fetchProjectDashboard, fetchProjectReport } from "@/modules/projects/services/projects-api"
import type { ProjectDashboard as DashboardData, ProjectDashboardDrilldownRow, ProjectReport } from "@/modules/projects/lib/types"

function amount(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
}

function MetricCard({ label, value, hint, tone = "default", onClick }: { label: string; value: string | number; hint?: string; tone?: "default" | "danger" | "success" | "warning"; onClick: () => void }) {
  const tones = {
    default: "bg-card",
    danger: "border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20",
    success: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20",
    warning: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20",
  }
  return (
    <button type="button" onClick={onClick} className={`group rounded-2xl border border-border p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{label}</p><ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint || "点击查看明细"}</p>
    </button>
  )
}

function Progress({ value, tone = "bg-primary" }: { value: number; tone?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  )
}

type DrilldownState = {
  key: string
  title: string
  description: string
  kind: ProjectDashboardDrilldownRow["rowType"]
}

const STATUS_LABELS: Record<string, string> = {
  pending_start: "待启动",
  active: "执行中",
  completed: "已完结",
  paused: "已延期",
  processing: "处理中",
  pending: "待处理",
  pending_review: "处理中",
  awaiting_approval: "处理中",
  in_progress: "处理中",
  submitted: "处理中",
  payment_pending: "待回款",
  resolved: "已解决",
  closed: "已关闭",
  approved: "已通过",
  delivered: "已交付",
  paid: "已回款",
  partial: "部分回款",
  overdue: "已逾期",
  uninvoiced: "未开票",
  invoiced: "已开票",
}

function statusLabel(value?: string) {
  return STATUS_LABELS[value || ""] || value || "—"
}

function StatusPill({ value, overdue }: { value?: string; overdue?: boolean }) {
  const danger = overdue || value === "overdue"
  const done = ["completed", "resolved", "closed", "approved", "delivered", "paid"].includes(value || "")
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${danger ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" : done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"}`}>{danger && value !== "overdue" ? "已逾期" : statusLabel(value)}</span>
}

function ProjectLink({ projectId }: { projectId?: string }) {
  if (!projectId) return <span className="text-muted-foreground">—</span>
  return <Button variant="ghost" size="sm" className="h-8 px-2" asChild><Link href={`/projects/${projectId}`}>查看项目<ExternalLink className="ml-1 size-3.5" /></Link></Button>
}

function DrilldownTable({ rows, kind }: { rows: ProjectDashboardDrilldownRow[]; kind: ProjectDashboardDrilldownRow["rowType"] }) {
  if (!rows.length) return <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">该指标下暂无明细数据</div>

  if (kind === "payment") return (
    <div className="max-h-[58vh] overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[1050px] text-sm"><thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur"><tr><th className="px-3 py-3 font-medium">项目 / 客户</th><th className="px-3 py-3 font-medium">收款周期</th><th className="px-3 py-3 text-right font-medium">计划金额</th><th className="px-3 py-3 text-right font-medium">已收金额</th><th className="px-3 py-3 text-right font-medium">未收金额</th><th className="px-3 py-3 font-medium">计划时间</th><th className="px-3 py-3 font-medium">实际时间</th><th className="px-3 py-3 font-medium">回款状态</th><th className="px-3 py-3 font-medium">操作</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((row, index) => <tr key={`${row.projectId}-${row.periodName}-${index}`} className="hover:bg-muted/30"><td className="px-3 py-3"><p className="font-medium">{row.projectName || "—"}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.customerName || "—"}</p></td><td className="px-3 py-3">{row.periodName || "—"}</td><td className="px-3 py-3 text-right tabular-nums">{amount(row.plannedAmount || 0)}</td><td className="px-3 py-3 text-right tabular-nums text-emerald-600">{amount(row.actualAmount || 0)}</td><td className="px-3 py-3 text-right tabular-nums text-amber-600">{amount(row.outstandingAmount || 0)}</td><td className="px-3 py-3 whitespace-nowrap">{row.plannedDate || "—"}</td><td className="px-3 py-3 whitespace-nowrap">{row.actualDate || "—"}</td><td className="px-3 py-3"><StatusPill value={row.status === "pending" ? "payment_pending" : row.status} /></td><td className="px-3 py-3"><ProjectLink projectId={row.projectId} /></td></tr>)}</tbody>
      </table>
    </div>
  )

  if (kind === "workItem") return (
    <div className="max-h-[58vh] overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[1120px] text-sm"><thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur"><tr><th className="px-3 py-3 font-medium">项目 / 客户</th><th className="px-3 py-3 font-medium">事项</th><th className="px-3 py-3 font-medium">问题类型</th><th className="px-3 py-3 font-medium">负责人</th><th className="px-3 py-3 font-medium">回复人</th><th className="px-3 py-3 font-medium">审核人</th><th className="px-3 py-3 font-medium">状态</th><th className="px-3 py-3 font-medium">截止 / 发生时间</th><th className="px-3 py-3 font-medium">说明 / 解决方案</th><th className="px-3 py-3 font-medium">操作</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((row, index) => <tr key={`${row.projectId}-${row.title}-${index}`} className="hover:bg-muted/30"><td className="px-3 py-3"><p className="font-medium">{row.projectName || "—"}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.customerName || "—"}</p></td><td className="max-w-56 px-3 py-3 font-medium">{row.title || "—"}</td><td className="px-3 py-3">{row.category || "其他"}</td><td className="px-3 py-3">{row.owner || "未设置"}</td><td className="px-3 py-3">{row.responder || "未回复"}{row.leaderAnswered ? <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">Leader</span> : null}</td><td className="px-3 py-3">{row.reviewer || "未审核"}</td><td className="px-3 py-3"><StatusPill value={row.status} overdue={row.overdue} /></td><td className="px-3 py-3 whitespace-nowrap">{row.date || "—"}</td><td className="max-w-72 px-3 py-3 text-muted-foreground"><p className="line-clamp-2">{row.detail || "—"}</p></td><td className="px-3 py-3"><ProjectLink projectId={row.projectId} /></td></tr>)}</tbody>
      </table>
    </div>
  )

  return (
    <div className="max-h-[58vh] overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[1040px] text-sm"><thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur"><tr><th className="px-3 py-3 font-medium">项目</th><th className="px-3 py-3 font-medium">客户</th><th className="px-3 py-3 font-medium">项目负责人</th><th className="px-3 py-3 font-medium">地点</th><th className="px-3 py-3 font-medium">状态</th><th className="px-3 py-3 font-medium">合同开始执行</th><th className="px-3 py-3 font-medium">最新 SOW 服务截止</th><th className="px-3 py-3 font-medium">延期天数</th><th className="px-3 py-3 font-medium">操作</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((row, index) => <tr key={`${row.projectId}-${index}`} className="hover:bg-muted/30"><td className="px-3 py-3 font-medium">{row.projectName || "—"}</td><td className="px-3 py-3">{row.customerName || "—"}</td><td className="px-3 py-3">{row.owner || "未设置"}</td><td className="px-3 py-3">{row.office || "未设置"}</td><td className="px-3 py-3"><StatusPill value={row.status} /></td><td className="px-3 py-3 whitespace-nowrap">{row.plannedStartDate || "—"}</td><td className="px-3 py-3 whitespace-nowrap">{row.plannedDate || "—"}</td><td className={`px-3 py-3 tabular-nums ${(row.delayDays || 0) > 0 ? "font-medium text-red-600" : "text-muted-foreground"}`}>{(row.delayDays || 0) > 0 ? `${row.delayDays} 天` : "—"}</td><td className="px-3 py-3"><ProjectLink projectId={row.projectId} /></td></tr>)}</tbody>
      </table>
    </div>
  )
}

export function ProjectDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<ProjectReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null)
  const [problemResponder, setProblemResponder] = useState("all")
  const [problemReviewer, setProblemReviewer] = useState("all")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchProjectDashboard())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载项目看板失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const problemRows = data?.drilldowns?.["quality:issues"] || []
  const responders = [...new Set(problemRows.map((row) => row.responder).filter(Boolean) as string[])]
  const reviewers = [...new Set(problemRows.map((row) => row.reviewer).filter((value) => value && value !== "未审核") as string[])]
  const filteredProblems = problemRows.filter((row) => (problemResponder === "all" || row.responder === problemResponder) && (problemReviewer === "all" || row.reviewer === problemReviewer))
  const drilldownRows = drilldown ? (drilldown.title === "筛选后的问题明细" ? filteredProblems : data?.drilldowns?.[drilldown.key] || []) : []

  function openDrilldown(key: string, title: string, description: string, kind: ProjectDashboardDrilldownRow["rowType"]) {
    setDrilldown({ key, title, description, kind })
  }

  async function generate(period: "week" | "month") {
    setReportLoading(true)
    try {
      setReport(await fetchProjectReport(period))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成报告失败")
    } finally {
      setReportLoading(false)
    }
  }

  if (loading) return <div className="rounded-2xl border border-border bg-card py-20 text-center text-sm text-muted-foreground">正在汇总项目经营数据…</div>
  if (!data) return <div className="rounded-2xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">暂无项目看板数据</div>

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex sm:items-end sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
        <div>
          <p className="text-[11px] font-medium text-primary">项目管理</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">项目交付经营看板</h2>
          <p className="mt-2 text-sm text-muted-foreground">聚焦项目进度、团队负载、客户分层与问题风险；回款信息统一前往“回款管理”查看。数据更新于 {data.generatedAt || "刚刚"}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
          <Button variant="outline" size="sm" onClick={() => void generate("week")} disabled={reportLoading}><FileText className="mr-1.5 size-4 text-primary" />生成周报</Button>
          <Button variant="outline" size="sm" onClick={() => void generate("month")} disabled={reportLoading}><FileText className="mr-1.5 size-4 text-primary" />生成月报</Button>
          <Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 size-4" />刷新</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="项目总数" value={data.total} hint="当前可见全部项目" onClick={() => openDrilldown("projects:total", "全部项目明细", "当前账号权限范围内的全部项目。", "project")} />
        <MetricCard label="待开启项目" value={data.pendingStart} hint="按合同开始执行时间" onClick={() => openDrilldown("projects:pendingStart", "待开启项目明细", "合同开始执行时间已明确、当前阶段为待启动的项目。", "project")} />
        <MetricCard label="执行中项目" value={data.inTransit} hint="当前正在交付" onClick={() => openDrilldown("projects:inTransit", "执行中项目明细", "当前处于执行阶段、尚未完结的项目。", "project")} />
        <MetricCard label="已完结" value={data.completed} tone="success" hint="已完成交付" onClick={() => openDrilldown("projects:completed", "已完结项目明细", "当前状态为“已完成”的项目。", "project")} />
        <MetricCard label="延期项目" value={data.delayed} tone="danger" hint={`延期率 ${data.delayRate}%`} onClick={() => openDrilldown("projects:delayed", "延期项目明细", "实际或当前计划交付时间超过原计划的项目。", "project")} />
        <MetricCard label="高风险项目" value={data.highRiskProjects} tone="warning" hint="需优先处理" onClick={() => openDrilldown("projects:highRisk", "高风险项目明细", "风险等级为“高”的项目。", "project")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2"><Users className="size-4 text-primary" /><div><h3 className="text-sm font-medium">交付团队分布</h3><p className="text-xs text-muted-foreground">北京 A/B/C 三组与厦门团队，展开到个人项目数</p></div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["北京", "厦门"].map((office) => <div key={office} className="rounded-xl border border-border p-3"><button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium" onClick={() => openDrilldown(`office:${office}`, `${office}项目明细`, `交付地点归属“${office}”的项目。`, "project")}><span>{office} · {data.officeDistribution[office] || 0} 个项目</span><ChevronRight className="size-4 text-muted-foreground" /></button><div className="mt-3 space-y-3">{[...new Set(data.teamMemberDistribution.filter((item) => item.office === office).map((item) => item.team))].map((team) => <div key={team}><p className="mb-1 text-xs font-medium text-muted-foreground">{team}</p>{data.teamMemberDistribution.filter((item) => item.office === office && item.team === team).map((item) => <div key={`${team}-${item.member}`} className="flex justify-between py-1 text-sm"><span>{item.member}</span><span className="font-medium tabular-nums">{item.count} 个</span></div>)}</div>)}</div></div>)}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" /><div><h3 className="text-sm font-medium">问题看板</h3><p className="text-xs text-muted-foreground">按回复人、审核人筛选，Leader 回答单独统计</p></div></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[{label:"问题总数",value:data.issueTotal},{label:"已解决",value:data.issueResolved},{label:"未解决",value:data.openIssues},{label:"Leader 回答",value:data.leaderAnsweredCount}].map((item) => <button type="button" key={item.label} onClick={() => openDrilldown("quality:issues", "项目问题明细", "可查看问题类型、回复人、审核人和解决结果。", "workItem")} className="rounded-xl border border-border bg-muted/25 p-3 text-left"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-xl font-semibold">{item.value}</p></button>)}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><SearchableSelect value={problemResponder} onChange={setProblemResponder} options={[{value:"all",label:"全部回复人"},...responders.map((value)=>({value,label:value}))]} placeholder="回复人" /><SearchableSelect value={problemReviewer} onChange={setProblemReviewer} options={[{value:"all",label:"全部审核人"},...reviewers.map((value)=>({value,label:value}))]} placeholder="审核人" /></div>
          <button type="button" onClick={() => setDrilldown({key:"quality:issues",title:"筛选后的问题明细",description:`当前筛选共 ${filteredProblems.length} 条`,kind:"workItem"})} className="mt-3 flex w-full items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm"><span>筛选结果</span><span className="font-semibold">{filteredProblems.length} 条 <ChevronRight className="inline size-4" /></span></button>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>问题解决率 {data.issueResolutionRate}% · 逾期 {data.overdueIssues}</span><button type="button" className="text-primary" onClick={() => openDrilldown("quality:appeasements", "客户安抚记录明细", "全部客户安抚记录。", "workItem")}><HeartHandshake className="mr-1 inline size-3.5" />安抚 {data.appeasementCount} 次</button></div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2"><FolderKanban className="size-4 text-primary" /><div><h3 className="text-sm font-medium">客户级别分层</h3><p className="text-xs text-muted-foreground">交付项目统一按 P0 / P1 / P2 分层管理</p></div></div>
          <div className="grid grid-cols-3 gap-3">{["P0","P1","P2"].map((level,index) => <button type="button" key={level} onClick={() => openDrilldown(`level:${level}`, `${level} 项目明细`, `客户级别为 ${level} 的项目。`, "project")} className={`rounded-xl border p-4 text-left ${index===0?"border-red-200 bg-red-50/60":index===1?"border-amber-200 bg-amber-50/60":"border-blue-200 bg-blue-50/60"}`}><p className="text-sm font-medium">{level} 项目</p><p className="mt-2 text-2xl font-semibold">{data.customerLevelDistribution[level] || 0}</p></button>)}</div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" /><h3 className="text-sm font-medium">项目卡点 TOP 5</h3></div>
          {data.topBlockers.length ? <div className="space-y-3">{data.topBlockers.map((item, index) => {
            const max = data.topBlockers[0]?.count || 1
            return <button type="button" onClick={() => openDrilldown(`blocker:${item.name}`, `${item.name} · 卡点明细`, "当前仍未解决、归类到该卡点的问题。", "workItem")} key={`${item.name}-${index}`} className="group block w-full rounded-xl p-2 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="mb-1 flex items-center justify-between text-sm"><span className="flex min-w-0 items-center truncate"><span className="mr-2 text-xs text-muted-foreground">{index + 1}</span>{item.name}<ChevronRight className="ml-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" /></span><span className="ml-3 font-medium">{item.count}</span></div><Progress value={(item.count * 100) / max} tone="bg-amber-500" /></button>
          })}</div> : <p className="py-12 text-center text-sm text-muted-foreground">暂无未解决项目卡点</p>}
        </section>
      </div>

      <Dialog open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)}>
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-6xl">
          <DialogHeader><DialogTitle>{drilldown?.title}</DialogTitle><DialogDescription>{drilldown?.description} 共 {drilldownRows.length} 条，可继续进入项目详情。</DialogDescription></DialogHeader>
          {drilldown ? <DrilldownTable rows={drilldownRows} kind={drilldown.kind} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(report)} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{report?.title}</DialogTitle><DialogDescription>按当前项目、问题与回款数据自动生成，可复制后补充经营判断。</DialogDescription></DialogHeader>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 font-sans text-sm leading-7">{report?.content}</pre>
          <div className="flex justify-end"><Button onClick={async () => { await navigator.clipboard.writeText(report?.content || ""); toast.success("报告已复制") }}><Copy className="mr-1.5 size-4" />复制报告</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
