"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { canDo } from "@/modules/auth/lib/permissions"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import type { PaymentPlan, PaymentStatus } from "@/modules/crm/lib/crm-data"
import { fetchPaymentPlans } from "@/modules/crm/services/crm-api"
import {
  PaymentPlanDialog,
  PaymentStatusBadge,
  SummaryCard,
  paymentMoney,
} from "@/modules/crm/components/payment-plan-tab"

type StatusFilter = "all" | PaymentStatus | "month_pending"

export function PaymentManagementPage() {
  const { user } = useRole()
  const canView = canDo(user?.permissions ?? [], "payments:view", "section:contracts")
  const [items, setItems] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PaymentPlan | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [status, setStatus] = useState<StatusFilter>("month_pending")
  const [owner, setOwner] = useState("all")
  const [keyword, setKeyword] = useState("")

  async function refresh() {
    setLoading(true)
    try {
      setItems(await fetchPaymentPlans())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载回款计划失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (canView) void refresh() }, [canView])

  const owners = useMemo(() => Array.from(new Set(items.map((item) => item.salesOwner || "").filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")), [items])
  const filtered = useMemo(() => {
    const now = new Date()
    const month = now.toISOString().slice(0, 7)
    const q = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (status === "month_pending") {
        if (!item.plannedDate.startsWith(month) || item.paymentStatus === "paid") return false
      } else if (status !== "all" && item.paymentStatus !== status) return false
      if (owner !== "all" && item.salesOwner !== owner) return false
      if (q && !`${item.contractCode} ${item.contractName} ${item.company}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, status, owner, keyword])

  const summary = useMemo(() => items.reduce((acc, item) => ({
    planned: acc.planned + item.plannedAmount,
    paid: acc.paid + item.actualAmount,
    outstanding: acc.outstanding + item.outstandingAmount,
    overdue: acc.overdue + (item.paymentStatus === "overdue" ? item.outstandingAmount : 0),
  }), { planned: 0, paid: 0, outstanding: 0, overdue: 0 }), [items])

  if (!canView) return <div className="p-8 text-sm text-muted-foreground">当前账号无权查看回款管理。</div>

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">回款管理</h1><p className="mt-1 text-sm text-muted-foreground">跨合同查看应收、已收和逾期回款，一行代表一期回款计划。</p></div>
        <Button variant="outline" className="gap-1.5" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-4" />刷新</Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="计划回款金额" value={paymentMoney(summary.planned)} />
        <SummaryCard label="已回款金额" value={paymentMoney(summary.paid)} tone="success" />
        <SummaryCard label="待回款金额" value={paymentMoney(summary.outstanding)} tone="warning" />
        <SummaryCard label="逾期金额" value={paymentMoney(summary.overdue)} tone="danger" />
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px]">
          <label className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索合同编号、名称或客户" /></label>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="month_pending">本月待回款</option><option value="all">全部状态</option><option value="pending">待回款</option><option value="partial">部分回款</option><option value="paid">已回款</option><option value="overdue">已逾期</option>
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">全部销售负责人</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </div>

        {loading ? <p className="py-12 text-center text-sm text-muted-foreground">加载中…</p> : filtered.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">没有符合条件的回款计划</p> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-3 py-2.5">合同编号 / 名称</th><th className="px-3 py-2.5">客户</th><th className="px-3 py-2.5">销售负责人</th><th className="px-3 py-2.5">收款周期</th><th className="px-3 py-2.5 text-right">计划金额</th><th className="px-3 py-2.5">计划时间</th><th className="px-3 py-2.5">发票状态</th><th className="px-3 py-2.5 text-right">实际收款</th><th className="px-3 py-2.5">实际时间</th><th className="px-3 py-2.5">回款状态</th><th className="px-3 py-2.5 text-right">操作</th></tr></thead>
              <tbody>{filtered.map((plan) => <tr key={plan.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30"><td className="px-3 py-3"><Link href={`/contracts/${plan.contractId}`} className="font-medium text-primary hover:underline">{plan.contractCode || "—"}</Link><p className="max-w-52 truncate text-xs text-muted-foreground">{plan.contractName || "—"}</p></td><td className="px-3 py-3">{plan.company || "—"}</td><td className="px-3 py-3">{plan.salesOwner || "—"}</td><td className="px-3 py-3 font-medium">{plan.periodName}</td><td className="px-3 py-3 text-right tabular-nums">{paymentMoney(plan.plannedAmount)}</td><td className="px-3 py-3">{plan.plannedDate}</td><td className="px-3 py-3">{plan.invoiceStatus === "invoiced" ? "已开票" : "未开票"}</td><td className="px-3 py-3 text-right tabular-nums">{paymentMoney(plan.actualAmount)}</td><td className="px-3 py-3">{plan.actualPaymentDate || "—"}</td><td className="px-3 py-3"><PaymentStatusBadge status={plan.paymentStatus} /></td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => { setSelected(plan); setDialogOpen(true) }}>查看 / 更新</Button></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <PaymentPlanDialog open={dialogOpen} onOpenChange={setDialogOpen} contractId={selected.contractId} plan={selected} onSaved={refresh} />}
    </div>
  )
}
