"""客户「下次计划跟进」到期提醒：每日向销售负责人发系统通知。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import IO
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.core.database import SessionLocal
from app.modules.crm.service import CrmService

logger = logging.getLogger(__name__)

CHINA_TZ = ZoneInfo("Asia/Shanghai")

_scheduler_task: asyncio.Task[None] | None = None
_stop_event: asyncio.Event | None = None
_scheduler_lock_fd: IO[str] | None = None


def _lock_path() -> Path:
    lock_dir = Path(__file__).resolve().parents[2] / "data"
    lock_dir.mkdir(parents=True, exist_ok=True)
    return lock_dir / "follow-up-reminder.scheduler.lock"


def _last_run_path() -> Path:
    return _lock_path().with_suffix(".last-run")


def _read_last_run_day() -> str | None:
    path = _last_run_path()
    try:
        raw = path.read_text(encoding="utf-8").strip()[:10]
        return raw if len(raw) == 10 else None
    except OSError:
        return None


def _write_last_run_day(day: str) -> None:
    try:
        _last_run_path().write_text(f"{day}\n", encoding="utf-8")
    except OSError as exc:
        logger.warning("写入跟进提醒上次执行日失败: %s", exc)


def _try_acquire_scheduler_lock() -> bool:
    """同机多 worker 仅一个进程跑定时循环。"""
    global _scheduler_lock_fd
    if _scheduler_lock_fd is not None:
        return True

    try:
        import fcntl
    except ImportError:
        logger.info("当前平台无 fcntl，跟进提醒定时任务不做进程锁")
        return True

    lock_path = _lock_path()
    fd = open(lock_path, "a+", encoding="utf-8")  # noqa: SIM115  fd 需保持打开以持有 flock
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fd.close()
        return False
    except OSError as exc:
        fd.close()
        logger.warning("跟进提醒定时锁获取失败，本进程跳过调度: %s", exc)
        return False

    import os

    fd.seek(0)
    fd.truncate()
    fd.write(f"pid={os.getpid()}\n")
    fd.flush()
    _scheduler_lock_fd = fd
    return True


def _seconds_until_next_run(*, hour: int, minute: int = 0) -> float:
    now = datetime.now(CHINA_TZ)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now >= target:
        target = target + timedelta(days=1)
    return max((target - now).total_seconds(), 1.0)


async def run_follow_up_reminders(*, force: bool = False) -> dict[str, int | str] | None:
    """执行一次今日到期跟进提醒。失败只记日志。"""
    today = datetime.now(CHINA_TZ).date().isoformat()
    if not force and _read_last_run_day() == today:
        logger.info("跟进提醒跳过：今日已执行过（%s）", today)
        return None

    try:
        async with SessionLocal() as db:
            stats = await CrmService(db).dispatch_follow_up_reminders(today=today)
        _write_last_run_day(today)
        logger.info(
            "跟进提醒完成 today=%s due=%s created=%s skipped=%s unresolved=%s",
            stats.get("today"),
            stats.get("due"),
            stats.get("created"),
            stats.get("skipped"),
            stats.get("unresolved"),
        )
        return stats
    except Exception:
        logger.exception("跟进提醒任务失败")
        return None


async def _reminder_loop(stop_event: asyncio.Event) -> None:
    settings = get_settings()
    hour = max(0, min(23, int(settings.follow_up_reminder_hour)))

    # 启动时：若已过今日定点且尚未跑过，补跑一次（重启不丢当天提醒）
    now = datetime.now(CHINA_TZ)
    if now.hour > hour or (now.hour == hour and now.minute >= 0):
        await run_follow_up_reminders(force=False)

    while not stop_event.is_set():
        wait = _seconds_until_next_run(hour=hour)
        logger.info("跟进提醒下次执行约 %.0f 分钟后（北京时间每日 %02d:00）", wait / 60, hour)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=wait)
            break
        except TimeoutError:
            await run_follow_up_reminders(force=False)


def start_follow_up_reminder_scheduler() -> None:
    """在 FastAPI lifespan 启动时调用。"""
    global _scheduler_task, _stop_event

    settings = get_settings()
    if not settings.follow_up_reminder_enabled:
        logger.info("客户跟进提醒已关闭（FOLLOW_UP_REMINDER_ENABLED=false）")
        return

    if _scheduler_task is not None and not _scheduler_task.done():
        return

    if not _try_acquire_scheduler_lock():
        logger.info("客户跟进提醒：其它 worker 已持有调度锁，本进程不启动循环")
        return

    hour = max(0, min(23, int(settings.follow_up_reminder_hour)))
    logger.info("客户跟进提醒已启动：北京时间每日 %02d:00 扫描 nextFollowAt", hour)

    _stop_event = asyncio.Event()
    _scheduler_task = asyncio.create_task(_reminder_loop(_stop_event), name="follow-up-reminder")


async def stop_follow_up_reminder_scheduler() -> None:
    """在 FastAPI lifespan 关闭时调用。"""
    global _scheduler_task, _stop_event, _scheduler_lock_fd

    if _stop_event is not None:
        _stop_event.set()

    if _scheduler_task is not None:
        try:
            await asyncio.wait_for(_scheduler_task, timeout=60)
        except TimeoutError:
            _scheduler_task.cancel()
            try:
                await _scheduler_task
            except asyncio.CancelledError:
                pass
        _scheduler_task = None
        _stop_event = None

    if _scheduler_lock_fd is not None:
        try:
            import fcntl

            fcntl.flock(_scheduler_lock_fd.fileno(), fcntl.LOCK_UN)
        except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
            pass
        try:
            _scheduler_lock_fd.close()
        except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
            pass
        _scheduler_lock_fd = None

    logger.info("客户跟进提醒定时任务已停止")
