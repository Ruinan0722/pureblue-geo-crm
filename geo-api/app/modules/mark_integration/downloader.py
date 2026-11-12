from __future__ import annotations

import logging
from datetime import timedelta

from app.core.database import SessionLocal
from app.core.time_utils import china_now
from app.modules.mark_integration.repository import MarkIntegrationRepository
from app.modules.mark_integration.storage import download_mark_pdf

logger = logging.getLogger(__name__)


async def process_mark_pdf_download(file_id: str) -> None:
    async with SessionLocal() as db:
        repo = MarkIntegrationRepository(db)
        row = await repo.get_file_by_id(file_id)
        if not row or row.download_status == "downloaded":
            return
        now = china_now()
        if row.url_expires_at and row.url_expires_at <= now:
            row.download_status = "expired"
            row.failure_reason = "PDF fileUrl 已过期"
            await db.commit()
            return
        row.download_status = "downloading"
        row.failure_reason = None
        row.download_attempts = int(row.download_attempts or 0) + 1
        row.next_attempt_at = None
        await db.commit()

        try:
            stored = await download_mark_pdf(
                source_url=row.source_url,
                external_record_id=row.external_record_id,
                file_id=row.id,
                original_name=row.original_name,
                expected_checksum=row.expected_checksum,
                expected_size=row.expected_size,
            )
            row = await repo.get_file_by_id(file_id)
            if not row:
                return
            await repo.mark_files_not_current(row.platform, row.external_record_id)
            row.size = stored.size
            row.checksum = stored.checksum
            row.storage_path = stored.storage_path
            row.uploaded_at = china_now()
            row.download_status = "downloaded"
            row.failure_reason = None
            row.next_attempt_at = None
            # 预签名 URL 可能包含临时凭证；归档完成后不再保留。
            row.source_url = ""
            row.is_current = True
            await db.commit()
        except Exception as exc:
            await db.rollback()
            row = await repo.get_file_by_id(file_id)
            if row:
                row.download_status = "download_failed"
                row.failure_reason = str(exc)[:500] or "PDF 下载失败"
                delay_seconds = min(15 * (2 ** max(int(row.download_attempts or 1) - 1, 0)), 900)
                row.next_attempt_at = china_now() + timedelta(seconds=delay_seconds)
                await db.commit()
            logger.exception("Mark PDF download failed file_id=%s", file_id)
