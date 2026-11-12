import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"

export type FollowUpComment = {
  id: string
  followUpId: string
  authorUserId?: string | null
  authorName: string
  authorRole: "leader" | "sales"
  content: string
  createdAt: string
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}))
  return parseApiErrorMessage(data) || fallback
}

export async function fetchFollowUpComments(followUpId: string): Promise<FollowUpComment[]> {
  const response = await fetch(`/api/crm/follow-up-comments?followUpId=${encodeURIComponent(followUpId)}`, {
    credentials: "include",
    cache: "no-store",
  })
  if (!response.ok) throw new Error(await readError(response, "加载评论失败"))
  const data = (await response.json()) as { items?: FollowUpComment[] }
  return Array.isArray(data.items) ? data.items : []
}

export async function createFollowUpComment(followUpId: string, content: string): Promise<FollowUpComment> {
  const response = await fetch("/api/crm/follow-up-comments", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ followUpId, content }),
  })
  if (!response.ok) throw new Error(await readError(response, "发送评论失败"))
  return response.json() as Promise<FollowUpComment>
}
