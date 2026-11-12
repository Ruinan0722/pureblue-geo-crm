from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.core.time_utils import china_now
from app.modules.mark_integration.models import MarkReviewCallback

REVIEW_STATUSES = {"approved", "rejected", "supplementRequired"}


def build_review_callback(*, lead_id: str, document: dict, reviewer_id: str, reviewer_name: str):
    meta = document.get("importMeta") if isinstance(document.get("importMeta"), dict) else {}
    if meta.get("platform") != "mark":
        return None
    status = str(document.get("reviewStatus") or "").strip()
    if status not in REVIEW_STATUSES:
        return None
    external_id = str(meta.get("externalRecordId") or "").strip()
    if not external_id:
        return None
    now = china_now()
    event_id = f"review-{uuid.uuid4().hex}"
    payload = {
        "eventId": event_id,
        "eventType": "lead.reviewed",
        "externalRecordId": external_id,
        "crmLeadId": lead_id,
        "reviewStatus": status,
        "reviewedAt": _iso(now),
        "reviewer": {"id": reviewer_id, "name": reviewer_name},
        "reason": str(document.get("reviewReason") or "").strip(),
    }
    return MarkReviewCallback(
        id=str(uuid.uuid4()), event_id=event_id, external_record_id=external_id,
        crm_lead_id=lead_id, payload=payload, status="pending", attempts=0,
        next_attempt_at=now, last_error=None, created_at=now, updated_at=now, sent_at=None,
    )


def _iso(value):
    return value.isoformat(timespec="seconds") + "+08:00"


async def send_review_callback(row: MarkReviewCallback) -> None:
    settings = get_settings()
    if not settings.mark_review_callback_enabled:
        return
    url = settings.mark_review_callback_url.strip()
    secret = settings.mark_review_callback_secret.strip()
    raw = json.dumps(row.payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    path = urlsplit(url).path or "/"
    body_hash = hashlib.sha256(raw).hexdigest()
    signing_text = f"POST\n{path}\n{timestamp}\n{nonce}\n{body_hash}"
    signature = "sha256=" + hmac.new(secret.encode(), signing_text.encode(), hashlib.sha256).hexdigest()
    timeout = httpx.Timeout(settings.mark_review_callback_timeout_seconds, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        response = await client.post(url, content=raw, headers={
            "Content-Type": "application/json", "X-Platform-Code": "geo-crm",
            "X-Timestamp": timestamp, "X-Nonce": nonce, "X-Signature": signature,
            "X-Request-Id": row.event_id,
        })
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Mark 审核回传返回 HTTP {response.status_code}")


def mark_callback_failed(row: MarkReviewCallback, exc: Exception) -> None:
    now = china_now()
    row.status = "failed"
    row.last_error = str(exc)[:500]
    row.updated_at = now
    row.next_attempt_at = now + timedelta(seconds=min(300, 2 ** max(1, row.attempts) * 5))
