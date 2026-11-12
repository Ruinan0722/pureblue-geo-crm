"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCheck, ExternalLink } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { EmptyState } from "@/modules/crm/components/ui"
import { cn } from "@/shared/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import type { CrmNotification } from "@/modules/crm/lib/crm-data"

export function NotificationsPage() {
  const router = useRouter()
  const {
    notifications,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useCrm()
  const [detail, setDetail] = useState<CrmNotification | null>(null)

  useEffect(() => {
    void refreshNotifications()
    const timer = window.setInterval(() => {
      void refreshNotifications()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [refreshNotifications])

  const unreadCount = notifications.filter((item) => !item.read).length

  /** 打开详情：标记已读并展示完整内容（含【实体】+ 跟进内容），可再跳转实体 */
  function openNotification(item: CrmNotification) {
    setDetail(item)
    if (!item.read) void markNotificationRead(item.id)
  }

  function goToEntity(item: CrmNotification) {
    setDetail(null)
    if (item.href) router.push(item.href)
  }

  return (
    <div>
      <div className="px-5 py-6 lg:px-8">
        <div className="mb-3 flex items-center justify-end gap-2">
          {unreadCount > 0 ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => markAllNotificationsRead()}>
              <CheckCheck className="size-4" />
              全部已读
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8">
              <EmptyState text="暂无消息通知" />
            </div>
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openNotification(item)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors",
                  item.read
                    ? "border-border bg-card hover:bg-secondary/40"
                    : "border-primary/25 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    item.read ? "bg-secondary text-muted-foreground" : "bg-primary/15 text-primary",
                  )}
                >
                  <Bell className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug">
                    <span className="font-medium">{item.actor}</span>
                    <span className="text-muted-foreground"> {item.message}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.createdAt}</p>
                </div>
                {!item.read && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))
          )}
        </div>
      </div>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>通知详情</DialogTitle>
            <DialogDescription>
              {detail?.actor ? `${detail.actor} 发起` : ""}
              {detail?.createdAt ? ` · ${detail.createdAt}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed">
            {detail?.message || "—"}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              关闭
            </Button>
            {detail?.href ? (
              <Button onClick={() => goToEntity(detail)}>
                查看详情
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
