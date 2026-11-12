"use client"

import { useEffect, useId, useRef, useState } from "react"
import { FileText, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import {
  CRM_ATTACHMENT_ACCEPT,
  CRM_ATTACHMENT_MAX_BYTES,
  CRM_ATTACHMENT_MAX_COUNT,
  uploadCrmAttachments,
  type UploadedCrmAttachment,
} from "@/modules/crm/services/crm-attachments"

type PendingFile = {
  key: string
  file: File
  description: string
}

export type AttachmentUploadResult = UploadedCrmAttachment & { description: string }

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** 上传附件前填写用途说明；确认后再真正上传 */
export function AttachmentUploadDialog({
  open,
  onOpenChange,
  leadId,
  title = "上传附件",
  description = "请为每个附件填写用途说明，例如实现了什么功能、有什么用。",
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId?: string
  title?: string
  description?: string
  onUploaded: (items: AttachmentUploadResult[]) => Promise<void>
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setPending([])
      setSubmitting(false)
    }
  }, [open])

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    const next: PendingFile[] = []
    for (const file of Array.from(list)) {
      if (file.size > CRM_ATTACHMENT_MAX_BYTES) {
        toast.error(`「${file.name}」超过 ${Math.round(CRM_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB 限制`)
        continue
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        description: "",
      })
    }
    setPending((current) => {
      const merged = [...current, ...next]
      if (merged.length > CRM_ATTACHMENT_MAX_COUNT) {
        toast.error(`一次最多上传 ${CRM_ATTACHMENT_MAX_COUNT} 个附件`)
        return merged.slice(0, CRM_ATTACHMENT_MAX_COUNT)
      }
      return merged
    })
    if (inputRef.current) inputRef.current.value = ""
  }

  async function submit() {
    if (pending.length === 0) {
      toast.error("请先选择要上传的文件")
      return
    }
    const missing = pending.find((item) => !item.description.trim())
    if (missing) {
      toast.error(`请填写「${missing.file.name}」的附件说明`)
      return
    }
    setSubmitting(true)
    try {
      let uploaded
      try {
        uploaded = await uploadCrmAttachments(
          pending.map((item) => item.file),
          leadId ? { leadId } : undefined,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传附件失败")
        return
      }
      const items: AttachmentUploadResult[] = uploaded.map((file, index) => ({
        ...file,
        description: pending[index]?.description.trim() || "",
      }))
      try {
        await onUploaded(items)
        onOpenChange(false)
      } catch {
        // 业务侧（CrmProvider）已 toast
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-x-hidden overflow-y-auto">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <div>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              multiple
              accept={CRM_ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              选择文件
            </Button>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              支持图片、PDF、Office、压缩包等，单文件不超过 {Math.round(CRM_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB
            </p>
          </div>

          {pending.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              尚未选择文件
            </div>
          ) : (
            <ul className="min-w-0 space-y-3">
              {pending.map((item) => (
                <li key={item.key} className="min-w-0 overflow-hidden rounded-xl border border-border p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                      <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium" title={item.file.name}>
                          {item.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{fileSize(item.file.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`移除 ${item.file.name}`}
                      onClick={() => setPending((current) => current.filter((row) => row.key !== item.key))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <label className="mt-2 block text-xs text-muted-foreground">
                    附件说明 <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    value={item.description}
                    onChange={(e) =>
                      setPending((current) =>
                        current.map((row) => (row.key === item.key ? { ...row, description: e.target.value } : row)),
                      )
                    }
                    placeholder="例如：客户名片扫描件 / 需求沟通纪要 / 报价方案初稿"
                    rows={2}
                    className="mt-1"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || pending.length === 0}>
            {submitting ? "上传中…" : `确认上传${pending.length ? `（${pending.length}）` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
