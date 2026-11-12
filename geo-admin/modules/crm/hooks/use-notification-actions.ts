"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"
import type { CrmNotification } from "@/modules/crm/lib/crm-data"
import {
  markAllNotificationsRead as apiMarkAllNotificationsRead,
  markNotificationRead as apiMarkNotificationRead,
} from "@/modules/crm/services/crm-directory"

export interface NotificationActionsDeps {
  setNotifications: Dispatch<SetStateAction<CrmNotification[]>>
}

export function useNotificationActions(deps: NotificationActionsDeps) {
  const { setNotifications } = deps

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)))
    void apiMarkNotificationRead(id).catch(() => undefined)
  }, [])

  const markAllNotificationsRead = useCallback((targetName?: string) => {
    setNotifications((prev) =>
      prev.map((item) => (!targetName || item.targetName === targetName ? { ...item, read: true } : item)),
    )
    void apiMarkAllNotificationsRead().catch(() => undefined)
  }, [])

  return { markNotificationRead, markAllNotificationsRead }
}
