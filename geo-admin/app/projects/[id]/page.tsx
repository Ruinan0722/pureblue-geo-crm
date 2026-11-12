import { ProjectDetailPage } from "@/modules/projects"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCrmSection("projects")
  const { id } = await params
  return <ProjectDetailPage projectId={id} />
}
