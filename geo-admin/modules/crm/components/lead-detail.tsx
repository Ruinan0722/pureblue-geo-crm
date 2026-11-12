"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  History,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  RefreshCw,
  Upload,
  UserCheck,
  Wallet,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import { Checkbox } from "@/shared/ui/checkbox"
import { MentionTextarea } from "@/modules/crm/components/member-picker"
import { useMentionNames } from "@/modules/crm/hooks/use-directory-options"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Pill, InfoRow, EmptyState } from "@/modules/crm/components/ui"
import { FollowUpComposer, FollowUpRecords } from "@/modules/crm/components/follow-up-panel"
import { sortFollowUpsNewestFirst } from "@/modules/crm/lib/follow-up-sort"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import { canDo } from "@/modules/auth/lib/permissions"
import { EntityAuditCount, EntityAuditHistory } from "@/modules/audit/components/entity-audit-history"
import {
  daysSinceDate,
  leadFollowStateLabel,
  leadLevelLabel,
  leadStatusMeta,
  latestFollowDate,
  normalizeLeadSource,
} from "@/modules/crm/lib/crm-data"
import { ConvertLeadDialog, LeadFormDialog } from "@/modules/crm/components/lead-actions"
import { AttachmentUploadDialog } from "@/modules/crm/components/attachment-upload-dialog"
import { retryMarkMaterial } from "@/modules/crm/services/crm-api"

/** 官网等 URL 字段清洗：占位文本（如飞书 "*用户未填写"）视为空。 */
function usableWebsite(v?: string): string {
  const s = (v || "").trim()
  return /未填写|暂无|^无$|^-$|^—$/.test(s) ? "" : s
}

type LeadTab = "info" | "follow" | "files" | "history"

export function LeadDetail({ id }: { id: string }) {
  const { getLead, addLeadNote, addLeadAttachment, markLeadInvalid, loadLeadById, loading } = useCrm()
  const { identity, user } = useRole()
  const permissions = user?.permissions ?? []
  const canEditLead = canDo(permissions, "leads:edit", "leads:write")
  const lead = getLead(id)

  const { names: staffNames } = useMentionNames("leads", id)
  const [tab, setTab] = useState<LeadTab>("info")
  const [note, setNote] = useState("")
  const [mentions, setMentions] = useState<string[]>([])
  const [wechat, setWechat] = useState(false)
  const [submittingNote, setSubmittingNote] = useState(false)
  const [invalidOpen, setInvalidOpen] = useState(false)
  const [invalidReason, setInvalidReason] = useState("")
  const [convertOpen, setConvertOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retryingMaterialId, setRetryingMaterialId] = useState<string | null>(null)

  useEffect(() => {
    if (loading || lead) return
    setDetailLoading(true)
    void loadLeadById(id).finally(() => setDetailLoading(false))
  }, [id, loading, lead, loadLeadById])

  if ((loading || detailLoading) && !lead) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 text-center text-sm text-muted-foreground lg:px-8">
        加载线索详情中…
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">未找到该线索，可能已删除或无权查看。</p>
        <Link href="/leads" className="mt-3 inline-block text-sm text-primary hover:underline">
          返回线索列表
        </Link>
      </div>
    )
  }

  const meta = leadStatusMeta(lead.status, lead.leadType)
  const canInvalid =
    canDo(permissions, "leads:invalid", "leads:write") &&
    lead.status !== "converted" &&
    lead.status !== "invalid"
  const canConvert = lead.leadType !== "channel" &&
    canDo(permissions, "leads:convert", "leads:write") &&
    lead.status !== "converted" &&
    lead.status !== "invalid"
  // 已转客户后仍可补记跟进；仅无效线索禁止新增
  const channelClosed = lead.leadType === "channel" && lead.status === "converted"
  const canAddNote = canEditLead && lead.status !== "invalid" && !channelClosed
  const canUpload = canEditLead && lead.status !== "invalid" && !channelClosed
  // 兼容历史记录及外部写入缺少数组字段的线索。
  const notesNewestFirst = sortFollowUpsNewestFirst(Array.isArray(lead.notes) ? lead.notes : [])
  const attachments = Array.isArray(lead.attachments) ? lead.attachments : []
  const markMaterials = Array.isArray(lead.markMaterials) ? lead.markMaterials : []

  async function retryMaterial(fileId: string) {
    setRetryingMaterialId(fileId)
    try {
      await retryMarkMaterial(fileId)
      await loadLeadById(id)
      toast.success("已重新加入下载队列")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重新下载失败")
    } finally {
      setRetryingMaterialId(null)
    }
  }

  async function submitNote() {
    if (!lead) return
    if (!note.trim()) {
      toast.error("请输入跟进内容")
      return
    }
    setSubmittingNote(true)
    try {
      await addLeadNote(lead.id, note.trim(), lead.wechatAdded ? false : wechat, {
        mentions,
      })
      setNote("")
      setMentions([])
      setWechat(false)
      setTab("follow")
      toast.success("跟进记录已添加")
    } catch {
      /* CrmProvider 已 toast */
    } finally {
      setSubmittingNote(false)
    }
  }

  async function confirmInvalid() {
    if (!lead) return
    if (!invalidReason.trim()) {
      toast.error("请填写无效原因")
      return
    }
    try {
      await markLeadInvalid(lead.id, invalidReason.trim())
      setInvalidOpen(false)
      toast.success("线索已标记为无效")
    } catch {
      /* CrmProvider 已 toast */
    }
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
    if (!lead) return
    const author = identity.name || "当前用户"
    for (const file of items) {
      await addLeadAttachment(lead.id, {
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 lg:px-8">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回线索列表
      </Link>

      {/* 页头摘要：切 Tab 时始终可见 */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{lead.brandName || lead.companyName}</h1>
              <Pill label={meta.label} tone={meta.tone} />
              <Pill
                label={leadLevelLabel(lead.level)}
                tone={lead.level === "A" ? "danger" : lead.level === "B" ? "warning" : "muted"}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {[lead.contactName, lead.source ? `来源：${lead.source}` : null]
                .filter(Boolean)
                .join(" · ") || "暂无联系人信息"}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                地区：{lead.region || "—"}
                {lead.city ? ` · ${lead.city}` : ""}
              </span>
              <span>SDR：{lead.sdr || "—"}</span>
              <span>销售：{lead.sales || "未分配"}</span>
              <span>首次触达：{lead.firstContactDate || "—"}</span>
              <span>创建时间：{lead.createdAt || "—"}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canEditLead && lead.status !== "converted" && lead.status !== "invalid" && (
              <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                编辑
              </Button>
            )}
            {canInvalid && (
              <Button
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setInvalidOpen(true)}
              >
                <Ban className="size-4" />
                置为无效
              </Button>
            )}
            {canConvert && (
              <Button className="gap-1.5" onClick={() => setConvertOpen(true)}>
                <UserCheck className="size-4" />
                生成客户
                <ArrowRight className="size-4" />
              </Button>
            )}
            {lead.convertedCustomerId && (
              <Button variant="outline" className="gap-1.5" asChild>
                <Link href={`/customers/${lead.convertedCustomerId}`}>
                  <Wallet className="size-4" />
                  关联客户
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as LeadTab)}
        className="mt-5 gap-0"
      >
        <TabsList
          variant="line"
          className="flex h-auto w-full flex-wrap justify-start gap-0 rounded-none border-b border-border bg-transparent p-0"
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
            <span className="ml-1 tabular-nums text-muted-foreground">({notesNewestFirst.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <Paperclip className="size-3.5 opacity-70" />
            附件
            <span className="ml-1 tabular-nums text-muted-foreground">({attachments.length + markMaterials.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="h-auto flex-none rounded-none px-4 py-2.5 data-active:bg-transparent"
          >
            <History className="size-3.5 opacity-70" />
            <EntityAuditCount entityId={lead.id} label="历史操作记录" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <InfoRow label="公司名称">{lead.companyName}</InfoRow>
              <InfoRow label="品牌名称">{lead.brandName || "—"}</InfoRow>
              <InfoRow label="地区">{lead.region || "—"}</InfoRow>
              {lead.leadType === "channel" && <><InfoRow label="线索类型">渠道</InfoRow><InfoRow label="行业">{lead.industry}</InfoRow><InfoRow label="渠道类型">{lead.channelType}</InfoRow><InfoRow label="签约方式">{lead.signingMethod}</InfoRow><InfoRow label="渠道操作"><Link href="/leads/channels" className="text-primary hover:underline">分配销售 / 转渠道商 →</Link></InfoRow></>}
              <InfoRow label="城市">{lead.city || "—"}</InfoRow>
              <InfoRow label="联系人">
                {lead.contactName || "—"}
              </InfoRow>
              <InfoRow label="职位">{lead.contactTitle || "—"}</InfoRow>
              <InfoRow label="联系人电话">{lead.contactPhone || "—"}</InfoRow>
              <InfoRow label="联系人微信">{lead.contactWechat || "—"}</InfoRow>
              <InfoRow label="邮箱">{lead.email || "—"}</InfoRow>
              <InfoRow label="部门">{lead.contactDepartment || "—"}</InfoRow>
              <InfoRow label="官网">
                {usableWebsite(lead.website) ? (
                  <a
                    href={usableWebsite(lead.website).startsWith("http") ? usableWebsite(lead.website) : `https://${usableWebsite(lead.website)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline break-all"
                  >
                    {usableWebsite(lead.website)}
                  </a>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label="线索来源">{normalizeLeadSource(lead.source) || lead.source || "—"}</InfoRow>
              <InfoRow label="来源二级">{lead.sourceDetail || "—"}</InfoRow>
              <InfoRow label="线索等级">{leadLevelLabel(lead.level)}</InfoRow>
              <InfoRow label="是否加企微">
                {lead.wechatAdded === true ? "是" : lead.wechatAdded === false ? "否" : "—"}
              </InfoRow>
              <InfoRow label="创建时间">{lead.createdAt || "—"}</InfoRow>
              <InfoRow label="首次触达日期">{lead.firstContactDate || "—"}</InfoRow>
              <InfoRow label="未跟进天数">
                {lead.status === "converted"
                  ? "—"
                  : (() => {
                      const days = daysSinceDate(latestFollowDate(lead.notes) || lead.createdAt)
                      return days == null ? "—" : `未跟进 ${days}天`
                    })()}
              </InfoRow>
              <InfoRow label="转出日期">{lead.transferDate || "—"}</InfoRow>
              <InfoRow label="SDR">{lead.sdr || "—"}</InfoRow>
              <InfoRow label="分配销售">{lead.sales || "未分配"}</InfoRow>
              <InfoRow label="跟进状态">{leadFollowStateLabel(lead)}</InfoRow>
              <InfoRow label="线索状态">
                <Pill label={meta.label} tone={meta.tone} />
              </InfoRow>
              {lead.status === "invalid" && (
                <div className="sm:col-span-2">
                  <InfoRow label="无效原因">{lead.invalidReason || "—"}</InfoRow>
                </div>
              )}
              {lead.convertedCustomerId && (
                <div className="sm:col-span-2">
                  <InfoRow label="关联客户">
                    <Link
                      href={`/customers/${lead.convertedCustomerId}`}
                      className="text-primary hover:underline"
                    >
                      查看客户档案
                    </Link>
                  </InfoRow>
                </div>
              )}
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="follow" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            {canAddNote ? (
              <FollowUpComposer
                footerRight={
                  <Button
                    size="sm"
                    className="shrink-0 gap-1.5"
                    disabled={submittingNote}
                    onClick={submitNote}
                  >
                    <MessageSquarePlus className="size-4" />
                    {submittingNote ? "提交中…" : "添加进展"}
                  </Button>
                }
              >
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">企业微信（可选）</label>
                  <label
                    className={
                      lead.wechatAdded
                        ? "flex h-9 w-full max-w-sm cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground/70"
                        : "flex h-9 w-full max-w-sm cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm"
                    }
                  >
                    <Checkbox
                      checked={lead.wechatAdded ? false : wechat}
                      disabled={lead.wechatAdded === true}
                      onCheckedChange={(v) => {
                        if (lead.wechatAdded) return
                        setWechat(v === true)
                      }}
                    />
                    {lead.wechatAdded ? "已添加企业微信" : "本次已添加企业微信"}
                  </label>
                </div>
                <MentionTextarea
                  rows={4}
                  placeholder="记录本次沟通内容，输入 @ 可提及成员…"
                  value={note}
                  onChange={setNote}
                  onMentionsChange={setMentions}
                  options={staffNames}
                />
              </FollowUpComposer>
            ) : lead.status === "invalid" ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                该线索已标记为无效，仅可查看历史跟进，不可再新增。
              </div>
            ) : null}

            <FollowUpRecords
              records={notesNewestFirst.map((n) => ({
                id: n.id,
                author: n.author,
                date: n.date,
                content: n.content,
                pills: (
                  <>
                    {n.wechatAdded && <Pill label="已加企微" tone="success" />}
                  </>
                ),
              }))}
              emptyText="暂无跟进记录，可在上方添加首次沟通内容"
            />
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-4 outline-none">
          <div className="rounded-2xl border border-border bg-card p-5">
            {markMaterials.length > 0 && (
              <div className="mb-5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  Mark 材料
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mark 提供 S3 地址后，由 CRM 后台下载并归档。成功归档的版本可直接查看或下载。
                </p>
                <div className="mt-3 space-y-2.5">
                  {markMaterials.map((material) => {
                    const downloaded = material.status === "downloaded" && material.url
                    const failed = material.status === "download_failed" || material.status === "expired"
                    const statusLabel = {
                      pending_download: "等待下载",
                      downloading: "下载中",
                      downloaded: "已归档",
                      download_failed: "下载失败",
                      expired: "地址已过期",
                    }[material.status]
                    return (
                      <div key={material.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{material.fileName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            版本 {material.materialVersion} · {statusLabel}
                            {material.isCurrent ? " · 当前版本" : ""}
                            {material.downloadAttempts ? ` · 已尝试 ${material.downloadAttempts} 次` : ""}
                          </p>
                          {material.failureReason && (
                            <p className="mt-1 text-xs text-destructive">{material.failureReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {downloaded && (
                            <>
                              <Button variant="outline" size="sm" asChild>
                                <a href={material.url} target="_blank" rel="noreferrer">查看</a>
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <a href={`${material.url}?download=true`} download={material.fileName}>下载</a>
                              </Button>
                            </>
                          )}
                          {failed && canEditLead && material.status !== "expired" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              disabled={retryingMaterialId === material.id}
                              onClick={() => void retryMaterial(material.id)}
                            >
                              <RefreshCw className="size-3.5" />
                              {retryingMaterialId === material.id ? "处理中" : "重新下载"}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Paperclip className="size-4" />
                  线索附件
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  SDR 可上传名片、沟通记录等；转客户后会一并带入客户档案。
                </p>
              </div>
              {canUpload && (
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
                    badge={{ label: "线索附件", tone: "info" }}
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
            entityId={lead.id}
            embedded
            hint="字段变更、转客户、标记无效等操作会出现在这里（按操作时间倒序）。"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={invalidOpen} onOpenChange={setInvalidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>标记为无效线索</DialogTitle>
            <DialogDescription>请填写无效原因，便于后续质量分析。</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="例如：无海外品牌建设需求 / 联系方式无效 / 非目标行业"
            value={invalidReason}
            onChange={(e) => setInvalidReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvalidOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmInvalid}>
              确认无效
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {convertOpen && <ConvertLeadDialog leadId={lead.id} open={convertOpen} onOpenChange={setConvertOpen} />}
      {editOpen && <LeadFormDialog leadId={lead.id} open={editOpen} onOpenChange={setEditOpen} />}
      <AttachmentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        leadId={lead.id}
        title="上传线索附件"
        description="请为每个附件填写用途说明，例如名片、沟通记录、需求材料等。"
        onUploaded={handleAttachmentsUploaded}
      />
    </div>
  )
}
