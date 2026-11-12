"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, FileClock, FileUp, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Checkbox } from "@/shared/ui/checkbox"
import { DatePicker } from "@/shared/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Textarea } from "@/shared/ui/textarea"
import { EmptyState, Pill } from "@/modules/crm/components/ui"
import { PROJECT_PLATFORM_OPTIONS, PROJECT_TYPE_OPTIONS } from "@/modules/projects/lib/labels"
import type { CreateProjectSowVersionInput, ProjectAttachment, ProjectSowClause, ProjectSowVersion, ProjectSowVersions } from "@/modules/projects/lib/types"
import { createProjectSowVersion, fetchProjectSowVersions, uploadProjectAttachments } from "@/modules/projects/services/projects-api"

const CHANGE_TYPES = ["客户需求变更", "内部方案调整", "SOW 交付范围调整", "KPI / 验收标准调整"].map((value) => ({ value, label: value }))

function listText(values: string[]) {
  return values.length ? values.join("、") : "未设置"
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm font-medium">{value || "未设置"}</p></div>
}

function snapshot(version: ProjectSowVersion): CreateProjectSowVersionInput {
  return {
    sowEndDate: version.sowEndDate,
    projectTypes: [...version.projectTypes],
    platforms: [...version.platforms],
    optimizationIntentCount: version.optimizationIntentCount,
    optimizationTarget: version.optimizationTarget,
    acceptanceCriteria: version.acceptanceCriteria,
    clauses: version.clauses.map((item) => ({ ...item })),
    changeType: "",
    changeReason: "",
    confirmer: "",
    attachments: [],
  }
}

export function ProjectSowPanel({ projectId, writable, onPublished }: { projectId: string; writable: boolean; onPublished: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<ProjectSowVersions | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<CreateProjectSowVersionInput | null>(null)
  const [files, setFiles] = useState<File[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchProjectSowVersions(projectId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 SOW 版本失败")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const current = data?.current
  const oldVersions = useMemo(() => data?.items.filter((item) => !item.isCurrent) || [], [data])

  function beginChange() {
    if (!current) return
    setDraft(snapshot(current))
    setFiles([])
    setOpen(true)
  }

  function toggleList(key: "projectTypes" | "platforms", value: string, checked: boolean) {
    setDraft((item) => item ? { ...item, [key]: checked ? [...item[key], value] : item[key].filter((entry) => entry !== value) } : item)
  }

  function patchClause(index: number, patch: Partial<ProjectSowClause>) {
    setDraft((item) => item ? { ...item, clauses: item.clauses.map((clause, clauseIndex) => clauseIndex === index ? { ...clause, ...patch } : clause) } : item)
  }

  function chooseFiles(list: FileList | null) {
    const selected = Array.from(list || [])
    const invalid = selected.find((file) => !file.name.toLowerCase().endsWith(".pdf") || !["application/pdf", ""].includes(file.type))
    if (invalid) return toast.error(`「${invalid.name}」不是 PDF 文件`)
    const tooLarge = selected.find((file) => file.size > 25 * 1024 * 1024)
    if (tooLarge) return toast.error(`「${tooLarge.name}」超过 25MB 限制`)
    setFiles(selected)
  }

  async function publish() {
    if (!draft) return
    if (!draft.sowEndDate) return toast.error("请选择新的 SOW 截止时间")
    if (!draft.changeType.trim()) return toast.error("请选择变更类型")
    if (!draft.changeReason.trim()) return toast.error("请填写本次变更原因")
    if (!draft.confirmer.trim()) return toast.error("请填写确认人")
    setSaving(true)
    try {
      const attachments: ProjectAttachment[] = files.length ? await uploadProjectAttachments(projectId, files) : []
      const next = await createProjectSowVersion(projectId, { ...draft, attachments })
      setData(next)
      setOpen(false)
      await onPublished()
      window.dispatchEvent(new CustomEvent("project-work-items-changed", { detail: { projectId } }))
      toast.success(`变更已确认，SOW V${next.current.versionNo} 已成为最新执行依据`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布 SOW 新版本失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">加载 SOW 中…</div>
  if (!current) return <div className="rounded-2xl border border-dashed border-border bg-card py-12"><EmptyState text="暂无 SOW 数据" /></div>

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-background">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2.5 dark:bg-blue-900/50"><FileClock className="size-5 text-blue-700 dark:text-blue-300" /></div>
            <div><p className="text-sm font-semibold">需求变更与 SOW 版本</p><p className="mt-1 text-xs leading-5 text-muted-foreground">这里仅负责查看销售回传的变更结果：新版本作为执行依据，旧版本永久保留，避免项目团队使用错版本。</p></div>
          </div>
          {writable ? <Button size="sm" onClick={beginChange}><Plus className="mr-1.5 size-4" />发起需求变更</Button> : null}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[{no:"1",title:"销售提出变更",text:"客户需求或 SOW 内容发生变化"},{no:"2",title:"系统生成新版本",text:"完整保留变更前后的方案"},{no:"3",title:"项目按新 SOW 执行",text:`当前生效版本为 V${current.versionNo}`}].map((step)=><div key={step.no} className="flex items-start gap-2 rounded-xl border border-blue-100 bg-white/70 p-3 dark:border-blue-900/40 dark:bg-background/60"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{step.no}</span><div><p className="text-xs font-medium">{step.title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{step.text}</p></div></div>)}
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">当前执行版本</h3><p className="mt-1 text-xs text-muted-foreground">项目交付以本卡片内容为准</p></div><div className="flex items-center gap-2"><Pill label={`SOW V${current.versionNo}`} tone="info" /><Pill label="已生效" tone="success" /></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryItem label="最新 SOW 服务截止" value={current.sowEndDate || "未设置"} />
          <SummaryItem label="优化意图数量" value={current.optimizationIntentCount} />
          <SummaryItem label="项目类型" value={listText(current.projectTypes)} />
          <SummaryItem label="覆盖平台" value={listText(current.platforms)} />
          <SummaryItem label="优化目标 / KPI" value={current.optimizationTarget || "未设置"} />
          <SummaryItem label="验收标准" value={current.acceptanceCriteria || "未设置"} />
        </div>
        {current.clauses.length ? <div className="mt-4 space-y-2"><p className="text-sm font-medium">其他 SOW 细则</p>{current.clauses.map((clause, index) => <div key={`${clause.title}-${index}`} className="rounded-xl border border-border px-4 py-3"><p className="text-sm font-medium">{clause.title || `细则 ${index + 1}`}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{clause.content || "—"}</p></div>)}</div> : null}
        <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">生效人：{current.createdBy || "系统"}　生效时间：{current.createdAt || "—"}{current.confirmer ? `　客户确认人：${current.confirmer}` : ""}</div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2"><FileClock className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">历史 SOW 版本（{oldVersions.length}）</h3></div>
        <p className="mt-1 text-xs text-muted-foreground">按版本展开查看原执行方案、变更原因和确认信息；历史版本只读，不会覆盖当前版本。</p>
        <div className="mt-4 space-y-2">
          {oldVersions.length === 0 ? <EmptyState text="暂无历史版本；首次变更后原 SOW 会自动保存为 V1" /> : oldVersions.map((version) => (
            <details key={version.id} className="group rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><div><span className="text-sm font-medium">SOW V{version.versionNo}</span><span className="ml-2 text-xs text-muted-foreground">截止 {version.sowEndDate || "未设置"} · {version.createdAt || "—"}</span></div><ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
              <div className="border-t border-border px-4 py-4"><p className="text-xs text-muted-foreground">变更/留档原因</p><p className="mt-1 text-sm">{version.changeReason || "—"}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><SummaryItem label="项目类型" value={listText(version.projectTypes)} /><SummaryItem label="覆盖平台" value={listText(version.platforms)} /><SummaryItem label="优化意图数量" value={version.optimizationIntentCount} /><SummaryItem label="优化目标 / KPI" value={version.optimizationTarget || "未设置"} /><SummaryItem label="验收标准" value={version.acceptanceCriteria || "未设置"} /></div>{version.clauses.map((clause, index) => <div key={`${clause.title}-${index}`} className="mt-2 rounded-lg bg-muted/40 p-3 text-sm"><span className="font-medium">{clause.title || `细则 ${index + 1}`}：</span>{clause.content || "—"}</div>)}</div>
            </details>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>发起需求变更</DialogTitle><DialogDescription>系统已复制当前 SOW 作为原方案。请选择变更类型并修改对应内容；确认后生成新版本、更新后续执行依据，同时保留原方案。</DialogDescription></DialogHeader>
          {draft ? <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm"><span className="text-muted-foreground">变更类型 *</span><SearchableSelect value={draft.changeType} onChange={(value) => setDraft({ ...draft, changeType: value })} options={CHANGE_TYPES} placeholder="选择客户需求、内部方案、SOW 或 KPI 变更" /></label><label className="space-y-1.5 text-sm"><span className="text-muted-foreground">确认人 *</span><Input value={draft.confirmer} onChange={(event) => setDraft({ ...draft, confirmer: event.target.value })} placeholder="填写确认本次变更的人" /></label></div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-xs leading-5 text-muted-foreground dark:border-blue-900/50 dark:bg-blue-950/20">原方案无需手工复制：系统将当前 SOW 完整快照作为“变更前方案”；下方修改后的内容作为“变更后方案”。申请人和变更时间由系统自动记录。</div>
            <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">SOW 截止时间 *</span><DatePicker value={draft.sowEndDate} onChange={(value) => setDraft({ ...draft, sowEndDate: value })} /></label>
            <fieldset><legend className="text-sm text-muted-foreground">项目类型</legend><div className="mt-2 flex flex-wrap gap-3">{PROJECT_TYPE_OPTIONS.map((value) => <label key={value} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Checkbox checked={draft.projectTypes.includes(value)} onCheckedChange={(checked) => toggleList("projectTypes", value, checked === true)} />{value}</label>)}</div></fieldset>
            <fieldset><legend className="text-sm text-muted-foreground">覆盖平台</legend><div className="mt-2 flex flex-wrap gap-3">{PROJECT_PLATFORM_OPTIONS.map((value) => <label key={value} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Checkbox checked={draft.platforms.includes(value)} onCheckedChange={(checked) => toggleList("platforms", value, checked === true)} />{value}</label>)}</div></fieldset>
            <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">优化意图数量</span><Input type="number" min={0} value={draft.optimizationIntentCount} onChange={(event) => setDraft({ ...draft, optimizationIntentCount: Math.max(0, Number(event.target.value || 0)) })} /></label>
            <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">优化目标 / KPI</span><Textarea rows={3} value={draft.optimizationTarget} onChange={(event) => setDraft({ ...draft, optimizationTarget: event.target.value })} /></label>
            <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">验收标准</span><Textarea rows={3} value={draft.acceptanceCriteria} onChange={(event) => setDraft({ ...draft, acceptanceCriteria: event.target.value })} /></label>
            <div><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">其他 SOW 细则</p><Button type="button" size="sm" variant="outline" onClick={() => setDraft({ ...draft, clauses: [...draft.clauses, { title: "", content: "" }] })}><Plus className="mr-1 size-3.5" />增加细则</Button></div><div className="mt-2 space-y-3">{draft.clauses.map((clause, index) => <div key={index} className="rounded-xl border border-border p-3"><div className="flex gap-2"><Input value={clause.title} onChange={(event) => patchClause(index, { title: event.target.value })} placeholder="细则名称，如：交付频次" /><Button type="button" size="icon" variant="ghost" className="shrink-0 text-red-600" onClick={() => setDraft({ ...draft, clauses: draft.clauses.filter((_, clauseIndex) => clauseIndex !== index) })}><Trash2 className="size-4" /><span className="sr-only">删除细则</span></Button></div><Textarea className="mt-2" rows={2} value={clause.content} onChange={(event) => patchClause(index, { content: event.target.value })} placeholder="填写该条 SOW 的完整约定" /></div>)}</div></div>
            <label className="block space-y-1.5 text-sm"><span className="text-muted-foreground">变更原因 *</span><Textarea rows={3} value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} placeholder="说明为什么调整，以及从什么时候开始按新方案执行" /></label>
            <div className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">相关附件</p><p className="mt-1 text-xs text-muted-foreground">可上传本次变更对应的 PDF，单个不超过 25MB。</p></div><input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple className="sr-only" onChange={(event) => chooseFiles(event.target.files)} /><Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><FileUp className="mr-1.5 size-4" />选择附件</Button></div>{files.length ? <div className="mt-3 flex flex-wrap gap-2">{files.map((file) => <span key={`${file.name}-${file.size}`} className="rounded-md bg-muted px-2.5 py-1.5 text-xs">{file.name}</span>)}</div> : <p className="mt-3 text-xs text-muted-foreground">未选择附件</p>}</div>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>取消</Button><Button onClick={() => void publish()} disabled={saving}>{saving ? "确认中…" : "确认变更并执行新方案"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
