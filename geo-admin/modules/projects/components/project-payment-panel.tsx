"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleDollarSign, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Pill, EmptyState } from "@/modules/crm/components/ui"
import type { ProjectPaymentSummary } from "@/modules/projects/lib/types"
import { fetchProjectPaymentSummary } from "@/modules/projects/services/projects-api"

function money(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const PAYMENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  paid: { label: "已回款", tone: "success" }, partial: { label: "部分回款", tone: "warning" }, pending: { label: "待回款", tone: "neutral" }, overdue: { label: "已逾期", tone: "danger" },
}

export function ProjectPaymentPanel({ projectId, contractId }: { projectId: string; contractId: string }) {
  const [data, setData] = useState<ProjectPaymentSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void fetchProjectPaymentSummary(projectId).then((value) => active && setData(value)).catch((error) => toast.error(error instanceof Error ? error.message : "加载回款失败")).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [projectId])

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">加载回款数据中…</div>
  if (!data) return <EmptyState text="暂无回款数据" />

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5"><CircleDollarSign className="size-5 text-primary" /></div><div><h3 className="text-sm font-medium">合同回款（只读）</h3><p className="mt-0.5 text-xs text-muted-foreground">销售在项目中查看，财务仍在回款管理维护，避免两套数据不一致。</p></div></div>
        <Link href={`/contracts/${contractId}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">查看合同与回款计划<ExternalLink className="size-3.5" /></Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[{ label: "合同金额", value: data.contractAmount }, { label: "计划回款", value: data.plannedAmount }, { label: "已回款", value: data.paidAmount }, { label: "待回款", value: data.outstandingAmount }, { label: "逾期金额", value: data.overdueAmount }].map((item) => <div key={item.label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{item.label}</p><p className={`mt-2 text-lg font-semibold tabular-nums ${item.label === "逾期金额" && item.value > 0 ? "text-red-600" : ""}`}>{money(item.value)}</p></div>)}
      </div>
      {data.plans.length ? <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">收款周期</th><th className="px-4 py-3 font-medium">计划金额</th><th className="px-4 py-3 font-medium">计划时间</th><th className="px-4 py-3 font-medium">发票状态</th><th className="px-4 py-3 font-medium">已收金额</th><th className="px-4 py-3 font-medium">实际时间</th><th className="px-4 py-3 font-medium">未收金额</th><th className="px-4 py-3 font-medium">状态</th></tr></thead><tbody className="divide-y divide-border">{data.plans.map((plan) => { const meta = PAYMENT_STATUS[plan.paymentStatus] || PAYMENT_STATUS.pending; return <tr key={plan.id}><td className="px-4 py-3 font-medium">{plan.periodName || "—"}</td><td className="px-4 py-3 tabular-nums">{money(plan.plannedAmount)}</td><td className="px-4 py-3">{plan.plannedDate || "—"}</td><td className="px-4 py-3">{plan.invoiceStatus === "invoiced" ? "已开票" : "未开票"}</td><td className="px-4 py-3 tabular-nums">{money(plan.actualAmount)}</td><td className="px-4 py-3">{plan.actualPaymentDate || "—"}</td><td className="px-4 py-3 tabular-nums">{money(plan.outstandingAmount)}</td><td className="px-4 py-3"><Pill label={meta.label} tone={meta.tone} /></td></tr> })}</tbody></table></div></div> : <div className="rounded-2xl border border-dashed border-border bg-card py-12"><EmptyState text="该合同还没有回款计划" /></div>}
    </div>
  )
}
