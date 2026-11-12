"use client"

import { LeadNavigation } from "@/modules/crm/components/lead-navigation"
import { LeadList } from "@/modules/crm/components/lead-list"
import { isFeatureEnabled } from "@/shared/lib/geo-features"

export function LeadsPage() {
  return (
    <div>
      {isFeatureEnabled("DEBUG_BANNERS") ? (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-5 py-2 text-xs text-amber-900 dark:text-amber-100 lg:px-8">
          联调提示：用 <strong>SDR</strong> 身份新增线索并分配「李销售」后转客户；再在侧栏切换到{" "}
          <strong>销售</strong> 继续商机。仅销售身份看不到本页（无线索权限）。
        </div>
      ) : null}
      <div className="px-5 py-6 lg:px-8">
        <LeadNavigation active="all" />
        <LeadList />
      </div>
    </div>
  )
}
