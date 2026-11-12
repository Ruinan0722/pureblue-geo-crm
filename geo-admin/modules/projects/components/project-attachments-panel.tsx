"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileUp, Info, Loader2, Paperclip } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { EmptyState } from "@/modules/crm/components/ui"
import { CrmAttachmentRow } from "@/modules/crm/components/attachment-row"
import type { ProjectAttachment } from "@/modules/projects/lib/types"
import {
  fetchProjectAttachments,
  uploadProjectAttachments,
} from "@/modules/projects/services/projects-api"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_FILE_COUNT = 20
const ALLOWED_EXTENSIONS = ["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "zip"]

function extension(name: string) { return name.split(".").pop()?.toLowerCase() || "文件" }

export function ProjectAttachmentsPanel({
  projectId,
  writable,
}: {
  projectId: string
  writable: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<ProjectAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await fetchProjectAttachments(projectId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载项目附件失败")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    const selected = Array.from(files)
    if (selected.length > MAX_FILE_COUNT) {
      toast.error(`一次最多上传 ${MAX_FILE_COUNT} 个附件`)
      return
    }
    const invalid = selected.find(
      (file) => !ALLOWED_EXTENSIONS.includes(extension(file.name)),
    )
    if (invalid) {
      toast.error(`「${invalid.name}」的格式暂不支持`)
      return
    }
    const tooLarge = selected.find((file) => file.size > MAX_FILE_BYTES)
    if (tooLarge) {
      toast.error(`「${tooLarge.name}」超过 25MB 限制`)
      return
    }

    setUploading(true)
    try {
      const added = await uploadProjectAttachments(projectId, selected)
      setItems((current) => [...added, ...current])
      toast.success(`已上传 ${added.length} 个附件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传项目附件失败")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
        <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/50">
          <Info className="size-4 text-blue-700 dark:text-blue-300" />
        </div>
        <div>
          <p className="text-sm font-medium">项目附件</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            统一归档项目方案、交付材料和验收文件，支持 PPT、PDF、Word、Excel、图片、文本与 ZIP。
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Paperclip className="size-4" />
              附件列表（{items.length}）
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">单个文件不超过 25MB，一次最多上传 20 个。</p>
          </div>
          {writable ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip"
                multiple
                className="sr-only"
                aria-label="选择项目附件"
                onChange={(event) => void upload(event.target.files)}
              />
              <Button
                type="button"
                className="gap-1.5"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                {uploading ? "上传中…" : "上传附件"}
              </Button>
            </>
          ) : null}
        </div>

        <div className="mt-4 space-y-2.5">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载附件中…</div>
          ) : items.length === 0 ? (
            <EmptyState text={writable ? "暂无附件，点击右上角上传文件" : "暂无项目附件"} />
          ) : (
            items.map((attachment) => (
              <CrmAttachmentRow
                key={attachment.id}
                attachment={{
                  id: attachment.id,
                  name: attachment.name,
                  size: attachment.size,
                  uploadedAt: attachment.uploadedAt,
                  uploadedBy: attachment.uploadedBy,
                  url: attachment.url,
                  contentType: attachment.contentType,
                }}
                badge={{ label: extension(attachment.name).toUpperCase(), tone: "info" }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
