"use client"

import { cn } from "@/shared/lib/utils"

export function MineOnlyToggle({
  value,
  onChange,
  className,
  disabled = false,
}: {
  value: boolean
  onChange: (next: boolean) => void
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        onChange(!value)
      }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
        value
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          value ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform",
            value ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      只看自己
    </button>
  )
}
