import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { IntakeForm } from "@/modules/intake"
import { INVITE_COOKIE } from "@/modules/auth/lib/constants"

export const metadata: Metadata = {
  title: "国内 GEO 需求填报",
  description: "请通过项目顾问提供的专属链接填写国内 GEO 优化需求。",
}

export default async function IntakeDomesticPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(INVITE_COOKIE)?.value
  if (!token) {
    redirect("/?reason=invalid")
  }

  return <IntakeForm inviteToken={token} variant="domestic" />
}
