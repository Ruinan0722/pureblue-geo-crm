"use client"

import { useMemo } from "react"
import { INDUSTRIES } from "@/modules/crm/lib/crm-data"
import { TreeCheckboxFilter, type TreeFilterNode } from "./tree-checkbox-filter"

/**
 * 行业筛选：一级行业 + 二级行业级联勾选。
 * 复用通用勾选树弹层，与线索「来源」筛选 UI 完全一致。
 */
export function IndustryFilter({
  industry,
  industryDetail,
  onValuesChange,
  className,
}: {
  industry: string[]
  industryDetail: string[]
  onValuesChange: (industry: string[], industryDetail: string[]) => void
  className?: string
}) {
  const tree = useMemo<TreeFilterNode[]>(
    () =>
      Object.entries(INDUSTRIES).map(([l1, l2s]) => ({
        value: l1,
        label: l1,
        children: l2s.map((v) => ({ value: v, label: v })),
      })),
    [],
  )

  return (
    <TreeCheckboxFilter
      tree={tree}
      primary={industry}
      secondary={industryDetail}
      onValuesChange={onValuesChange}
      searchPlaceholder="搜索行业"
      allPlaceholder="全部行业（可勾选一级/二级）"
      className={className}
    />
  )
}
