import { LoginPage } from "@/modules/auth"
import { isFeishuConfigured } from "@/modules/auth/lib/feishu"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  return <LoginPage initialFeishuConfigured={isFeishuConfigured()} error={params.error ?? null} />
}
