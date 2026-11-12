"use client"

import { ContractDetail } from "@/modules/crm/components/contract-detail"

export function ContractDetailPage({ id }: { id: string }) {
  return (
    <div>
      <ContractDetail id={id} />
    </div>
  )
}
