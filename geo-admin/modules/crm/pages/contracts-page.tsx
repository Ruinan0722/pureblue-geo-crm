"use client"

import { ContractList } from "@/modules/crm/components/contract-list"

export function ContractsPage() {
  return (
    <div>
      <div className="px-5 py-6 lg:px-8">
        <ContractList />
      </div>
    </div>
  )
}
