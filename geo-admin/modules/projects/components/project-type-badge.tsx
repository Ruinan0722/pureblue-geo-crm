import { cn } from "@/shared/lib/utils"

const TYPE_STYLE: Record<string, string> = {
  品牌曝光: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
  舆情消除: "border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-200",
  词条优化: "border-cyan-200 bg-cyan-100 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200",
  数据监控: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
}

export function ProjectTypeBadge({ type, active = true }: { type: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium",
        active ? TYPE_STYLE[type] || "border-border bg-muted text-foreground" : "border-border bg-background text-muted-foreground",
      )}
    >
      {type}
    </span>
  )
}
