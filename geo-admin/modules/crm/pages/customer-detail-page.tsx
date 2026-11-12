"use client"

import { CustomerDetail } from "@/modules/crm/components/customer-detail"

export function CustomerDetailPage({ id }: { id: string }) {
  return (
    <div>
      <CustomerDetail id={id} />
    </div>
  )
}
