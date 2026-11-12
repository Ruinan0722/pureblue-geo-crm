import type { GeoFormData } from "@/modules/intake"
import type { RequestStatus } from "./status"

export interface NoteItem {
  id: string
  author: string
  content: string
  createdAt: string
}

export interface RequestAttachment {
  id: string
  name: string
  size: number
  uploadedAt: string
  uploadedBy: string
  url?: string
  contentType?: string
  storagePath?: string
  description?: string
}

export interface RequestInviteInfo {
  id: string
  label: string | null
  url: string
  createdAt: string
  active: boolean
}

export interface RequestRecord {
  id: string
  code: string
  status: RequestStatus
  submittedAt: string
  updatedAt: string
  owner: string
  /** 跟进人在职状态；resigned 时仍保留历史姓名便于回溯 */
  ownerEmploymentStatus?: "active" | "resigned" | null
  staffUserId: string | null
  inviteId: string | null
  invite?: RequestInviteInfo | null
  /** @deprecated 旧接口兼容字段，始终为空 */
  opportunityId?: string | null
  notes: NoteItem[]
  attachments?: RequestAttachment[]
  data: GeoFormData
  reused?: boolean
  /** @deprecated 旧接口兼容字段，不再联动商机 */
  syncedOpportunity?: Record<string, unknown> | null
}
