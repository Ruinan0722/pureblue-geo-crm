import Image from "next/image"
import { cn } from "@/shared/lib/utils"

/** Shared vector brand mark for Flow, including collapsed and mobile navigation. */
export function FlowIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/flow-icon.svg"
      alt="Flow"
      width={128}
      height={128}
      unoptimized
      className={cn("size-8 shrink-0 rounded-[13.3%]", className)}
    />
  )
}
