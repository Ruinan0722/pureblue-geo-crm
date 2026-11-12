"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText, Plus, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { AttachmentUploadDialog, type AttachmentUploadResult } from "@/modules/crm/components/attachment-upload-dialog"
import { canDo } from "@/modules/auth/lib/permissions"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import type { Contract, PaymentAttachment, PaymentPlan, PaymentStatus } from "@/modules/crm/lib/crm-data"
import {
  createPaymentPlan,
  deletePaymentPlan,
  fetchPaymentPlans,
  updatePaymentPlan,
  type PaymentPlanInput,
} from "@/modules/crm/services/crm-api"
import { cn } from "@/shared/lib/utils"

export function paymentMoney(value: number | null | undefined): string {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const STATUS_META: Record<PaymentStatus, { label: string; className: string }> = {
  pending: { label: "待回款", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  partial: { label: "部分回款", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  paid: { label: "已回款", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  overdue: { label: "已逾期", className: "bg-red-50 text-red-700 ring-red-200" },
}

const PAYMENT_PERIOD_OPTIONS = [
  "一期", "二期", "三期", "四期", "五期", "六期",
  "七期", "八期", "九期", "十期", "十一期", "十二期",
] as const
type PaymentPeriodName = typeof PAYMENT_PERIOD_OPTIONS[number]

function periodNameForIndex(index: number) {
  return PAYMENT_PERIOD_OPTIONS[Math.min(Math.max(index, 1), PAYMENT_PERIOD_OPTIONS.length) - 1] ?? PAYMENT_PERIOD_OPTIONS[0]
}

function normalizePeriodName(value: string, fallbackIndex: number): PaymentPeriodName {
  const trimmed = value.trim()
  if ((PAYMENT_PERIOD_OPTIONS as readonly string[]).includes(trimmed)) return trimmed as PaymentPeriodName
  const numeric = trimmed.match(/(?:第\s*)?(\d{1,2})\s*期?$/)?.[1]
  const parsed = numeric ? Number(numeric) : 0
  return parsed >= 1 && parsed <= PAYMENT_PERIOD_OPTIONS.length ? periodNameForIndex(parsed) : periodNameForIndex(fallbackIndex)
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", meta.className)}>{meta.label}</span>
}

function attachmentFromUpload(file: AttachmentUploadResult): PaymentAttachment {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    url: file.url,
    contentType: file.contentType,
    storagePath: file.storagePath,
    description: file.description,
  }
}

function defaultPeriodName(index: number) {
  return periodNameForIndex(index)
}

export function PaymentPlanDialog({
  open,
  onOpenChange,
  contractId,
  plan,
  nextIndex = 1,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  plan?: PaymentPlan | null
  nextIndex?: number
  onSaved: () => Promise<void> | void
}) {
  const { user } = useRole()
  const permissions = user?.permissions ?? []
  const canPlan = canDo(permissions, "payments:plan_manage", "contracts:write") || canDo(permissions, "contracts:sign")
  const canFinance = canDo(permissions, "payments:finance_edit") || canDo(permissions, "section:settings")
  const [submitting, setSubmitting] = useState(false)
  const [uploadKind, setUploadKind] = useState<"invoice" | "receipt" | null>(null)
  const [form, setForm] = useState({
    periodIndex: Math.min(Math.max(nextIndex, 1), PAYMENT_PERIOD_OPTIONS.length),
    periodName: defaultPeriodName(nextIndex),
    plannedAmount: "",
    plannedDate: "",
    invoiceStatus: "uninvoiced" as "uninvoiced" | "invoiced",
    invoiceDate: "",
    invoiceAmount: "",
    invoiceAttachment: null as PaymentAttachment | null,
    actualPaymentDate: "",
    actualAmount: "",
    receiptAttachment: null as PaymentAttachment | null,
  })

  useEffect(() => {
    if (!open) return
    setForm({
      periodIndex: Math.min(Math.max(plan?.periodIndex ?? nextIndex, 1), PAYMENT_PERIOD_OPTIONS.length),
      periodName: normalizePeriodName(plan?.periodName ?? "", plan?.periodIndex ?? nextIndex),
      plannedAmount: plan ? String(plan.plannedAmount) : "",
      plannedDate: plan?.plannedDate ?? "",
      invoiceStatus: plan?.invoiceStatus ?? "uninvoiced",
      invoiceDate: plan?.invoiceDate ?? "",
      invoiceAmount: plan?.invoiceAmount == null ? "" : String(plan.invoiceAmount),
      invoiceAttachment: plan?.invoiceAttachment ?? null,
      actualPaymentDate: plan?.actualPaymentDate ?? "",
      actualAmount: plan ? String(plan.actualAmount || "") : "",
      receiptAttachment: plan?.receiptAttachment ?? null,
    })
  }, [open, plan, nextIndex])

  async function submit() {
    if (!plan && !canPlan) return
    if (canPlan && (!form.periodName.trim() || !form.plannedAmount || !form.plannedDate)) {
      toast.error("请完整填写收款周期、计划金额和计划时间")
      return
    }
    const input: PaymentPlanInput = {}
    if (canPlan) {
      Object.assign(input, {
        periodIndex: Number(form.periodIndex),
        periodName: form.periodName.trim(),
        plannedAmount: Number(form.plannedAmount),
        plannedDate: form.plannedDate,
      })
    }
    if (canFinance) {
      Object.assign(input, {
        invoiceStatus: form.invoiceStatus,
        invoiceDate: form.invoiceDate || null,
        invoiceAmount: form.invoiceAmount === "" ? null : Number(form.invoiceAmount),
        invoiceAttachment: form.invoiceAttachment,
        actualPaymentDate: form.actualPaymentDate || null,
        actualAmount: form.actualAmount === "" ? 0 : Number(form.actualAmount),
        receiptAttachment: form.receiptAttachment,
      })
    }
    setSubmitting(true)
    try {
      if (plan) await updatePaymentPlan(plan.id, input)
      else await createPaymentPlan(contractId, input)
      await onSaved()
      onOpenChange(false)
      toast.success(plan ? "回款计划已更新" : "回款计划已新增")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function remove() {
    if (!plan || !canPlan || !window.confirm(`确认删除「${plan.periodName}」回款计划？`)) return
    setSubmitting(true)
    try {
      await deletePaymentPlan(plan.id)
      await onSaved()
      onOpenChange(false)
      toast.success("回款计划已删除")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUploaded(items: AttachmentUploadResult[]) {
    const item = items[0]
    if (!item || !uploadKind) return
    const attachment = attachmentFromUpload(item)
    setForm((current) => uploadKind === "invoice"
      ? { ...current, invoiceAttachment: attachment }
      : { ...current, receiptAttachment: attachment })
  }

  const readonly = !canPlan && !canFinance
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{plan ? `${plan.periodName}回款信息` : "新增回款计划"}</DialogTitle>
            <DialogDescription>回款状态与未收金额由系统根据计划时间和到账金额自动计算。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="1. 收款周期" required>
              <select
                disabled={!canPlan}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.periodName}
                onChange={(e) => {
                  const periodName = e.target.value as PaymentPeriodName
                  setForm({ ...form, periodName, periodIndex: PAYMENT_PERIOD_OPTIONS.indexOf(periodName as typeof PAYMENT_PERIOD_OPTIONS[number]) + 1 })
                }}
              >
                {PAYMENT_PERIOD_OPTIONS.map((periodName) => <option key={periodName} value={periodName}>{periodName}</option>)}
              </select>
            </Field>
            <Field label="2. 计划收款金额" required>
              <Input disabled={!canPlan} type="number" min={0} step="0.01" value={form.plannedAmount} onChange={(e) => setForm({ ...form, plannedAmount: e.target.value })} />
            </Field>
            <Field label="3. 计划收款时间" required>
              <Input disabled={!canPlan} type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
            </Field>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">开票信息</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="4. 发票状态">
                <select disabled={!canFinance} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.invoiceStatus} onChange={(e) => setForm({ ...form, invoiceStatus: e.target.value as "uninvoiced" | "invoiced" })}>
                  <option value="uninvoiced">未开票</option>
                  <option value="invoiced">已开票</option>
                </select>
              </Field>
              <Field label="5. 开票时间"><Input disabled={!canFinance} type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} /></Field>
              <Field label="6. 开票金额"><Input disabled={!canFinance} type="number" min={0} step="0.01" value={form.invoiceAmount} onChange={(e) => setForm({ ...form, invoiceAmount: e.target.value })} /></Field>
            </div>
            <AttachmentField label="7. 发票附件" attachment={form.invoiceAttachment} editable={canFinance} onUpload={() => setUploadKind("invoice")} onClear={() => setForm({ ...form, invoiceAttachment: null })} />
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">到账信息</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="8. 已收款时间"><Input disabled={!canFinance} type="date" value={form.actualPaymentDate} onChange={(e) => setForm({ ...form, actualPaymentDate: e.target.value })} /></Field>
              <Field label="9. 已收款金额"><Input disabled={!canFinance} type="number" min={0} step="0.01" value={form.actualAmount} onChange={(e) => setForm({ ...form, actualAmount: e.target.value })} /></Field>
            </div>
            <AttachmentField label="10. 回单附件" attachment={form.receiptAttachment} editable={canFinance} onUpload={() => setUploadKind("receipt")} onClear={() => setForm({ ...form, receiptAttachment: null })} />
          </div>

          <DialogFooter className="sm:justify-between">
            <div>{plan && canPlan ? <Button type="button" variant="destructive" className="gap-1.5" onClick={() => void remove()} disabled={submitting}><Trash2 className="size-4" />删除本期</Button> : null}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
              {!readonly && <Button type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? "保存中…" : "保存"}</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AttachmentUploadDialog
        open={Boolean(uploadKind)}
        onOpenChange={(next) => { if (!next) setUploadKind(null) }}
        title={uploadKind === "invoice" ? "上传发票附件" : "上传回单附件"}
        description="上传完成后请点击回款信息弹窗中的“保存”。"
        onUploaded={handleUploaded}
      />
    </>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</span>{children}</label>
}

function AttachmentField({ label, attachment, editable, onUpload, onClear }: { label: string; attachment: PaymentAttachment | null; editable: boolean; onUpload: () => void; onClear: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
      <FileText className="size-4 text-muted-foreground" />
      {attachment ? <a href={attachment.url || "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">{attachment.name}</a> : <span className="flex-1 text-muted-foreground">{label}：未上传</span>}
      {editable && <Button type="button" size="sm" variant="outline" className="gap-1" onClick={onUpload}><Upload className="size-3.5" />上传</Button>}
      {editable && attachment && <Button type="button" size="sm" variant="ghost" onClick={onClear}>移除</Button>}
    </div>
  )
}

export function ContractPaymentPlanTab({ contract }: { contract: Contract }) {
  const { user } = useRole()
  const canPlan = canDo(user?.permissions ?? [], "payments:plan_manage", "contracts:write") || canDo(user?.permissions ?? [], "contracts:sign")
  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PaymentPlan | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  async function refresh() {
    const items = await fetchPaymentPlans(contract.id)
    setPlans(items)
  }
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPaymentPlans(contract.id).then((items) => { if (!cancelled) setPlans(items) }).catch((error) => toast.error(error instanceof Error ? error.message : "加载回款计划失败")).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [contract.id])

  const summary = useMemo(() => plans.reduce((acc, item) => ({ planned: acc.planned + item.plannedAmount, paid: acc.paid + item.actualAmount, outstanding: acc.outstanding + item.outstandingAmount }), { planned: 0, paid: 0, outstanding: 0 }), [plans])
  const nextIndex = plans.reduce((max, item) => Math.max(max, item.periodIndex), 0) + 1
  const balanced = Math.abs(summary.planned - Number(contract.amount || 0)) < 0.01

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="合同金额" value={paymentMoney(contract.amount)} />
        <SummaryCard label="已回款" value={paymentMoney(summary.paid)} tone="success" />
        <SummaryCard label="待回款" value={paymentMoney(summary.outstanding)} tone="warning" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">回款计划</h2><p className="mt-1 text-xs text-muted-foreground">计划合计 {paymentMoney(summary.planned)} · {plans.length ? (balanced ? "与合同金额一致" : "与合同金额不一致，请核对") : "尚未创建计划"}</p></div>
          {canPlan && <Button className="gap-1.5" disabled={plans.length >= PAYMENT_PERIOD_OPTIONS.length} onClick={() => { setSelected(null); setDialogOpen(true) }}><Plus className="size-4" />{plans.length >= PAYMENT_PERIOD_OPTIONS.length ? "已达 12 期" : "新增回款期"}</Button>}
        </div>
        <PaymentTable plans={plans} loading={loading} onOpen={(plan) => { setSelected(plan); setDialogOpen(true) }} />
      </div>
      <PaymentPlanDialog open={dialogOpen} onOpenChange={setDialogOpen} contractId={contract.id} plan={selected} nextIndex={nextIndex} onSaved={refresh} />
    </div>
  )
}

export function PaymentTable({ plans, loading, onOpen, showContract = false }: { plans: PaymentPlan[]; loading?: boolean; onOpen: (plan: PaymentPlan) => void; showContract?: boolean }) {
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
  if (!plans.length) return <p className="py-8 text-center text-sm text-muted-foreground">暂无回款计划</p>
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground"><tr>{showContract && <th className="px-3 py-2.5">合同 / 客户</th>}<th className="px-3 py-2.5">收款周期</th><th className="px-3 py-2.5 text-right">计划金额</th><th className="px-3 py-2.5">计划时间</th><th className="px-3 py-2.5">发票状态</th><th className="px-3 py-2.5 text-right">实际收款</th><th className="px-3 py-2.5">实际时间</th><th className="px-3 py-2.5">回款状态</th><th className="px-3 py-2.5 text-right">操作</th></tr></thead>
        <tbody>{plans.map((plan) => <tr key={plan.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">{showContract && <td className="px-3 py-3"><p className="font-medium">{plan.contractCode || plan.contractName || "—"}</p><p className="text-xs text-muted-foreground">{plan.company || "—"}</p></td>}<td className="px-3 py-3 font-medium">{plan.periodName}</td><td className="px-3 py-3 text-right tabular-nums">{paymentMoney(plan.plannedAmount)}</td><td className="px-3 py-3">{plan.plannedDate || "—"}</td><td className="px-3 py-3">{plan.invoiceStatus === "invoiced" ? "已开票" : "未开票"}</td><td className="px-3 py-3 text-right tabular-nums">{paymentMoney(plan.actualAmount)}</td><td className="px-3 py-3">{plan.actualPaymentDate || "—"}</td><td className="px-3 py-3"><PaymentStatusBadge status={plan.paymentStatus} /></td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => onOpen(plan)}>查看 / 更新</Button></td></tr>)}</tbody>
      </table>
    </div>
  )
}

export function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }) {
  return <div className={cn("rounded-2xl border bg-card p-4", tone === "success" && "border-emerald-200 bg-emerald-50/60", tone === "warning" && "border-amber-200 bg-amber-50/60", tone === "danger" && "border-red-200 bg-red-50/60")}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>
}
