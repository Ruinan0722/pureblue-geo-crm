import { redirect } from "next/navigation"
import { OpportunitiesPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; businessType?: string; opportunity?: string }> }) {
  await requireCrmSection("opportunities")
  const query = await searchParams
  if (query.opportunity) redirect("/opportunities/" + encodeURIComponent(query.opportunity))
  return <OpportunitiesPage initialBusinessType={query.businessType ?? (query.view === "channel" ? "channel" : undefined)} />
}
