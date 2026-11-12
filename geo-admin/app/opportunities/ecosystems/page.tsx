import { redirect } from "next/navigation"
import { requireCrmSection } from "@/modules/crm/lib/require-section"
export default async function Page({ searchParams }: { searchParams: Promise<{ opportunity?: string }> }) {
  await requireCrmSection("opportunities")
  const query = await searchParams
  redirect(query.opportunity ? "/opportunities/" + encodeURIComponent(query.opportunity) : "/opportunities?businessType=strategic_ecosystem")
}
