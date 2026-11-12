import { NeedLinkPage } from "@/modules/intake"

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  return <NeedLinkPage reason={reason} />
}
