import { NotificationsPage } from "@/modules/crm/components/notifications-page"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("notifications")
  return <NotificationsPage />
}
