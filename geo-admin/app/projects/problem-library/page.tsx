import { ProjectProblemLibrary } from "@/modules/projects/components/project-problem-library"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  await requireCrmSection("projects")
  return <ProjectProblemLibrary />
}
