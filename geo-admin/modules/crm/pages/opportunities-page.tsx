"use client"
import { OpportunityBoard } from "@/modules/crm/components/opportunity-board"
export function OpportunitiesPage({ initialBusinessType }: { initialBusinessType?: string }) {
  return <div className="flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col overflow-y-auto lg:h-dvh"><div className="min-h-0 min-w-0 flex-1 px-5 py-2 lg:px-8"><OpportunityBoard initialBusinessType={initialBusinessType} /></div></div>
}
