import { CustomerDetailPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmSection("customers")
  const { id } = await params
  return <CustomerDetailPage id={id} />
}
