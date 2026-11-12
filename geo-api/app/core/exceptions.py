from __future__ import annotations

from app.core.error_codes import ERROR_CODE_MESSAGES, ErrorCode


class AppError(Exception):
    def __init__(self, message: str | None = None, *, code: ErrorCode = "app_error"):
        self.message = message or ERROR_CODE_MESSAGES[code]
        self.code = code
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str | None = None):
        super().__init__(message, code="not_found")


class PermissionDeniedError(AppError):
    def __init__(self, message: str | None = None):
        super().__init__(message, code="permission_denied")


class UnauthorizedError(AppError):
    def __init__(self, message: str | None = None):
        super().__init__(message, code="unauthorized")


class ValidationError(AppError):
    def __init__(self, message: str | None = None):
        super().__init__(message, code="validation_error")


class ConflictError(AppError):
    """业务冲突（如同名客户已存在），HTTP 映射为 409。"""

    def __init__(self, message: str | None = None, *, payload: dict | None = None):
        super().__init__(message, code="conflict")
        self.payload = payload or {}


class InviteLimitError(AppError):
    def __init__(self, limit: int = 3):
        super().__init__(code="invite_limit")
        self.message = (
            f"每位内部人员最多同时持有 {limit} 个有效邀请链接，请先撤销旧链接后再创建"
        )
