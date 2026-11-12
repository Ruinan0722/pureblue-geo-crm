"use client"

import { ProjectList } from "@/modules/projects/components/project-list"

export function ProjectsArchivePage() {
  return (
    <div>
      <div className="px-5 py-6 lg:px-8">
        <ProjectList view="archive" />
      </div>
    </div>
  )
}
