import type {
  TeamCollaborationState,
  TeamEntityType,
  TeamMemberRole,
  TeamPermission,
} from "@/modules/crm/lib/team-collaboration"
import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

function basePath(entityType: TeamEntityType, entityId: string) {
  return `/api/crm/team-collaboration/${entityType}/${encodeURIComponent(entityId)}`
}

export async function fetchTeamCollaboration(entityType: TeamEntityType, entityId: string): Promise<TeamCollaborationState> {
  const response = await fetch(basePath(entityType, entityId), { credentials: "include", cache: "no-store" })
  if (!response.ok) throw new Error(await readError(response, "加载协作团队失败"))
  return response.json() as Promise<TeamCollaborationState>
}

export async function addTeamCollaborationMembers(
  entityType: TeamEntityType,
  entityId: string,
  members: Array<{ userId: string; role: TeamMemberRole; permission: TeamPermission }>,
): Promise<TeamCollaborationState> {
  const response = await fetch(`${basePath(entityType, entityId)}/members`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members }),
  })
  if (!response.ok) throw new Error(await readError(response, "添加协作成员失败"))
  return response.json() as Promise<TeamCollaborationState>
}

export async function updateTeamCollaborationPermission(
  entityType: TeamEntityType,
  entityId: string,
  memberId: string,
  permission: TeamPermission,
): Promise<TeamCollaborationState> {
  const response = await fetch(`${basePath(entityType, entityId)}/members/${encodeURIComponent(memberId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission }),
  })
  if (!response.ok) throw new Error(await readError(response, "调整成员权限失败"))
  return response.json() as Promise<TeamCollaborationState>
}

export async function removeTeamCollaborationMember(
  entityType: TeamEntityType,
  entityId: string,
  memberId: string,
): Promise<TeamCollaborationState> {
  const response = await fetch(`${basePath(entityType, entityId)}/members/${encodeURIComponent(memberId)}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!response.ok) throw new Error(await readError(response, "移除协作成员失败"))
  return response.json() as Promise<TeamCollaborationState>
}
