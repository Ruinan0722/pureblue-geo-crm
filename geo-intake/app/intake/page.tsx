import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { IntakeForm } from "@/modules/intake"
import { INVITE_COOKIE } from "@/modules/auth/lib/constants"

export default async function IntakeOverseasPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(INVITE_COOKIE)?.value
  if (!token) {
    redirect("/?reason=invalid")
  }

  return <IntakeForm inviteToken={token} variant="overseas" />
}
