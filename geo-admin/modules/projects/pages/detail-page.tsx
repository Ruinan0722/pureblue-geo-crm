"use client"

import { ProjectDetail } from "@/modules/projects/components/project-detail"

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  return <ProjectDetail projectId={projectId} />
}
