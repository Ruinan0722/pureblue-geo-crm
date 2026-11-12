"""简易进程内限流（公网敏感路径）。多 worker 时各进程独立计数，仍可显著降速。"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class _WindowCounter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: float) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


_counter = _WindowCounter()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host
    return "unknown"


def _matched_bucket(path: str) -> str | None:
    # 兼容 /api 与 /api/v1
    normalized = path
    if normalized.startswith("/api/v1/"):
        normalized = "/api/" + normalized[len("/api/v1/") :]
    if normalized == "/api/channel-intake/submit":
        return "intake_submit"
    if normalized == "/api/intake/submit" or normalized.startswith("/api/intake/submit/"):
        return "intake_submit"
    if normalized.startswith("/api/invites/resolve/"):
        return "invite_resolve"
    if normalized.startswith("/api/integrations/"):
        return "lead_integration"
    return None


class PublicRateLimitMiddleware(BaseHTTPMiddleware):
    """对 intake 提交与邀请 resolve 做 IP 限流。"""

    def __init__(
        self,
        app,
        *,
        enabled: bool = True,
        submit_limit: int = 30,
        submit_window_seconds: float = 60.0,
        resolve_limit: int = 60,
        resolve_window_seconds: float = 60.0,
        integration_limit: int = 120,
        integration_window_seconds: float = 60.0,
    ):
        super().__init__(app)
        self.enabled = enabled
        self.submit_limit = max(1, submit_limit)
        self.submit_window_seconds = max(1.0, submit_window_seconds)
        self.resolve_limit = max(1, resolve_limit)
        self.resolve_window_seconds = max(1.0, resolve_window_seconds)
        self.integration_limit = max(1, integration_limit)
        self.integration_window_seconds = max(1.0, integration_window_seconds)

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self.enabled:
            return await call_next(request)
        bucket = _matched_bucket(request.url.path)
        if not bucket:
            return await call_next(request)
        ip = _client_ip(request)
        if bucket == "intake_submit":
            ok = _counter.allow(
                f"submit:{ip}",
                limit=self.submit_limit,
                window_seconds=self.submit_window_seconds,
            )
        elif bucket == "invite_resolve":
            ok = _counter.allow(
                f"resolve:{ip}",
                limit=self.resolve_limit,
                window_seconds=self.resolve_window_seconds,
            )
        else:
            ok = _counter.allow(
                f"integration:{ip}",
                limit=self.integration_limit,
                window_seconds=self.integration_window_seconds,
            )
        if not ok:
            return JSONResponse(
                status_code=429,
                content={"error": "请求过于频繁，请稍后再试"},
                headers={"Retry-After": "60"},
            )
        return await call_next(request)
