/** 打卡附件：上传到 geo-api 本地磁盘目录（暂不上云）。 */

import { CHECKIN_ATTACHMENT_MAX_BYTES, CHECKIN_ATTACHMENT_MAX_COUNT } from "../lib/attachment-limits"

async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file
  }
  // 已较小则不压缩，减少画质损失
  if (file.size <= 1.5 * 1024 * 1024) {
    return file
  }

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const maxEdge = 1920
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  })
  if (!blob || blob.size >= file.size) {
    return file
  }
  const baseName = file.name.replace(/\.[^.]+$/, "") || "checkin"
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
}

async function uploadOne(file: File): Promise<{ id: string }> {
  const form = new FormData()
  form.append("files", file, file.name)

  const res = await fetch("/api/checkin/attachments", {
    method: "POST",
    credentials: "include",
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as {
    attachmentIds?: string[]
    error?: string
    detail?: string
  }
  if (!res.ok) {
    throw new Error(data.error || data.detail || "附件上传失败")
  }
  const id = data.attachmentIds?.[0]
  if (!id) {
    throw new Error("附件上传失败：未返回附件 ID")
  }
  return { id }
}

/** 逐张上传（控制单次 multipart 体积，避免经 Next 代理被截断） */
export async function uploadCheckinAttachments(files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  if (files.length > CHECKIN_ATTACHMENT_MAX_COUNT) {
    throw new Error(`最多上传 ${CHECKIN_ATTACHMENT_MAX_COUNT} 张照片`)
  }

  const ids: string[] = []
  try {
    for (const raw of files) {
      if (raw.size > CHECKIN_ATTACHMENT_MAX_BYTES) {
        throw new Error(`单张图片不能超过 ${Math.round(CHECKIN_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB`)
      }
      const file = await compressImageIfNeeded(raw)
      const uploaded = await uploadOne(file)
      ids.push(uploaded.id)
    }
    return ids
  } catch (error) {
    await deleteCheckinAttachments(ids)
    throw error
  }
}

export async function deleteCheckinAttachments(ids: string[]): Promise<void> {
  await Promise.allSettled(
    ids.map((id) =>
      fetch(`/api/checkin/attachments/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      }),
    ),
  )
}

/** 已登录会话下的附件访问地址（由 rewrite 代理到 geo-api） */
export function checkinAttachmentUrl(id: string): string {
  return `/api/checkin/attachments/${encodeURIComponent(id)}`
}
