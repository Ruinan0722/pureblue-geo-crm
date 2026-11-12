/** 与 geo-api CHECKIN_ATTACHMENT_* 保持一致 */

export const CHECKIN_ATTACHMENT_MAX_COUNT = 9
export const CHECKIN_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const CHECKIN_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif"

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateCheckinAttachmentFiles(
  existing: File[],
  incoming: File[],
): { files: File[]; error?: string } {
  const merged: File[] = [...existing]
  for (const file of incoming) {
    const type = (file.type || "").split(";")[0].trim().toLowerCase()
    if (!ALLOWED_TYPES.has(type)) {
      return { files: existing, error: `不支持的文件类型：${file.name || "未知文件"}（仅 JPEG/PNG/WebP/GIF）` }
    }
    if (file.size <= 0) {
      return { files: existing, error: `空文件无法添加：${file.name || "未知文件"}` }
    }
    if (file.size > CHECKIN_ATTACHMENT_MAX_BYTES) {
      return {
        files: existing,
        error: `${file.name || "图片"}超过 ${formatBytes(CHECKIN_ATTACHMENT_MAX_BYTES)} 上限`,
      }
    }
    if (merged.length >= CHECKIN_ATTACHMENT_MAX_COUNT) {
      return {
        files: existing,
        error: `最多选择 ${CHECKIN_ATTACHMENT_MAX_COUNT} 张现场照片`,
      }
    }
    merged.push(file)
  }
  return { files: merged }
}

/** 从个人打卡记录推导进行中的拜访（arrive 无配对 leave） */
export function resolveActiveVisitId(records: Array<{ type: string; visitId: string; timestamp: number }>): string | null {
  const leaveVisitIds = new Set(records.filter((r) => r.type === "leave").map((r) => r.visitId))
  const open = records
    .filter((r) => r.type === "arrive" && r.visitId && !leaveVisitIds.has(r.visitId))
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  return open?.visitId ?? null
}
