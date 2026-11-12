import { PublicPoolPage } from "@/modules/public-pool"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("public_pool")
  return <PublicPoolPage />
}
