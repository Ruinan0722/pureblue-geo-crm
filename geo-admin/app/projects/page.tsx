import { ProjectsDeliveryPage } from "@/modules/projects"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("projects")
  return <ProjectsDeliveryPage />
}
