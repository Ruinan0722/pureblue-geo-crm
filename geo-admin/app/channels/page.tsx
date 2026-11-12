import { ChannelManagementPage } from "@/modules/crm"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("channels")
  return <ChannelManagementPage />
}
