import { ContractDetailPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmSection("contracts")
  const { id } = await params
  return <ContractDetailPage id={id} />
}
