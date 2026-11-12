// 状态机/常量唯一权威源：geo-api/app/modules/contracts/status_catalog.py
import type {
  ProjectHealth,
  ProjectNoteKind,
  ProjectRisk,
  ProjectStage,
} from "@/modules/crm/lib/status-catalog.generated"

export type { ProjectHealth, ProjectNoteKind, ProjectRisk, ProjectStage }

export type ProjectRecord = {
  id: string
  name: string
  customerId: string
  customerName: string
  sourceContractId: string
  opportunityId?: string | null
  stage: ProjectStage
  health: ProjectHealth
  riskLevel: ProjectRisk
  bizOwner: string
  bizOwnerUserId?: string | null
  projectManager: string
  projectManagerUserId?: string | null
  projectLeader: string
  executor: string
  executorUserId?: string | null
  contentOps: string
  contentOpsMembers: string[]
  contentOpsUserId?: string | null
  contractAmount?: number | null
  customerIndustry: string
  customerType: string
  customerRegion: string
  contactInfo: string
  teamName: string
  contentTeamName: string
  office: string
  customerLevel: string
  customerTags: string[]
  assistantMembers: string[]
  executionMembers: string[]
  acceptanceCriteria: string
  projectTypes: string[]
  intentBrand: number
  intentContent: number
  intentSearch: number
  platforms: string[]
  detectionPlatforms: string[]
  monitoringIntentCount: number
  renewalStatus: "" | "yes" | "no"
  kpiNotes: string
  startDate?: string | null
  plannedStartDate?: string | null
  sowEndDate?: string | null
  originalDeliveryDate?: string | null
  latestDeliveryDate?: string | null
  actualDeliveryDate?: string | null
  delayReason: string
  remediationPlan: string
  delayCustomerNote: string
  createdAt: string
  updatedAt: string
  createdBy?: string | null
  updatedBy?: string | null
  archivedAt?: string | null
  intentTotal: number
  daysToSowEnd?: number | null
  delayDurationDays?: number | null
  renewalWarning: boolean
  overdue: boolean
  deliveryDelayDays: number
}

export type ProjectNote = {
  id: string
  projectId: string
  kind: ProjectNoteKind
  content: string
  createdAt: string
  createdBy: string
  createdByUserId?: string | null
}

export type ProjectAttachment = {
  id: string
  name: string
  size: number
  url: string
  contentType: "application/pdf" | string
  storagePath?: string | null
  uploadedAt: string
  uploadedBy: string
}

export type ProjectSowClause = {
  title: string
  content: string
}

export type ProjectSowVersion = {
  id: string
  projectId: string
  versionNo: number
  isCurrent: boolean
  sowEndDate: string
  projectTypes: string[]
  platforms: string[]
  optimizationIntentCount: number
  optimizationTarget: string
  acceptanceCriteria: string
  clauses: ProjectSowClause[]
  changeReason: string
  confirmer: string
  sourceChangeId?: string | null
  createdBy: string
  createdAt: string
  virtual: boolean
}

export type ProjectSowVersions = {
  current: ProjectSowVersion
  items: ProjectSowVersion[]
}

export type CreateProjectSowVersionInput = {
  sowEndDate: string
  projectTypes: string[]
  platforms: string[]
  optimizationIntentCount: number
  optimizationTarget: string
  acceptanceCriteria: string
  clauses: ProjectSowClause[]
  changeType: string
  changeReason: string
  confirmer: string
  attachments: ProjectAttachment[]
}

export type ProjectStats = {
  active: number
  delayed: number
  renewalWarning: number
  unhealthy: number
  completed: number
}

export type PatchProjectInput = {
  name?: string
  stage?: ProjectStage
  health?: ProjectHealth
  riskLevel?: ProjectRisk
  bizOwner?: string
  projectManager?: string
  projectLeader?: string
  executor?: string
  contentOps?: string
  contentOpsMembers?: string[]
  contractAmount?: number | null
  /** 联系人由详情页拆分编辑，保存时合并到兼容旧数据的 contactInfo。 */
  contactName?: string
  contactPhone?: string
  contactWechat?: string
  contactInfo?: string
  teamName?: string
  contentTeamName?: string
  office?: string
  customerLevel?: string
  customerTags?: string[]
  assistantMembers?: string[]
  executionMembers?: string[]
  acceptanceCriteria?: string
  projectTypes?: string[]
  intentBrand?: number
  intentContent?: number
  intentSearch?: number
  optimizationIntentCount?: number
  platforms?: string[]
  detectionPlatforms?: string[]
  monitoringIntentCount?: number
  renewalStatus?: "" | "yes" | "no"
  kpiNotes?: string
  startDate?: string | null
  plannedStartDate?: string | null
  sowEndDate?: string | null
  originalDeliveryDate?: string | null
  latestDeliveryDate?: string | null
  actualDeliveryDate?: string | null
  delayReason?: string
  remediationPlan?: string
  delayCustomerNote?: string
  clearStartDate?: boolean
  clearPlannedStartDate?: boolean
  clearSowEndDate?: boolean
  clearOriginalDeliveryDate?: boolean
  clearLatestDeliveryDate?: boolean
  clearActualDeliveryDate?: boolean
}

export type ProjectWorkItemKind =
  | "task"
  | "issue"
  | "change"
  | "risk"
  | "follow_up"
  | "help"
  | "appeasement"
  | "delay"
  | "delivery"

export type ProjectWorkItem = {
  id: string
  projectId: string
  kind: ProjectWorkItemKind
  title: string
  description: string
  category: string
  status: string
  owner: string
  ownerUserId?: string | null
  dueDate?: string | null
  priority: string
  riskLevel: string
  solution: string
  occurredAt?: string | null
  resolvedAt?: string | null
  data: Record<string, unknown>
  createdBy: string
  createdByUserId?: string | null
  createdAt: string
  updatedAt: string
  overdue: boolean
}

export type ProjectWorkItemInput = Partial<Omit<ProjectWorkItem, "id" | "projectId" | "createdBy" | "createdAt" | "updatedAt" | "overdue">> & {
  kind?: ProjectWorkItemKind
  clearDueDate?: boolean
}

export type ProjectPaymentSummary = {
  contractAmount: number
  plannedAmount: number
  paidAmount: number
  outstandingAmount: number
  overdueAmount: number
  nextPaymentDate?: string | null
  status: string
  plans: Array<{
    id: string
    periodName: string
    plannedAmount: number
    plannedDate: string
    actualAmount: number
    actualPaymentDate: string
    outstandingAmount: number
    paymentStatus: string
    invoiceStatus: string
  }>
}

export type ProjectDashboard = {
  total: number
  pendingStart: number
  inTransit: number
  completed: number
  delayed: number
  delayRate: number
  officeDistribution: Record<string, number>
  customerLevelDistribution: Record<string, number>
  teamMemberDistribution: Array<{ office: string; team: string; member: string; count: number }>
  appeasementCount: number
  issueTotal: number
  issueResolved: number
  leaderAnsweredCount: number
  issueResolutionRate: number
  openIssues: number
  overdueIssues: number
  highRiskProjects: number
  taskTotal: number
  taskCompleted: number
  taskCompletionRate: number
  topBlockers: Array<{ name: string; count: number }>
  plannedPaymentAmount: number
  paidAmount: number
  outstandingAmount: number
  overduePaymentAmount: number
  drilldowns: Record<string, ProjectDashboardDrilldownRow[]>
  generatedAt: string
}

export type ProjectDashboardDrilldownRow = {
  rowType: "project" | "workItem" | "payment"
  projectId: string
  projectName: string
  customerName: string
  owner?: string
  office?: string
  status: string
  title?: string
  category?: string
  date?: string
  plannedStartDate?: string
  plannedDate?: string
  actualDate?: string
  amount?: number
  delayDays?: number
  detail?: string
  overdue?: boolean
  periodName?: string
  teamName?: string
  customerLevel?: string
  responder?: string
  reviewer?: string
  leaderAnswered?: boolean
  plannedAmount?: number
  actualAmount?: number
  outstandingAmount?: number
  invoiceStatus?: string
}

export type ProjectReport = {
  period: "week" | "month"
  title: string
  generatedAt: string
  content: string
}
