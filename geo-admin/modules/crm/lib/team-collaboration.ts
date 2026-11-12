export type TeamEntityType = "customer" | "opportunity"
export type TeamPermission = "read" | "edit"
export type TeamMemberRole = "销售" | "解决方案" | "客户成功" | "管理者" | "其他协作"

export type TeamMember = {
  id: string
  userId?: string
  name: string
  department: string
  role: TeamMemberRole
  permission: TeamPermission
  addedAt: string
  addedBy: string
}

export type TeamActivity = {
  id: string
  action: "add" | "remove" | "permission"
  operator: string
  memberName: string
  detail: string
  createdAt: string
}

export type TeamCollaborationState = {
  members: TeamMember[]
  activities: TeamActivity[]
}

export type InitialTeamMember = Pick<TeamMember, "name" | "department" | "role" | "permission"> & {
  userId?: string
}

export const TEAM_ROLE_OPTIONS: TeamMemberRole[] = ["销售", "解决方案", "客户成功", "管理者", "其他协作"]

export function teamPermissionLabel(permission: TeamPermission) {
  return permission === "edit" ? "可编辑" : "只读"
}

function storageKey(entityType: TeamEntityType, entityId: string) {
  return `geo-admin:team-collaboration:v1:${entityType}:${entityId}`
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false })
}

function memberId(name: string) {
  return `team-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function createInitialTeamState(initialMembers: InitialTeamMember[], operator = "系统"): TeamCollaborationState {
  const seen = new Set<string>()
  const members = initialMembers
    .filter((item) => {
      const name = item.name.trim()
      if (!name || seen.has(name)) return false
      seen.add(name)
      return true
    })
    .map((item) => ({
      ...item,
      id: memberId(item.name),
      name: item.name.trim(),
      addedAt: nowText(),
      addedBy: operator,
    }))
  return { members, activities: [] }
}

export function loadTeamState(
  entityType: TeamEntityType,
  entityId: string,
  initialMembers: InitialTeamMember[] = [],
): TeamCollaborationState {
  if (typeof window === "undefined") return createInitialTeamState(initialMembers)
  const key = storageKey(entityType, entityId)
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as TeamCollaborationState
      if (Array.isArray(parsed.members) && Array.isArray(parsed.activities)) return parsed
    }
  } catch {
    // 本地演示数据损坏时回退到业务字段推导的初始成员。
  }
  const initial = createInitialTeamState(initialMembers)
  window.localStorage.setItem(key, JSON.stringify(initial))
  return initial
}

export function saveTeamState(entityType: TeamEntityType, entityId: string, state: TeamCollaborationState) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(storageKey(entityType, entityId), JSON.stringify(state))
}

export function createTeamMember(
  input: Omit<TeamMember, "id" | "addedAt" | "addedBy">,
  operator: string,
): TeamMember {
  return {
    ...input,
    id: memberId(input.name),
    addedAt: nowText(),
    addedBy: operator,
  }
}

export function createTeamActivity(
  action: TeamActivity["action"],
  operator: string,
  memberName: string,
  detail: string,
): TeamActivity {
  return {
    id: `team-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    operator,
    memberName,
    detail,
    createdAt: nowText(),
  }
}
