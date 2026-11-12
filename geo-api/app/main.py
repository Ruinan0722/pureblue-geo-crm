from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings, reload_settings
from app.core.error_codes import ERROR_CODE_HTTP
from app.core.exceptions import AppError
from app.core.feishu_org_scheduler import (
    start_feishu_org_scheduler,
    stop_feishu_org_scheduler,
)
from app.core.follow_up_reminder_scheduler import (
    start_follow_up_reminder_scheduler,
    stop_follow_up_reminder_scheduler,
)
from app.core.rate_limit import PublicRateLimitMiddleware
from app.core.request_id import RequestIdMiddleware
from app.modules.auth.router import router as auth_router
from app.modules.channel_intake.router import router as channel_intake_router
from app.modules.checkin.router import router as checkin_router
from app.modules.channel_management.router import router as channel_router
from app.modules.crm.router import router as crm_router
from app.modules.intake.router import router as intake_router
from app.modules.internal.cache_router import router as internal_cache_router
from app.modules.internal.rbac_router import router as internal_rbac_router
from app.modules.invites.router import router as invites_router
from app.modules.mark_integration.router import router as mark_integration_router
from app.modules.projects.router import router as projects_router
from app.modules.rbac.router import router as rbac_router
from app.modules.release_notes.router import router as release_notes_router
from app.modules.requests.router import router as requests_router
from app.modules.users.router import router as users_router


def _init_sentry() -> None:
    settings = get_settings()
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logging.getLogger(__name__).warning("SENTRY_DSN 已配置但未安装 sentry-sdk，跳过")
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=settings.app_env,
        traces_sample_rate=max(0.0, min(1.0, settings.sentry_traces_sample_rate)),
        integrations=[StarletteIntegration(), FastApiIntegration()],
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    _init_sentry()
    if get_settings().app_env == "development":
        reload_settings()
    from app.core.redis_client import close_redis, get_redis
    from app.modules.crm.notification_cache import (
        start_notification_subscriber,
        stop_notification_subscriber,
    )
    from app.modules.crm.notification_reconcile import (
        start_unread_reconciler,
        stop_unread_reconciler,
    )

    redis = get_redis()
    await redis.is_available()
    from app.core.cache_invalidation import announce_runtime_key_prefix, check_runtime_key_prefix

    prefix_check = await check_runtime_key_prefix(service="geo-api")
    await announce_runtime_key_prefix(service="geo-api")
    logging.getLogger(__name__).info(
        "redis startup prefix=%s enabled=%s status=%s prefixOk=%s",
        redis.prefix,
        redis.enabled,
        redis.health_status(),
        prefix_check.get("ok"),
    )
    await start_notification_subscriber()
    await start_unread_reconciler()
    start_feishu_org_scheduler()
    start_follow_up_reminder_scheduler()
    from app.modules.mark_integration.worker import start_integration_worker
    start_integration_worker()
    try:
        yield
    finally:
        from app.modules.mark_integration.worker import stop_integration_worker
        await stop_integration_worker()
        await stop_unread_reconciler()
        await stop_notification_subscriber()
        await stop_follow_up_reminder_scheduler()
        await stop_feishu_org_scheduler()
        await close_redis()


def _error_message(detail: object) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                msg = item.get("msg")
                if isinstance(msg, str) and msg.strip():
                    parts.append(msg)
        if parts:
            return "；".join(parts)
    return "请求无效"


def _is_integration_request(request: Request) -> bool:
    return "/integrations/" in request.url.path


def _integration_error(
    request: Request,
    *,
    status_code: int,
    message: str,
    errors: list[dict[str, str]] | None = None,
) -> JSONResponse:
    content: dict[str, object] = {
        "code": status_code * 100 + 1,
        "message": message,
        "requestId": str(getattr(request.state, "request_id", "") or ""),
    }
    if errors:
        content["errors"] = errors
    return JSONResponse(status_code=status_code, content=content)


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        if _is_integration_request(request):
            status_code = 422 if exc.code == "validation_error" else ERROR_CODE_HTTP.get(exc.code, 400)
            return _integration_error(
                request, status_code=status_code, message=exc.message
            )
        return JSONResponse(
            status_code=ERROR_CODE_HTTP.get(exc.code, 400),
            content={"error": exc.message},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        if _is_integration_request(request):
            return _integration_error(
                request,
                status_code=exc.status_code,
                message=_error_message(exc.detail),
            )
        if isinstance(exc.detail, dict):
            # 统一错误契约：内部 API 一律 {"error": <人话>, "detail"?: <结构化候选>}
            message = _error_message(exc.detail.get("message") or exc.detail)
            return JSONResponse(
                status_code=exc.status_code,
                content={"error": message, "detail": exc.detail},
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": _error_message(exc.detail)},
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        if _is_integration_request(request):
            errors = []
            for item in exc.errors():
                location = [str(part) for part in item.get("loc", ()) if part != "body"]
                errors.append(
                    {
                        "field": ".".join(location),
                        "message": str(item.get("msg") or "参数无效"),
                    }
                )
            return _integration_error(
                request,
                status_code=422,
                message="validation failed",
                errors=errors,
            )
        return JSONResponse(status_code=422, content={"error": _error_message(exc.errors())})

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", "")
        logging.getLogger(__name__).exception("unhandled error request_id=%s", rid)
        if _is_integration_request(request):
            return _integration_error(
                request, status_code=500, message="CRM internal error"
            )
        return JSONResponse(status_code=500, content={"error": "服务器内部错误"})


def create_app() -> FastAPI:
    settings = get_settings()
    from app.core.geo_features import is_feature_enabled

    docs_enabled = is_feature_enabled("API_DOCS")
    docs_url = "/api/docs" if docs_enabled else None
    openapi_url = "/api/openapi.json" if docs_enabled else None
    app = FastAPI(
        title="GEO CRM API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=docs_url,
        openapi_url=openapi_url,
        redoc_url=None,
    )
    _register_exception_handlers(app)

    # 后添加的中间件先执行：RequestId → RateLimit → CORS
    app.add_middleware(
        PublicRateLimitMiddleware,
        enabled=settings.rate_limit_enabled,
        submit_limit=settings.rate_limit_submit_per_minute,
        submit_window_seconds=60.0,
        resolve_limit=settings.rate_limit_resolve_per_minute,
        resolve_window_seconds=60.0,
        integration_limit=settings.rate_limit_integration_per_minute,
        integration_window_seconds=60.0,
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/version")
    async def api_version():
        """Current deploy version (Git tag) + environment. Used by ops / optional FE probes."""
        from fastapi.responses import JSONResponse

        from app.config import get_settings
        from app.core.geo_features import geo_env_label, get_geo_env

        settings = get_settings()
        version = (settings.app_version or "").strip() or "dev"
        return JSONResponse(
            content={
                "version": version,
                "env": get_geo_env(),
                "envLabel": geo_env_label(),
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/health")
    async def health():
        from app.config import get_settings
        from app.core.geo_features import is_feature_enabled
        from app.core.redis_client import get_redis

        settings = get_settings()
        redis = get_redis()
        await redis.is_available()
        body: dict = {
            "status": "ok",
            "redis": redis.health_status(),
        }
        # 生产默认不返回缓存指标；可用 GEO_FEATURE_HEALTH_CACHE_METRICS 覆盖
        if is_feature_enabled("HEALTH_CACHE_METRICS"):
            from app.core.cache_invalidation import (
                check_runtime_key_prefix,
                get_crm_data_ver,
                get_rbac_ver,
            )
            from app.core.cache_metrics import snapshot as metrics_snapshot

            prefix_check = await check_runtime_key_prefix(service="geo-api-health")
            rbac_ver = await get_rbac_ver() if redis.enabled else 0
            crm_ver = await get_crm_data_ver() if redis.enabled else 0
            body.update(
                {
                    "redisKeyPrefix": redis.prefix,
                    "redisCacheEnabled": redis.enabled,
                    "redisCrmCacheEnabled": bool(
                        settings.redis_cache_enabled and settings.redis_crm_cache_enabled
                    ),
                    "redisInternalInvalidate": bool((settings.redis_internal_token or "").strip()),
                    "redisPrefixOk": bool(prefix_check.get("ok", True)),
                    "rbacVer": rbac_ver,
                    "crmDataVer": crm_ver,
                    "cacheMetrics": metrics_snapshot(),
                }
            )
        return body

    for router in (
        auth_router,
        checkin_router,
        channel_router,
        channel_intake_router,
        crm_router,
        intake_router,
        rbac_router,
        requests_router,
        projects_router,
        release_notes_router,
        invites_router,
        users_router,
        internal_cache_router,
        internal_rbac_router,
        mark_integration_router,
    ):
        app.include_router(router, prefix="/api/v1")

    for router in (
        auth_router,
        checkin_router,
        channel_router,
        channel_intake_router,
        crm_router,
        intake_router,
        rbac_router,
        requests_router,
        projects_router,
        release_notes_router,
        invites_router,
        users_router,
        internal_cache_router,
        internal_rbac_router,
        mark_integration_router,
    ):
        app.include_router(router, prefix="/api")

    return app


app = create_app()
