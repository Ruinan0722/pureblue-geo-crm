"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarClock, MessageSquarePlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { DatePicker } from "@/shared/ui/date-picker"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Textarea } from "@/shared/ui/textarea"
import { FollowUpComposer, FollowUpRecords } from "@/modules/crm/components/follow-up-panel"
import { Pill } from "@/modules/crm/components/ui"
import type { ProjectNote, ProjectRecord, ProjectWorkItem } from "@/modules/projects/lib/types"
import {
  createProjectWorkItem,
  fetchProjectNotes,
  fetchProjectPaymentSummary,
  fetchProjectWorkItems,
} from "@/modules/projects/services/projects-api"

type ActivityKind = "communication" | "risk" | "change" | "payment" | "delivery" | "system"
type Activity = { id: string; date: string; author: string; kind: ActivityKind; label: string; content: string; conversationEnabled: boolean }

const FOLLOW_METHODS = ["线上沟通", "线下拜访"].map((value) => ({ value, label: value }))
const KIND_LABEL: Record<string, { label: string; kind: ActivityKind }> = {
  follow_up: { label: "新增客户跟进", kind: "communication" },
  appeasement: { label: "客户安抚", kind: "communication" },
  risk: { label: "新增项目风险", kind: "risk" },
  delay: { label: "项目延期", kind: "risk" },
  change: { label: "需求变更", kind: "change" },
  delivery: { label: "交付记录", kind: "delivery" },
  issue: { label: "问题池记录", kind: "system" },
  help: { label: "登记疑难问题", kind: "system" },
  task: { label: "项目事项", kind: "system" },
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function itemToActivity(item: ProjectWorkItem): Activity {
  const meta = KIND_LABEL[item.kind] || { label: "项目记录", kind: "system" as const }
  const contact = textValue(item.data?.contactName) || textValue(item.data?.contact)
  const method = textValue(item.data?.method)
  const deliveryType = item.kind === "delivery" && item.data?.deliveryType === "settlement_materials" ? "结算材料" : ""
  const suffix = [contact, method === "online" ? "线上沟通" : method === "offline" ? "线下拜访" : method, deliveryType].filter(Boolean).join(" · ")
  return {
    id: item.id,
    date: item.occurredAt || item.createdAt,
    author: item.createdBy || item.owner || "系统",
    kind: meta.kind,
    label: meta.label,
    content: `${item.description || item.title}${suffix ? `（${suffix}）` : ""}`,
    conversationEnabled: item.kind === "follow_up",
  }
}

function noteToActivity(note: ProjectNote): Activity {
  const kind: ActivityKind = note.kind === "risk" ? "risk" : note.kind === "communication" ? "communication" : "system"
  return { id: `note-${note.id}`, date: note.createdAt, author: note.createdBy || "系统", kind, label: "项目记录", content: note.content, conversationEnabled: false }
}

export function ProjectActivityPanel({ project, writable }: { project: ProjectRecord; writable: boolean }) {
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [items, setItems] = useState<ProjectWorkItem[]>([])
  const [payments, setPayments] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ActivityKind | "all">("all")
  const [method, setMethod] = useState("线上沟通")
  const [contactName, setContactName] = useState("")
  const [nextFollowDate, setNextFollowDate] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectNotes, workItems, paymentSummary] = await Promise.all([
        fetchProjectNotes(project.id),
        fetchProjectWorkItems(project.id),
        fetchProjectPaymentSummary(project.id),
      ])
      setNotes(projectNotes)
      setItems(workItems)
      setPayments(paymentSummary.plans.filter((plan) => plan.actualAmount > 0 && plan.actualPaymentDate).map((plan) => ({
        id: `payment-${plan.id}`,
        date: `${plan.actualPaymentDate} 12:00:00`,
        author: "财务",
        kind: "payment" as const,
        label: "收到项目回款",
        content: `${plan.periodName || "本期"}回款 ¥${plan.actualAmount.toLocaleString("zh-CN")}`,
        conversationEnabled: false,
      })))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载项目动态失败")
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => { void load() }, [load])

  const activities = useMemo(() => {
    const created: Activity = {
      id: `project-${project.id}`,
      date: project.createdAt,
      author: project.createdBy || "系统",
      kind: "system",
      label: "创建项目",
      content: project.name,
      conversationEnabled: false,
    }
    const rows = [created, ...notes.map(noteToActivity), ...items.map(itemToActivity), ...payments]
      .sort((a, b) => b.date.localeCompare(a.date))
    return filter === "all" ? rows : rows.filter((row) => row.kind === filter)
  }, [filter, items, notes, payments, project])

  async function submitFollowUp() {
    if (!content.trim()) return toast.error("请填写跟进内容")
    setSaving(true)
    try {
      await createProjectWorkItem(project.id, {
        kind: "follow_up",
        title: "客户跟进",
        description: content.trim(),
        status: "recorded",
        data: { method, contactName: contactName.trim(), nextFollowDate },
      })
      setContent("")
      setNextFollowDate("")
      toast.success("跟进记录已保存，并写入项目动态")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存跟进失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5"><CalendarClock className="size-5 text-primary" /></div>
          <div><h3 className="text-sm font-semibold">项目动态与跟进记录</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">手动填写客户跟进；风险、变更、安抚、交付、问题处理和实际回款会自动回写到下方时间线，形成项目全周期档案。</p></div>
        </div>
        {writable ? (
          <FollowUpComposer footerLeft={nextFollowDate ? <Pill label={`下次跟进 ${nextFollowDate}`} tone="warning" /> : null} footerRight={<Button onClick={() => void submitFollowUp()} disabled={saving}><MessageSquarePlus className="mr-1.5 size-4" />{saving ? "保存中…" : "保存跟进"}</Button>}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1.5 text-xs font-medium"><span>跟进方式 *</span><SearchableSelect value={method} onChange={setMethod} options={FOLLOW_METHODS} placeholder="选择方式" /></label>
              <label className="space-y-1.5 text-xs font-medium"><span>联系人（支持自定义）</span><Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="填写联系人姓名或职位" /></label>
              <label className="space-y-1.5 text-xs font-medium"><span>下次跟进</span><DatePicker value={nextFollowDate} onChange={setNextFollowDate} placeholder="选择日期" /></label>
            </div>
            <Textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录沟通结果、客户反馈和下一步动作" />
          </FollowUpComposer>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">项目全周期时间线</h3><p className="mt-1 text-xs text-muted-foreground">按时间倒序，回答“什么时候、谁、做了什么”。</p></div><div className="flex flex-wrap gap-1.5">{(["all", "communication", "risk", "change", "payment", "delivery", "system"] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full border px-2.5 py-1 text-xs ${filter === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>{({ all: "全部", communication: "沟通", risk: "风险", change: "变更", payment: "回款", delivery: "交付", system: "其他" } as const)[value]}</button>)}</div></div>
        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">加载时间线中…</p> : <FollowUpRecords emptyText="暂无项目动态" records={activities.map((activity) => ({ id: activity.id, author: activity.author, date: activity.date, content: activity.content, pills: <Pill label={activity.label} tone={activity.kind === "risk" ? "danger" : activity.kind === "payment" ? "success" : activity.kind === "change" ? "warning" : "info"} />, conversationEnabled: activity.conversationEnabled }))} />}
      </div>
    </div>
  )
}
