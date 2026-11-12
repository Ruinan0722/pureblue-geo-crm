"use client"

import { useMemo } from "react"
import { LogIn, LogOut } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

interface VisitCheckInPanelProps {
  activeVisitId: string | null
  isLoading: boolean
  message: string
  status: "idle" | "loading" | "success" | "error"
  requiresPhoto: boolean
  hasPhoto: boolean
  locationUsable: boolean
  onCheckIn: () => void
}

export function VisitCheckInPanel({
  activeVisitId,
  isLoading,
  message,
  status,
  requiresPhoto,
  hasPhoto,
  locationUsable,
  onCheckIn,
}: VisitCheckInPanelProps) {
  const isLeaving = Boolean(activeVisitId)
  const missingPhoto = requiresPhoto && !hasPhoto
  const locationBlocked = !locationUsable

  const hint = useMemo(() => {
    if (locationBlocked) {
      return "尚未获取到定位，请开启定位服务、尝试关闭 VPN 后重新获取"
    }
    if (!activeVisitId) {
      return missingPhoto ? "请先上传现场照片，再点击到达打卡" : "到达客户现场后，点击下方按钮开始记录"
    }
    return "拜访结束后，点击下方按钮完成本次记录"
  }, [activeVisitId, locationBlocked, missingPhoto])

  const buttonLabel = isLoading ? "处理中…" : isLeaving ? "结束打卡" : "到达打卡"

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-center text-sm text-muted-foreground">{hint}</p>

      <Button
        type="button"
        size="lg"
        variant={isLeaving ? "secondary" : "default"}
        className={cn("mt-4 h-14 w-full text-base font-semibold", isLeaving && "border-violet-500/30")}
        onClick={onCheckIn}
        disabled={isLoading || missingPhoto || locationBlocked}
      >
        {isLeaving ? <LogOut className="size-5" /> : <LogIn className="size-5" />}
        {buttonLabel}
      </Button>

      {message && status === "error" && (
        <p className="mt-4 text-center text-sm text-destructive" role="status">
          {message}
        </p>
      )}
      {message && status === "loading" && (
        <p className="mt-4 text-center text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
