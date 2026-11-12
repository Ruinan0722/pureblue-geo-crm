"""通知未读计数缓存 + Pub/Sub（见 docs/modules/redis-cache.md）。"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

NTF_CHANNEL_PARTS = ("ntf", "channel")
_UNREAD_TTL = 300

_subscriber_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None


async def get_unread(user_id: str) -> tuple[int, str | None] | None:
    """命中返回 (count, latestId)；miss 返回 None。"""
    if not user_id:
        return None
    redis = get_redis()
    raw = await redis.cache_get("ntf", "unread", user_id)
    if raw is None:
        return None
    if isinstance(raw, dict):
        try:
            count = int(raw.get("unreadCount", 0))
        except (TypeError, ValueError):
            return None
        latest = raw.get("latestId") or ""
        return count, str(latest) if latest else None
    try:
        return int(raw), None
    except (TypeError, ValueError):
        return None


async def set_unread(user_id: str, unread_count: int, latest_id: str | None = None) -> bool:
    if not user_id:
        return False
    return await get_redis().cache_set(
        "ntf",
        "unread",
        user_id,
        value={"unreadCount": int(unread_count), "latestId": latest_id or ""},
        ttl=_UNREAD_TTL,
    )


async def publish_unread(user_id: str, unread_count: int, latest_id: str | None = None) -> bool:
    payload = {
        "type": "unread",
        "userId": user_id,
        "unreadCount": int(unread_count),
        "latestId": latest_id or "",
    }
    return await get_redis().publish(NTF_CHANNEL_PARTS, payload)


async def set_and_publish_unread(
    user_id: str,
    unread_count: int,
    latest_id: str | None = None,
) -> bool:
    """写入未读缓存并 PUBLISH。返回 Pub/Sub 是否成功（失败时调用方应本地 hub 兜底）。"""
    await set_unread(user_id, unread_count, latest_id)
    return await publish_unread(user_id, unread_count, latest_id)


async def _handle_pubsub_message(data: dict[str, Any]) -> None:
    from app.modules.crm.notification_hub import notification_hub

    user_id = str(data.get("userId") or "")
    if not user_id:
        return
    await notification_hub.publish(
        user_id,
        {
            "type": "unread",
            "unreadCount": int(data.get("unreadCount") or 0),
            "latestId": str(data.get("latestId") or ""),
        },
    )


async def _subscriber_loop(stop: asyncio.Event) -> None:
    redis = get_redis()
    channel = redis.key(*NTF_CHANNEL_PARTS)
    while not stop.is_set():
        if not redis.enabled:
            try:
                await asyncio.wait_for(stop.wait(), timeout=5.0)
            except TimeoutError:
                continue
            break

        pubsub = redis.pubsub()
        if pubsub is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=5.0)
            except TimeoutError:
                continue
            continue

        try:
            await pubsub.subscribe(channel)
            logger.info("notification pubsub subscribed channel=%s", channel)
            while not stop.is_set():
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                except Exception:
                    logger.exception("notification pubsub get_message failed; reconnecting")
                    break
                if not message:
                    await asyncio.sleep(0.05)
                    continue
                raw = message.get("data")
                if not raw:
                    continue
                try:
                    data = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(data, dict):
                        await _handle_pubsub_message(data)
                except Exception:
                    logger.exception("notification pubsub handle failed")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("notification pubsub loop error; retry in 2s")
            try:
                await asyncio.wait_for(stop.wait(), timeout=2.0)
            except TimeoutError:
                pass
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
                pass


async def start_notification_subscriber() -> None:
    global _subscriber_task, _stop_event
    if _subscriber_task and not _subscriber_task.done():
        return
    _stop_event = asyncio.Event()
    _subscriber_task = asyncio.create_task(_subscriber_loop(_stop_event), name="ntf-pubsub")


async def stop_notification_subscriber() -> None:
    global _subscriber_task, _stop_event
    if _stop_event is not None:
        _stop_event.set()
    if _subscriber_task is not None:
        _subscriber_task.cancel()
        try:
            await _subscriber_task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("stop notification subscriber failed")
    _subscriber_task = None
    _stop_event = None
