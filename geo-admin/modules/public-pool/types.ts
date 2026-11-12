export type PublicPoolClaim = {
  id: string
  applicantUserId: string
  applicantName: string
  status: "pending_review" | "approved" | "rejected"
  reviewReason: string
  reviewerName: string
  appliedAt: string
  reviewedAt: string
}

export type PublicPoolItem = {
  id: string
  customerId: string
  companyName: string
  brandName: string
  region: string
  city: string
  industryL1: string
  industryL2: string
  foundedDate: string
  creditCode: string
  registeredCapital: number
  annualRevenue: number
  scale: string
  nature: string
  source: string
  sourceDetail: string
  status: "available" | "pending_review" | "claimed" | "rejected"
  releasedAt: string
  releaseReason: string
  contactHint: string
  latestApplication: PublicPoolClaim | null
  myApplication: PublicPoolClaim | null
  pendingApplication: PublicPoolClaim | null
  canClaim: boolean
  canReview: boolean
}

export type PublicPoolList = {
  items: PublicPoolItem[]
  total: number
  page: number
  pageSize: number
  allowedRegions: string[]
  regionConfigured: boolean
}

export type PublicPoolStats = {
  total: number
  pending_review: number
  claimed_this_month: number
}
