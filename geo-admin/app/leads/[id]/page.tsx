import { LeadDetailPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmSection("leads")
  const { id } = await params
  return <LeadDetailPage id={id} />
}
