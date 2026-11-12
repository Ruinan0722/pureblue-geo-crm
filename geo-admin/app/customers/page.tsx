import { CustomersPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("customers")
  return <CustomersPage />
}
