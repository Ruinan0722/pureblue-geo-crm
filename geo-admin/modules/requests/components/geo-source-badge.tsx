import { cn } from "@/shared/lib/utils"
import {
  REQUEST_GEO_SOURCE_META,
  resolveRequestGeoSource,
} from "@/modules/requests/lib/geo-source"
import type { RequestRecord } from "@/modules/requests/lib/types"

export function GeoSourceBadge({
  record,
  className,
  fullLabel = false,
}: {
  record: Pick<RequestRecord, "code" | "data">
  className?: string
  /** 列表筛选场景用完整文案，便于一眼区分国内/海外 */
  fullLabel?: boolean
}) {
  const source = resolveRequestGeoSource(record)
  const meta = REQUEST_GEO_SOURCE_META[source]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        meta.tone,
        className,
      )}
      title={meta.label}
    >
      {fullLabel ? meta.label : meta.shortLabel}
    </span>
  )
}
