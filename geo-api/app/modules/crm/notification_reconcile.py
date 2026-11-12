"""通知未读 Redis 与 MySQL 对账（见 docs/modules/redis-cache.md）。"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app.core.cache_metrics import incr as metric_incr
from app.core.database import SessionLocal
from app.modules.crm.notification_cache import get_unread, set_unread
from app.modules.crm.repository import CrmRepository

logger = logging.getLogger(__name__)

# 默认每 20 分钟对账一次
_RECONCILE_INTERVAL_SEC = 20 * 60
_SAMPLE_LIMIT = 80

_task: asyncio.Task | None = None
_stop: asyncio.Event | None = None


async def reconcile_unread_sample(*, limit: int = _SAMPLE_LIMIT) -> dict[str, int]:
    """抽样最近有通知的用户，纠正 Redis 未读漂移。"""
    checked = 0
    fixed = 0
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT target_user_id AS uid, MAX(target_name) AS uname
                      FROM crm_notifications
                     WHERE target_user_id IS NOT NULL
                       AND target_user_id <> ''
                     GROUP BY target_user_id
                     ORDER BY MAX(created_at) DESC
                     LIMIT :limit
                    """
                ),
                {"limit": max(1, min(int(limit), 200))},
            )
        ).mappings().all()

        repo = CrmRepository(db)
        for row in rows:
            uid = str(row["uid"] or "")
            uname = str(row["uname"] or "")
            if not uid:
                continue
            checked += 1
            mysql_count, latest_id = await repo.count_unread_notifications(
                user_id=uid,
                user_name=uname,
            )
            cached = await get_unread(uid)
            if cached is None:
                await set_unread(uid, mysql_count, latest_id)
                continue
            redis_count, _ = cached
            if redis_count != mysql_count:
                await set_unread(uid, mysql_count, latest_id)
                fixed += 1
                metric_incr("ntf_unread_mismatch_total")

    metric_incr("ntf_unread_reconcile_runs_total")
    logger.info("ntf unread reconcile checked=%s fixed=%s", checked, fixed)
    return {"checked": checked, "fixed": fixed}


async def _reconcile_loop(stop: asyncio.Event) -> None:
    # 启动后稍等，避开冷启动尖峰
    try:
        await asyncio.wait_for(stop.wait(), timeout=60.0)
        return
    except TimeoutError:
        pass

    while not stop.is_set():
        try:
            await reconcile_unread_sample()
        except Exception:
            logger.exception("ntf unread reconcile failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=_RECONCILE_INTERVAL_SEC)
            break
        except TimeoutError:
            continue


async def start_unread_reconciler() -> None:
    global _task, _stop
    if _task and not _task.done():
        return
    _stop = asyncio.Event()
    _task = asyncio.create_task(_reconcile_loop(_stop), name="ntf-unread-reconcile")


async def stop_unread_reconciler() -> None:
    global _task, _stop
    if _stop is not None:
        _stop.set()
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("stop unread reconciler failed")
    _task = None
    _stop = None
