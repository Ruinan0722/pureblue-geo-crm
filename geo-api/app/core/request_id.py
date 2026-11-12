"""为请求注入 X-Request-ID，便于日志关联。"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    header_name = "X-Request-ID"

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = (request.headers.get(self.header_name) or "").strip() or uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers[self.header_name] = rid
        return response
