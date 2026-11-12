"use client"

import { OpportunityDetail } from "@/modules/crm/components/opportunity-detail"

export function OpportunityDetailPage({ id }: { id: string }) {
  return (
    <div>
      <OpportunityDetail id={id} />
    </div>
  )
}
