/** CRM 附件：上传到 geo-api 本地磁盘（暂不上云）。 */

export const CRM_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
export const CRM_ATTACHMENT_MAX_COUNT = 20

export const CRM_ATTACHMENT_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*,application/pdf"

export type UploadedCrmAttachment = {
  id: string
  url: string
  name: string
  contentType?: string
  size: number
  storagePath?: string
  uploadedAt?: string
  uploadedBy?: string
}

export function crmAttachmentUrl(id: string, options?: { download?: boolean }): string {
  const base = `/api/crm/attachments/${encodeURIComponent(id)}`
  return options?.download ? `${base}?download=1` : base
}

export function isPreviewableAttachment(contentType?: string, name?: string): boolean {
  const type = (contentType || "").toLowerCase()
  if (type.startsWith("image/") || type === "application/pdf" || type === "text/plain") return true
  const lower = (name || "").toLowerCase()
  return /\.(png|jpe?g|gif|webp|pdf|txt)$/i.test(lower)
}

async function uploadOne(file: File, options?: { leadId?: string }): Promise<UploadedCrmAttachment> {
  const form = new FormData()
  form.append("files", file, file.name)
  if (options?.leadId) {
    form.append("leadId", options.leadId)
  }

  const res = await fetch("/api/crm/attachments", {
    method: "POST",
    credentials: "include",
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as {
    attachmentIds?: string[]
    attachments?: Array<{
      id: string
      url: string
      name?: string
      originalName?: string
      contentType?: string
      size?: number
      storagePath?: string
      uploadedAt?: string
      uploadedBy?: string
    }>
    error?: string
    detail?: string
  }
  if (!res.ok) {
    throw new Error(data.error || data.detail || "附件上传失败")
  }
  const item = data.attachments?.[0]
  const id = item?.id || data.attachmentIds?.[0]
  if (!id) {
    throw new Error("附件上传失败：未返回附件 ID")
  }
  return {
    id,
    url: item?.url || crmAttachmentUrl(id),
    name: item?.name || item?.originalName || file.name,
    contentType: item?.contentType || file.type || undefined,
    size: item?.size ?? file.size,
    storagePath: item?.storagePath,
    uploadedAt: item?.uploadedAt,
    uploadedBy: item?.uploadedBy,
  }
}

export async function uploadCrmAttachments(
  files: File[],
  options?: { leadId?: string },
): Promise<UploadedCrmAttachment[]> {
  if (files.length === 0) return []
  if (files.length > CRM_ATTACHMENT_MAX_COUNT) {
    throw new Error(`一次最多上传 ${CRM_ATTACHMENT_MAX_COUNT} 个附件`)
  }

  const uploaded: UploadedCrmAttachment[] = []
  try {
    for (const file of files) {
      if (file.size > CRM_ATTACHMENT_MAX_BYTES) {
        throw new Error(`单个附件不能超过 ${Math.round(CRM_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB`)
      }
      uploaded.push(await uploadOne(file, options))
    }
    return uploaded
  } catch (error) {
    await deleteCrmAttachments(uploaded.map((item) => item.id))
    throw error
  }
}

export async function deleteCrmAttachments(ids: string[]): Promise<void> {
  await Promise.allSettled(
    ids.map((id) =>
      fetch(`/api/crm/attachments/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      }),
    ),
  )
}
