"use client"

import { EntityAuditCount,EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import { useAuth } from "@/modules/auth"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import { AttachmentUploadDialog } from "@/modules/crm/components/attachment-upload-dialog"
import { FollowUpComposer,FollowUpRecords } from "@/modules/crm/components/follow-up-panel"
import { MentionTextarea } from "@/modules/crm/components/member-picker"
import { EmptyState } from "@/modules/crm/components/ui"
import { useMentionNames } from "@/modules/crm/hooks/use-directory-options"
import { fetchSalesColleagues } from "@/modules/crm/services/crm-directory"
import { GeoSourceBadge } from "@/modules/requests/components/geo-source-badge"
import { StatusBadge } from "@/modules/requests/components/status-badge"
import { exportMergedPdfFromTemplates } from "@/modules/requests/export/export-pdf-html"
import { formatRequestOwner } from "@/modules/requests/lib/format-owner"
import { resolveRequestGeoSource } from "@/modules/requests/lib/geo-source"
import { exportRequestsExcel,exportTimestamp } from "@/modules/requests/services/requests-api"
import { useSessionRestoredOpen } from "@/shared/hooks/use-form-draft"
import { Button } from "@/shared/ui/button"
import { DatePicker } from "@/shared/ui/date-picker"
import { Input } from "@/shared/ui/input"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/shared/ui/tabs"
import {
ArrowLeft,
ArrowRight,
Download,
GitBranch,
History,
Link2,
MessageSquarePlus,
Paperclip,
Pencil,
Upload,
UserRound
} from "lucide-react"
import Link from "next/link"
import { useEffect,useMemo,useState,type ReactNode } from "react"
import { toast } from "sonner"
import { useRequests } from "../context/requests-provider"
import { STATUS_ACTIONS,STATUS_META,type RequestStatus } from "../lib/status"
import { EditDialog } from "./edit-dialog"
import { RequestDetailContent } from "./request-detail-content"

const UNASSIGNED_OWNER = "未分配"
const STATUS_ORDER: RequestStatus[] = [
  "submitted",
  "pending_review",
  "confirmed",
  "in_project",
]
type RequestTab = "info" | "follow" | "files" | "history"

function WorkflowField({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof Link2
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[148px] flex-col rounded-xl border border-border bg-secondary/25 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border">
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-2">{children}</div>
      {hint ? <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function RequestDetail({ id }: { id: string }) {
  const { can, user } = useAuth()
  const canEdit = can("request:edit")
  const canExport = can("request:export")
  const canChangeStatus = can("request:change_status")
  const canAssignOwner = can("request:assign_owner")
  const canAddNote = can("request:add_note")
  const {
    getById,
    loading,
    loadRequestById,
    updateStatus,
    assignOwner,
    addNote,
    addAttachment,
    updateData,
  } = useRequests()
  const record = getById(id)
  const { names: staffNames } = useMentionNames("requests", record?.id)
  const [detailLoading, setDetailLoading] = useState(false)
  const [tab, setTab] = useState<RequestTab>("info")
  const [exporting, setExporting] = useState(false)
  const [note, setNote] = useState("")
  const [mentions, setMentions] = useState<string[]>([])
  const [submittingNote, setSubmittingNote] = useState(false)
  const [editOpen, setEditOpen] = useSessionRestoredOpen((key) => key.startsWith("request-edit:"))
  const [uploadOpen, setUploadOpen] = useState(false)
  const [salesColleagues, setSalesColleagues] = useState<string[]>([])
  const [salesColleaguesLoading, setSalesColleaguesLoading] = useState(false)
  const [salesDeptLabel, setSalesDeptLabel] = useState("销售部")
  const [solutionLink, setSolutionLink] = useState("")
  const [expectedSolutionDate, setExpectedSolutionDate] = useState("")

  useEffect(() => {
    if (loading) return
    let cancelled = false
    setDetailLoading(true)
    void loadRequestById(id)
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 仅随 id / 鉴权加载态变化拉取；勿依赖 getById（每次 provider 渲染都会变引用）
  }, [id, loading, loadRequestById])

  useEffect(() => {
    if (!record) return
    setSolutionLink(String(record.data.solutionLink || ""))
    setExpectedSolutionDate(String(record.data.expectedSolutionDate || ""))
  }, [record?.id, record?.data.solutionLink, record?.data.expectedSolutionDate])

  useEffect(() => {
    if (!canAssignOwner) return
    let cancelled = false
    setSalesColleaguesLoading(true)
    void fetchSalesColleagues()
      .then((result) => {
        if (cancelled) return
        setSalesColleagues(result.names)
        setSalesDeptLabel(result.departmentLabel)
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "加载销售部同事列表失败")
        }
      })
      .finally(() => {
        if (!cancelled) setSalesColleaguesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canAssignOwner])

  const ownerSelectOptions = useMemo(() => {
    const names = new Set(salesColleagues)
    const current = record?.owner
    if (current && current !== UNASSIGNED_OWNER && !names.has(current)) {
      names.add(current)
    }
    return [
      { value: UNASSIGNED_OWNER, label: UNASSIGNED_OWNER },
      ...Array.from(names)
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((name) => ({
          value: name,
          label:
            name === record?.owner
              ? formatRequestOwner(name, record.ownerEmploymentStatus)
              : name,
        })),
    ]
  }, [salesColleagues, record?.owner, record?.ownerEmploymentStatus])

  const ownerDisplay = formatRequestOwner(record?.owner, record?.ownerEmploymentStatus)
  const statusSelectOptions = useMemo(
    () => STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label })),
    [],
  )

  if (loading || detailLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    )
  }

  if (!record) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">未找到该需求记录，或无权查看</p>
        <Link href="/requests">
          <Button variant="outline">返回需求列表</Button>
        </Link>
      </div>
    )
  }

  const attachments = record.attachments ?? []
  const domesticRequest = resolveRequestGeoSource(record) === "domestic"
  const notesNewestFirst = [...record.notes].reverse()

  async function submitNote() {
    if (!note.trim()) {
      toast.error("请输入跟进内容")
      return
    }
    setSubmittingNote(true)
    try {
      await addNote(record!.id, note.trim(), { mentions })
      setNote("")
      setMentions([])
      setTab("follow")
      toast.success("跟进记录已添加")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加跟进失败")
    } finally {
      setSubmittingNote(false)
    }
  }

  async function saveSolutionDelivery() {
    const current = record
    if (!current) return
    try {
      await updateData(current.id, { ...current.data, solutionLink: solutionLink.trim(), expectedSolutionDate })
      toast.success("方案交付信息已保存")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存方案交付信息失败")
    }
  }

  function applyStatusChange(next: RequestStatus) {
    updateStatus(record!.id, next)
      .then(() => toast.success(`状态已更新为「${STATUS_META[next].label}」`))
      .catch((e) => toast.error(e instanceof Error ? e.message : "状态更新失败"))
  }

  async function handleAttachmentsUploaded(
    items: Array<{
      id: string
      name: string
      size: number
      url: string
      contentType?: string
      storagePath?: string
      description: string
    }>,
  ) {
    const author = user?.name || "当前用户"
    for (const file of items) {
      await addAttachment(record!.id, {
        id: file.id,
        name: file.name,
        size: file.size,
        url: file.url,
        contentType: file.contentType,
        storagePath: file.storagePath,
        description: file.description,
        uploadedBy: author,
      })
    }
    setTab("files")
    toast.success(`已上传 ${items.length} 个附件`)
  }

  async function handleExport() {
    if (!record) return
    setExporting(true)
    try {
      const excelName = await exportRequestsExcel([record.id])
      const pdfName = `需求导出-${exportTimestamp()}.pdf`
      const result = await exportMergedPdfFromTemplates([record], pdfName)
      if (!result.ok) throw new Error(result.error)
      toast.success("导出完成", {
        description: `已生成「${excelName}」与「${pdfName}」`,
      })
    } catch (err) {
      toast.error("导出失败", {
        description: err instanceof Error ? err.message : "请重试",
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 lg:px-8">
      <Link
        href="/requests"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        返回需求列表
      </Link>

      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {record.data.companyName || record.data.brandName || record.code}
              </h1>
              <GeoSourceBadge record={record} />
              <StatusBadge status={record.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[
                record.code,
                record.owner ? `跟进人：${ownerDisplay}` : null,
                record.submittedAt ? `提交：${record.submittedAt}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "需求详情"}
            </p>

          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end print:hidden">
            {canEdit && (
              <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                编辑信息
              </Button>
            )}
            {canExport && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => void handleExport()}
                disabled={exporting}
              >
                <Download className="size-4" />
                {exporting ? "导出中…" : "导出"}
              </Button>
            )}
          </div>
        </div>

        {/* 流程操作：推进状态 / 跟进人 */}
        <div className="mt-5 space-y-3 border-t border-border pt-5 print:hidden">
          <div className="grid gap-3 lg:grid-cols-2">
            <WorkflowField
              icon={GitBranch}
              title="推进状态"
              hint={STATUS_META[record.status].description}
            >
              {canChangeStatus ? (
                <>
                  <SearchableSelect
                    value={record.status}
                    onChange={(v) => applyStatusChange(v as RequestStatus)}
                    options={statusSelectOptions}
                    placeholder="选择状态"
                  />
                  {STATUS_ACTIONS[record.status] ? (
                    <Button
                      className="w-full gap-1.5"
                      size="sm"
                      onClick={() => {
                        const action = STATUS_ACTIONS[record.status]!
                        applyStatusChange(action.next)
                      }}
                    >
                      {STATUS_ACTIONS[record.status]!.label}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  ) : null}

                </>
              ) : (
                <SearchableSelect
                  value={record.status}
                  onChange={() => undefined}
                  options={statusSelectOptions}
                  placeholder="当前状态"
                  disabled
                />
              )}
            </WorkflowField>

            <WorkflowField
              icon={UserRound}
              title="跟进人"
              hint={
                record.invite
                    ? `来源邀请：${record.invite.label?.trim() || "未设置备注"} · ${record.invite.active ? "有效" : "已撤销"}`
                    : canAssignOwner
                      ? `可选 ${salesDeptLabel} 同事`
                      : undefined
              }
            >
              {canAssignOwner ? (
                <>
                  <SearchableSelect
                    value={record.owner || UNASSIGNED_OWNER}
                    onChange={(v) => {
                      if (!v) return
                      assignOwner(record.id, v)
                        .then(() => toast.success("跟进人已更新"))
                        .catch((e) => toast.error(e instanceof Error ? e.message : "更新跟进人失败"))
                    }}
                    options={ownerSelectOptions}
                    placeholder="选择跟进人"
                  />
                  {record.ownerEmploymentStatus === "resigned" ? (
                    <p className="text-[11px] text-amber-700">当前跟进人已离职，请改派给在职同事。</p>
                  ) : null}
                  {salesColleaguesLoading ? (
                    <p className="text-[11px] text-muted-foreground">正在加载成员…</p>
                  ) : null}
                </>
              ) : (
                <>
                  <SearchableSelect
                    value={record.owner || UNASSIGNED_OWNER}
                    onChange={() => undefined}
                    options={ownerSelectOptions}
                    placeholder="当前跟进人"
                    disabled
                  />
                  {record.ownerEmploymentStatus === "resigned" ? (
                    <p className="text-[11px] text-amber-700">当前跟进人已离职。</p>
                  ) : null}
                </>
              )}
            </WorkflowField>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as RequestTab)} className="mt-5 gap-0">
        <TabsList
          variant="line"
          className="flex h-auto w-full flex-wrap justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 print:hidden"
        >
          <TabsTrigger
            value="info"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            基本信息
          </TabsTrigger>
          <TabsTrigger
            value="follow"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            跟进记录
            <span className="ml-1 tabular-nums text-muted-foreground">({record.notes.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <Paperclip className="size-3.5 opacity-70" />
            附件
            <span className="ml-1 tabular-nums text-muted-foreground">({attachments.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <History className="size-3.5 opacity-70" />
            <EntityAuditCount entityId={record.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4 outline-none">
          {domesticRequest && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">方案交付信息</h2>
                  <p className="mt-1 text-xs text-muted-foreground">国内需求单分配售前顾问时需填写方案链接和预计出方案时间。</p>
                </div>
                {canEdit && <Button type="button" size="sm" onClick={() => void saveSolutionDelivery()}>保存</Button>}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">方案链接</label>
                  <Input value={solutionLink} onChange={(e) => setSolutionLink(e.target.value)} placeholder="粘贴方案文档链接" disabled={!canEdit} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">预计出方案时间</label>
                  <DatePicker value={expectedSolutionDate} onChange={setExpectedSolutionDate} placeholder="选择日期" disabled={!canEdit} />
                </div>
              </div>
            </div>
          )}
          <RequestDetailContent data={record.data} />
        </TabsContent>

        <TabsContent value="follow" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            {canAddNote && (
              <FollowUpComposer
                footerRight={
                  <Button
                    size="sm"
                    className="shrink-0 gap-1.5"
                    disabled={submittingNote || !note.trim()}
                    onClick={() => void submitNote()}
                  >
                    <MessageSquarePlus className="size-4" />
                    {submittingNote ? "提交中…" : "添加进展"}
                  </Button>
                }
              >
                <MentionTextarea
                  rows={4}
                  placeholder="记录本次沟通内容，输入 @ 可提及成员…"
                  value={note}
                  onChange={setNote}
                  onMentionsChange={setMentions}
                  options={staffNames}
                />
              </FollowUpComposer>
            )}
            <FollowUpRecords
              records={notesNewestFirst.map((n) => ({
                id: n.id,
                author: n.author,
                date: n.createdAt,
                content: n.content,
              }))}
              emptyText="暂无跟进记录，可在上方添加首次沟通内容"
            />
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  需求附件
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  可上传沟通纪要、报价材料等需求附件。
                </p>
              </div>
              {canEdit && (
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  上传附件
                </Button>
              )}
            </div>
            <div className="mt-4 space-y-2.5">
              {attachments.length === 0 ? (
                <EmptyState text="暂无附件" />
              ) : (
                [...attachments].reverse().map((attachment) => (
                  <CrmAttachmentRow
                    key={attachment.id}
                    attachment={attachment}
                    badge={{ label: "需求附件", tone: "info" }}
                  />
                ))
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-4 flex h-[min(36rem,calc(100dvh-18rem))] min-h-[20rem] flex-col overflow-hidden outline-none"
        >
          <EntityAuditHistory
            entityId={record.id}
            embedded
            hint="状态变更、跟进与附件等操作会出现在这里（按操作时间倒序）。"
          />
        </TabsContent>
      </Tabs>

      <EditDialog open={editOpen && canEdit} onOpenChange={setEditOpen} record={record} />
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="上传需求附件"
        description="请为每个需求附件填写用途说明。"
        onUploaded={handleAttachmentsUploaded}
      />
    </div>
  )
}
