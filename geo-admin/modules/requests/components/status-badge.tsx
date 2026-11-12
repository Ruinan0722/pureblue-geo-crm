import { cn } from "@/shared/lib/utils"
import { STATUS_META, type RequestStatus } from "../lib/status"

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  muted: "bg-secondary text-secondary-foreground ring-border",
  info: "bg-accent text-accent-foreground ring-accent-foreground/15",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
}

export function StatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {meta.label}
    </span>
  )
}
