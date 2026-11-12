"use client"

import { useState } from "react"
import { LayoutDashboard, Rows3 } from "lucide-react"
import { ProjectList } from "@/modules/projects/components/project-list"
import { ProjectDashboard } from "@/modules/projects/components/project-dashboard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"

export function ProjectsDeliveryPage() {
  const [tab, setTab] = useState("dashboard")
  return (
    <div className="px-5 py-6 lg:px-8">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 h-auto rounded-2xl border border-border bg-card p-1.5 shadow-sm">
          <TabsTrigger value="dashboard" className="gap-2 rounded-xl px-4 py-2.5"><LayoutDashboard className="size-4" />项目看板</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-2 rounded-xl px-4 py-2.5"><Rows3 className="size-4" />项目台账</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="outline-none">
          <ProjectDashboard />
        </TabsContent>
        <TabsContent value="ledger" className="outline-none">
          <ProjectList view="active" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
