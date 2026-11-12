import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import type { IntakeSubmissionPayload, LocalSaveResponse } from "./types"

export async function saveSubmissionLocally(
  payload: IntakeSubmissionPayload,
): Promise<LocalSaveResponse> {
  const response = await fetch("/api/intake/local-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(parseApiErrorMessage(body, "本地备份失败，请稍后重试"))
  }
  return body as LocalSaveResponse
}
