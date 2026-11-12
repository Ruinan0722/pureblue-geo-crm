"use client"

import { CustomerList } from "@/modules/crm/components/customer-list"

export function CustomersPage() {
  return (
    <div>
      <div className="px-5 py-6 lg:px-8">
        <CustomerList />
      </div>
    </div>
  )
}
