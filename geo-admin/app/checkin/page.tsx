import { CheckinPage } from "@/modules/checkin"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("checkin")
  return <CheckinPage />
}
