"""飞书通讯录定时同步（组织信息 + 销售部快照，后台 asyncio 任务）。"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import IO

from app.config import get_settings
from app.core.database import SessionLocal
from app.core.feishu import is_feishu_configured
from app.modules.users.feishu_org_sync import (
    is_org_bulk_sync_running,
    recently_completed_org_bulk_sync,
    run_org_bulk_sync_job,
    try_start_org_bulk_sync,
)

logger = logging.getLogger(__name__)

# 多 worker 启动时，若近期已成功同步则跳过（秒）；手动 force 不受限
STARTUP_SYNC_COOLDOWN_SECONDS = 15 * 60

_scheduler_task: asyncio.Task[None] | None = None
_stop_event: asyncio.Event | None = None
_scheduler_lock_fd: IO[str] | None = None


def _try_acquire_scheduler_lock() -> bool:
    """同机多 worker 仅一个进程跑定时循环（fcntl 文件锁；Windows 降级为全员可跑 + DB 防抖）。"""
    global _scheduler_lock_fd
    if _scheduler_lock_fd is not None:
        return True

    try:
        import fcntl
    except ImportError:
        logger.info("当前平台无 fcntl，飞书同步定时任务不做进程锁（依赖 DB 防抖）")
        return True

    lock_dir = Path(__file__).resolve().parents[2] / "data"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / "feishu-org-sync.scheduler.lock"
    fd = open(lock_path, "a+", encoding="utf-8")  # noqa: SIM115  fd 需保持打开以持有 flock
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fd.close()
        return False
    except OSError as exc:
        fd.close()
        logger.warning("飞书同步定时锁获取失败，本进程跳过调度: %s", exc)
        return False

    import os

    fd.seek(0)
    fd.truncate()
    fd.write(f"pid={os.getpid()}\n")
    fd.flush()
    _scheduler_lock_fd = fd
    return True


async def run_feishu_org_sync(*, force: bool = False) -> None:
    """执行一次飞书 → MySQL 同步（users + feishu_sales_contacts）。失败时记录日志，不抛出异常。"""
    if not is_feishu_configured():
        logger.warning("飞书未配置，跳过组织信息同步")
        return

    job_id: str | None = None
    try:
        async with SessionLocal() as db:
            if not force and await recently_completed_org_bulk_sync(
                db, within_seconds=STARTUP_SYNC_COOLDOWN_SECONDS
            ):
                logger.info(
                    "飞书组织同步跳过：%d 秒内已有成功任务（防多 worker 重复）",
                    STARTUP_SYNC_COOLDOWN_SECONDS,
                )
                return
            if await is_org_bulk_sync_running(db):
                logger.info("飞书组织同步跳过：已有任务进行中")
                return
            job_id = await try_start_org_bulk_sync(db)
            if not job_id:
                logger.info("飞书组织同步跳过：无法获取任务锁")
                return
            await db.commit()

        await run_org_bulk_sync_job(job_id)
    except Exception:
        logger.exception("飞书组织定时同步失败 job=%s", job_id)


async def _sync_loop(stop_event: asyncio.Event) -> None:
    settings = get_settings()
    interval = settings.feishu_org_sync_interval_seconds

    if settings.feishu_org_sync_on_startup:
        # 多 worker 启动防抖：短时间内已成功则跳过
        await run_feishu_org_sync(force=False)

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            break
        except TimeoutError:
            # 周期任务不受启动冷却限制
            await run_feishu_org_sync(force=True)


def start_feishu_org_scheduler() -> None:
    """在 FastAPI lifespan 启动时调用。"""
    global _scheduler_task, _stop_event

    settings = get_settings()
    if not settings.feishu_org_sync_enabled:
        logger.info("飞书通讯录定时同步已关闭（FEISHU_ORG_SYNC_ENABLED=false）")
        return

    if _scheduler_task is not None and not _scheduler_task.done():
        return

    if not _try_acquire_scheduler_lock():
        logger.info("飞书通讯录定时同步：其它 worker 已持有调度锁，本进程不启动循环")
        return

    hours = settings.feishu_org_sync_interval_seconds / 3600
    logger.info(
        "飞书通讯录定时同步已启动：每 %.1f 小时执行一次（startup=%s，含 users + 销售部快照 + 部门负责人权限）",
        hours,
        settings.feishu_org_sync_on_startup,
    )

    _stop_event = asyncio.Event()
    _scheduler_task = asyncio.create_task(_sync_loop(_stop_event), name="feishu-org-sync")


async def stop_feishu_org_scheduler() -> None:
    """在 FastAPI lifespan 关闭时调用。"""
    global _scheduler_task, _stop_event, _scheduler_lock_fd

    if _stop_event is not None:
        _stop_event.set()

    if _scheduler_task is not None:
        try:
            await asyncio.wait_for(_scheduler_task, timeout=120)
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

    logger.info("飞书通讯录定时同步已停止")
