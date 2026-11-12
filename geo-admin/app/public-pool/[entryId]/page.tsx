import { PublicPoolDetailPage } from "@/modules/public-pool/components/public-pool-detail-page"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ entryId: string }> }) {
  await requireCrmSection("public_pool")
  const { entryId } = await params
  return <PublicPoolDetailPage entryId={entryId} />
}
