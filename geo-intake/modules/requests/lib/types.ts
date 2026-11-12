import type { GeoFormData } from "@/modules/intake"
import type { RequestStatus } from "./status"

export interface NoteItem {
  id: string
  author: string
  content: string
  createdAt: string
}

export interface RequestRecord {
  id: string
  code: string
  status: RequestStatus
  submittedAt: string
  updatedAt: string
  owner: string
  staffUserId: string | null
  inviteId: string | null
  notes: NoteItem[]
  data: GeoFormData
}
