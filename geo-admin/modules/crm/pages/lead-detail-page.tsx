"use client"

import { LeadDetail } from "@/modules/crm/components/lead-detail"

export function LeadDetailPage({ id }: { id: string }) {
  return (
    <div>
      <LeadDetail id={id} />
    </div>
  )
}
