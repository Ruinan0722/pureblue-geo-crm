export interface GeoPosition {
  latitude: number
  longitude: number
  accuracy?: number
}

export interface AddressInfo {
  address: string
  province?: string
  city?: string
  district?: string
}

export type CheckinType = "arrive" | "leave"

export interface CheckinAttachment {
  id: string
  url: string
  storagePath: string
  originalName?: string | null
  contentType?: string | null
  size?: number | null
  uploadedAt?: string | null
  uploadedBy?: string | null
}

export interface CheckinRecord {
  id: string
  userId: string
  userName: string
  departmentNames: string[]
  visitId: string
  type: CheckinType
  timestamp: number
  beijingTime: string
  latitude: number
  longitude: number
  accuracy?: number
  address: string
  province?: string
  city?: string
  district?: string
  attachmentIds?: string[]
  /** 库内同步的附件元数据（含可访问链接） */
  attachments?: CheckinAttachment[]
}

export interface CreateCheckinInput {
  visitId: string
  type: CheckinType
  timestamp: number
  beijingTime: string
  latitude: number
  longitude: number
  accuracy?: number
  address: string
  province?: string
  city?: string
  district?: string
  attachmentIds?: string[]
}

export interface CheckinUserBreakdown {
  userId: string
  userName: string
  count: number
  arriveCount: number
  leaveCount: number
}

export interface CheckinStats {
  total: number
  arriveCount: number
  leaveCount: number
  uniqueUsers: number
  userBreakdown: CheckinUserBreakdown[]
}

export interface CheckinListFilters {
  scope?: "own" | "team"
  userId?: string
  type?: CheckinType | ""
  from?: number
  to?: number
}
