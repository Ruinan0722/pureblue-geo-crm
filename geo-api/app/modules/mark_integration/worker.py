from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from app.config import get_settings
from app.core.database import SessionLocal
from app.core.time_utils import china_now
from app.modules.mark_integration.downloader import process_mark_pdf_download
from app.modules.mark_integration.repository import MarkIntegrationRepository

logger = logging.getLogger(__name__)
_task = None
_stop = None
_lock_fd = None


def _acquire_lock() -> bool:
    global _lock_fd
    if _lock_fd is not None:
        return True
    try:
        import fcntl
        path = Path(get_settings().mark_integration_files_path).resolve() / ".integration-worker.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = open(path, "a+", encoding="utf-8")  # noqa: SIM115  fd 需保持打开以持有 flock
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd = fd
        return True
    except (ImportError, BlockingIOError, OSError):
        return False


async def run_integration_jobs_once() -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        repo = MarkIntegrationRepository(db)
        files = await repo.list_recoverable_files(
            china_now(), limit=20, max_attempts=settings.mark_integration_max_attempts
        )
        file_ids = [row.id for row in files]
    for file_id in file_ids:
        await process_mark_pdf_download(file_id)



async def _loop(stop: asyncio.Event) -> None:
    interval = max(5.0, get_settings().mark_integration_worker_interval_seconds)
    while not stop.is_set():
        try:
            await run_integration_jobs_once()
        except Exception:
            logger.exception("integration worker iteration failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


def start_integration_worker() -> None:
    global _task, _stop
    if not get_settings().lead_integration_enabled or (_task and not _task.done()):
        return
    if not _acquire_lock():
        logger.info("integration worker already running in another process")
        return
    _stop = asyncio.Event()
    _task = asyncio.create_task(_loop(_stop), name="lead-integration-worker")


async def stop_integration_worker() -> None:
    global _task, _stop, _lock_fd
    if _stop:
        _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=30)
        except TimeoutError:
            _task.cancel()
        _task = None
        _stop = None
    if _lock_fd:
        try:
            _lock_fd.close()
        except OSError:
            pass
        _lock_fd = None
