"""统一错误码 catalog（单一权威源）。

前端镜像：geo-admin/modules/auth/lib/error-codes.ts（由 tests/test_error_code_catalog.py 钉死一致）。
HTTP 映射见 ERROR_CODE_HTTP；默认人话见 ERROR_CODE_MESSAGES。
"""

from __future__ import annotations

from typing import Literal

ErrorCode = Literal[
    "app_error",
    "not_found",
    "permission_denied",
    "unauthorized",
    "validation_error",
    "conflict",
    "invite_limit",
]

ERROR_CODE_HTTP: dict[str, int] = {
    "app_error": 400,
    "not_found": 404,
    "permission_denied": 403,
    "unauthorized": 401,
    "validation_error": 400,
    "conflict": 409,
    "invite_limit": 400,
}

ERROR_CODE_MESSAGES: dict[str, str] = {
    "app_error": "请求处理失败",
    "not_found": "资源不存在",
    "permission_denied": "无权限执行此操作",
    "unauthorized": "请先登录",
    "validation_error": "参数无效",
    "conflict": "业务冲突",
    "invite_limit": "邀请数量已达上限",
}
