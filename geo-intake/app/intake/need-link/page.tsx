import { redirect } from "next/navigation"

/** 兼容旧地址，统一回到首页提示页（非填报入口） */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  redirect(reason ? `/?reason=${reason}` : "/")
}
