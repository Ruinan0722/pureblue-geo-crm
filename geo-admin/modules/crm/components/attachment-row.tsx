"use client"

import { Download, Eye, FileText, ImageIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Pill } from "@/modules/crm/components/ui"
import { cn } from "@/shared/lib/utils"
import {
  crmAttachmentUrl,
  isPreviewableAttachment,
} from "@/modules/crm/services/crm-attachments"

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export type CrmAttachmentRowData = {
  id: string
  name: string
  size: number
  uploadedAt: string
  uploadedBy: string
  url?: string
  contentType?: string
  origin?: "lead" | "request"
  description?: string
}

export function CrmAttachmentRow({
  attachment,
  badge,
  className,
}: {
  attachment: CrmAttachmentRowData
  badge?: { label: string; tone?: string }
  className?: string
}) {
  const hasStoredFile =
    Boolean(attachment.url?.includes("/api/crm/attachments/")) ||
    Boolean(attachment.url?.includes("/api/crm/mark-materials/")) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i.test(attachment.id)
  const externalUrl =
    attachment.url && /^https?:\/\//i.test(attachment.url) && !hasStoredFile ? attachment.url : null
  const canPreview = hasStoredFile && isPreviewableAttachment(attachment.contentType, attachment.name)
  const viewUrl = attachment.url || crmAttachmentUrl(attachment.id)
  const downloadUrl = attachment.url?.includes("/api/crm/mark-materials/") || attachment.url?.startsWith("/api/channels/contracts/")
    ? `${attachment.url}?download=true`
    : crmAttachmentUrl(attachment.id, { download: true })
  const isImage = (attachment.contentType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(attachment.name)
  const Icon = isImage ? ImageIcon : FileText

  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-border p-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <Icon className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-sm font-medium" title={attachment.name}>
            {attachment.name}
          </p>
          {attachment.description?.trim() ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{attachment.description.trim()}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {externalUrl
              ? `飞书链接 · ${attachment.uploadedBy} · ${attachment.uploadedAt}`
              : `${fileSize(attachment.size)} · ${attachment.uploadedBy} · ${attachment.uploadedAt}${
                  !hasStoredFile ? " · 旧记录无文件" : ""
                }`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge && <Pill label={badge.label} tone={badge.tone ?? "info"} />}
        {externalUrl && (
          <Button variant="outline" size="sm" className="gap-1" asChild>
            <a href={externalUrl} target="_blank" rel="noreferrer">
              <Eye className="size-3.5" />
              打开
            </a>
          </Button>
        )}
        {canPreview && (
          <Button variant="outline" size="sm" className="gap-1" asChild>
            <a href={viewUrl} target="_blank" rel="noreferrer">
              <Eye className="size-3.5" />
              查看
            </a>
          </Button>
        )}
        {hasStoredFile && (
          <Button variant="outline" size="sm" className="gap-1" asChild>
            <a href={downloadUrl} download={attachment.name}>
              <Download className="size-3.5" />
              下载
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}
