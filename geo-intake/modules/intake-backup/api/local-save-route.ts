import { NextResponse } from "next/server"
import { saveIntakeSubmission } from "../lib/database"
import type { IntakeSubmissionPayload, LocalSaveResponse } from "../lib/types"

export const runtime = "nodejs"

function isSubmissionPayload(value: unknown): value is IntakeSubmissionPayload {
  if (!value || typeof value !== "object") return false
  const body = value as Partial<IntakeSubmissionPayload>
  return (
    !!body.data &&
    typeof body.data === "object" &&
    !Array.isArray(body.data) &&
    body.status === "submitted" &&
    typeof body.inviteToken === "string" &&
    body.inviteToken.trim().length > 0
  )
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求数据格式错误" }, { status: 400 })
  }

  if (!isSubmissionPayload(body)) {
    return NextResponse.json({ error: "缺少完整的提交数据或邀请凭证" }, { status: 400 })
  }

  try {
    const response: LocalSaveResponse = {
      saved: true,
      localSubmissionId: saveIntakeSubmission(body),
    }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error("intake local backup failed", error)
    return NextResponse.json({ error: "本地备份失败，请稍后重试" }, { status: 500 })
  }
}
