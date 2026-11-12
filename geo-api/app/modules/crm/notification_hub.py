"""CRM 通知 WebSocket 连接管理（进程内 + Redis Pub/Sub 跨 worker）。"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

# Redis 正常：兜底 10s；Redis down：2s
_POLL_INTERVAL_REDIS_UP = 10.0
_POLL_INTERVAL_REDIS_DOWN = 2.0


class NotificationHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[user_id].add(websocket)

    async def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(user_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    async def publish(self, user_id: str | None, payload: dict[str, Any]) -> None:
        if not user_id:
            return
        async with self._lock:
            sockets = list(self._connections.get(user_id, ()))
        if not sockets:
            return
        message = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(message)
                else:
                    dead.append(ws)
            except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
                dead.append(ws)
        for ws in dead:
            await self.disconnect(user_id, ws)

    async def publish_many(self, user_ids: set[str], payload: dict[str, Any]) -> None:
        for user_id in user_ids:
            await self.publish(user_id, payload)


notification_hub = NotificationHub()


async def run_notification_socket(
    *,
    websocket: WebSocket,
    user_id: str,
    user_name: str,
    poll_unread: Callable[..., Awaitable[tuple[int, str | None]]],
) -> None:
    """
    长连接：
    - 本地 hub / Redis Pub/Sub 即时推送
    - 兜底轮询 MySQL（Redis up: 10s；down: 2s）
    """
    from app.modules.crm.notification_cache import get_unread, set_unread

    await notification_hub.connect(user_id, websocket)
    last_unread: int | None = None
    last_latest_id: str | None = None

    cached = await get_unread(user_id)
    if cached is not None:
        last_unread, last_latest_id = cached
        await websocket.send_text(
            json.dumps(
                {
                    "type": "unread",
                    "unreadCount": last_unread,
                    "latestId": last_latest_id or "",
                },
                ensure_ascii=False,
            )
        )

    try:
        while True:
            redis_up = await get_redis().is_available()
            poll_timeout = _POLL_INTERVAL_REDIS_UP if redis_up else _POLL_INTERVAL_REDIS_DOWN

            try:
                unread, latest_id = await poll_unread(user_id=user_id, user_name=user_name)
                await set_unread(user_id, unread, latest_id)
            except Exception:
                logger.exception("notification ws poll failed user=%s", user_id)
                unread, latest_id = last_unread or 0, last_latest_id

            if unread != last_unread or latest_id != last_latest_id:
                last_unread = unread
                last_latest_id = latest_id
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "unread",
                            "unreadCount": unread,
                            "latestId": latest_id or "",
                        },
                        ensure_ascii=False,
                    )
                )

            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=poll_timeout)
            except TimeoutError:
                continue
            except WebSocketDisconnect:
                break
    finally:
        await notification_hub.disconnect(user_id, websocket)
