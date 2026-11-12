import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import type {
  PatchProjectInput,
  CreateProjectSowVersionInput,
  ProjectAttachment,
  ProjectDashboard,
  ProjectNote,
  ProjectNoteKind,
  ProjectPaymentSummary,
  ProjectRecord,
  ProjectReport,
  ProjectStats,
  ProjectSowVersions,
  ProjectWorkItem,
  ProjectWorkItemInput,
  ProjectWorkItemKind,
} from "@/modules/projects/lib/types"

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

async function requestJson<T>(url: string, init?: RequestInit, fallback = "请求失败"): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(await readError(res, fallback))
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export class ProjectApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ProjectApiError"
  }
}

export type ProjectListFilters = {
  view?: "active" | "archive"
  keyword?: string
  stage?: string
  health?: string
  riskLevel?: string
  office?: string
  renewalWarning?: boolean
  mineOnly?: boolean
  amountMin?: number
  amountMax?: number
  sowFrom?: string
  sowTo?: string
  updatedFrom?: string
  updatedTo?: string
  dueDaysMin?: number
  dueDaysMax?: number
}

export async function fetchProjects(filters: ProjectListFilters = {}): Promise<{
  items: ProjectRecord[]
  total: number
}> {
  const qs = new URLSearchParams()
  qs.set("view", filters.view || "active")
  if (filters.keyword?.trim()) qs.set("keyword", filters.keyword.trim())
  if (filters.stage && filters.stage !== "all") qs.set("stage", filters.stage)
  if (filters.health && filters.health !== "all") qs.set("health", filters.health)
  if (filters.riskLevel && filters.riskLevel !== "all") qs.set("riskLevel", filters.riskLevel)
  if (filters.office && filters.office !== "all") qs.set("office", filters.office)
  if (filters.renewalWarning) qs.set("renewalWarning", "true")
  if (filters.mineOnly) qs.set("mineOnly", "true")
  if (filters.amountMin != null) qs.set("amountMin", String(filters.amountMin))
  if (filters.amountMax != null) qs.set("amountMax", String(filters.amountMax))
  if (filters.sowFrom) qs.set("sowFrom", filters.sowFrom)
  if (filters.sowTo) qs.set("sowTo", filters.sowTo)
  if (filters.updatedFrom) qs.set("updatedFrom", filters.updatedFrom)
  if (filters.updatedTo) qs.set("updatedTo", filters.updatedTo)
  if (filters.dueDaysMin != null) qs.set("dueDaysMin", String(filters.dueDaysMin))
  if (filters.dueDaysMax != null) qs.set("dueDaysMax", String(filters.dueDaysMax))
  return requestJson(`/api/projects?${qs.toString()}`, undefined, "加载项目列表失败")
}

export async function fetchProjectStats(view: "active" | "archive" = "active"): Promise<ProjectStats> {
  return requestJson(`/api/projects/stats?view=${view}`, undefined, "加载项目统计失败")
}

export async function fetchProjectDashboard(): Promise<ProjectDashboard> {
  return requestJson("/api/projects/dashboard", undefined, "加载项目看板失败")
}

export async function fetchProjectReport(period: "week" | "month"): Promise<ProjectReport> {
  return requestJson(`/api/projects/reports/auto?period=${period}`, undefined, "生成项目报告失败")
}

export async function fetchProject(id: string): Promise<ProjectRecord> {
  return requestJson(`/api/projects/${encodeURIComponent(id)}`, undefined, "加载项目详情失败")
}

export async function fetchProjectByContract(contractId: string): Promise<ProjectRecord | null> {
  const res = await fetch(`/api/projects/by-contract/${encodeURIComponent(contractId)}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (res.status === 404) return null
  if (!res.ok) throw new ProjectApiError(res.status, await readError(res, "加载关联项目失败"))
  return res.json() as Promise<ProjectRecord>
}

export async function fetchProjectsByCustomer(customerId: string): Promise<ProjectRecord[]> {
  const res = await fetch(`/api/projects/by-customer/${encodeURIComponent(customerId)}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (!res.ok) {
    throw new ProjectApiError(res.status, await readError(res, "加载客户关联项目失败"))
  }
  const data = (await res.json()) as { items: ProjectRecord[]; total: number }
  return data.items || []
}

export async function patchProject(id: string, body: PatchProjectInput): Promise<ProjectRecord> {
  return requestJson(
    `/api/projects/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    "保存项目失败",
  )
}

export async function fetchProjectAttachments(projectId: string): Promise<ProjectAttachment[]> {
  const data = await requestJson<{ items: ProjectAttachment[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/attachments`,
    undefined,
    "加载项目附件失败",
  )
  return data.items || []
}

export async function uploadProjectAttachments(
  projectId: string,
  files: File[],
): Promise<ProjectAttachment[]> {
  const form = new FormData()
  files.forEach((file) => form.append("files", file, file.name))
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/attachments`, {
    method: "POST",
    credentials: "include",
    body: form,
  })
  if (!res.ok) throw new Error(await readError(res, "上传项目附件失败"))
  const data = (await res.json()) as { items?: ProjectAttachment[] }
  return data.items || []
}

export async function fetchProjectSowVersions(projectId: string): Promise<ProjectSowVersions> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/sow-versions`,
    undefined,
    "加载 SOW 版本失败",
  )
}

export async function createProjectSowVersion(
  projectId: string,
  body: CreateProjectSowVersionInput,
): Promise<ProjectSowVersions> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/sow-versions`,
    { method: "POST", body: JSON.stringify(body) },
    "发布 SOW 新版本失败",
  )
}

export async function fetchProjectNotes(
  id: string,
  kind?: ProjectNoteKind | "all",
): Promise<ProjectNote[]> {
  const qs = kind && kind !== "all" ? `?kind=${encodeURIComponent(kind)}` : ""
  const data = await requestJson<{ items: ProjectNote[] }>(
    `/api/projects/${encodeURIComponent(id)}/notes${qs}`,
    undefined,
    "加载项目记录失败",
  )
  return data.items || []
}

export async function createProjectNote(
  id: string,
  body: { kind: ProjectNoteKind; content: string },
): Promise<ProjectNote> {
  return requestJson(
    `/api/projects/${encodeURIComponent(id)}/notes`,
    { method: "POST", body: JSON.stringify(body) },
    "发布记录失败",
  )
}

export async function deleteProjectNote(projectId: string, noteId: string): Promise<void> {
  await requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE" },
    "删除记录失败",
  )
}

export async function fetchProjectWorkItems(
  projectId: string,
  kind?: ProjectWorkItemKind,
): Promise<ProjectWorkItem[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ""
  const data = await requestJson<{ items: ProjectWorkItem[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/work-items${qs}`,
    undefined,
    "加载项目事项失败",
  )
  return data.items || []
}

export async function fetchProjectProblemPool(keyword = ""): Promise<ProjectWorkItem[]> {
  const qs = keyword.trim() ? `?keyword=${encodeURIComponent(keyword.trim())}` : ""
  const data = await requestJson<{ items: ProjectWorkItem[] }>(
    `/api/projects/problem-pool${qs}`,
    undefined,
    "加载问题池失败",
  )
  return data.items || []
}

export async function createProjectWorkItem(
  projectId: string,
  body: ProjectWorkItemInput,
): Promise<ProjectWorkItem> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/work-items`,
    { method: "POST", body: JSON.stringify(body) },
    "新增项目事项失败",
  )
}

export async function patchProjectWorkItem(
  projectId: string,
  itemId: string,
  body: ProjectWorkItemInput,
): Promise<ProjectWorkItem> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    "更新项目事项失败",
  )
}

export async function deleteProjectWorkItem(projectId: string, itemId: string): Promise<void> {
  await requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
    "删除项目事项失败",
  )
}

export async function fetchProjectPaymentSummary(projectId: string): Promise<ProjectPaymentSummary> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/payments`,
    undefined,
    "加载项目回款数据失败",
  )
}
