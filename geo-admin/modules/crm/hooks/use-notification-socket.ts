"use client"

import { useEffect, useRef } from "react"
import {
  buildNotificationWsUrl,
  fetchNotificationWsTicket,
} from "@/modules/crm/services/crm-directory"

type UnreadPayload = {
  type?: string
  unreadCount?: number
  latestId?: string
}

/**
 * 订阅通知 WebSocket：未读数/最新 id 变化时回调，由调用方刷新列表。
 * 断线自动重连（指数退避，上限 30s）。
 */
export function useNotificationSocket(
  enabled: boolean,
  onUnreadChange: (payload: { unreadCount: number; latestId: string }) => void,
) {
  const onChangeRef = useRef(onUnreadChange)
  onChangeRef.current = onUnreadChange

  useEffect(() => {
    if (!enabled) return

    let closed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let attempt = 0
    let lastLatestId = ""
    let lastUnread = -1
    // 首包是连接后的基线快照；列表已由 mount 时的 HTTP 拉取，避免立刻再打一次 notifications
    let baselinePrimed = false

    async function connect() {
      if (closed) return
      try {
        const { ticket } = await fetchNotificationWsTicket()
        if (closed) return
        const url = buildNotificationWsUrl(ticket)
        socket = new WebSocket(url)

        socket.onopen = () => {
          attempt = 0
        }

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data || "{}")) as UnreadPayload
            if (data.type !== "unread") return
            const unreadCount = Number(data.unreadCount ?? 0)
            const latestId = String(data.latestId || "")
            if (!baselinePrimed) {
              baselinePrimed = true
              lastLatestId = latestId
              lastUnread = unreadCount
              return
            }
            // 未读数或最新通知变化都刷新（含「全部已读」后 latest 不变、仅 count 变）
            if (latestId === lastLatestId && unreadCount === lastUnread) return
            lastLatestId = latestId
            lastUnread = unreadCount
            onChangeRef.current({ unreadCount, latestId })
          } catch {
            /* ignore malformed */
          }
        }

        socket.onclose = () => {
          socket = null
          if (closed) return
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 4))
          attempt += 1
          reconnectTimer = window.setTimeout(() => {
            void connect()
          }, delay)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch {
        if (closed) return
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 4))
        attempt += 1
        reconnectTimer = window.setTimeout(() => {
          void connect()
        }, delay)
      }
    }

    void connect()

    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [enabled])
}
