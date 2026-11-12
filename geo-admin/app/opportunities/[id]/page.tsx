import { OpportunityDetailPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmSection("opportunities")
  const { id } = await params
  return <OpportunityDetailPage id={id} />
}
