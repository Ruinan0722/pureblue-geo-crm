from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_JWT = frozenset({
    "change-me-in-production-use-openssl-rand-hex-32",
    "change-me-in-development",
    "dev-local-jwt-secret-please-change",
    "CHANGE_ME",
})

JWT_TTL_SECONDS_BY_ENV = {
    "production": 24 * 60 * 60,
    "development": 7 * 24 * 60 * 60,
    "staging": 7 * 24 * 60 * 60,
    "test": 7 * 24 * 60 * 60,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    # 产品环境标识（development|staging|production）；空则回落 APP_ENV
    geo_env: str = ""
    # 生产由部署脚本注入 DEPLOY_GIT_TAG；空则接口回落为 "dev"
    app_version: str = ""
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_workers: int = 1
    api_cors_origins: str = "http://localhost:47821,http://localhost:47822"

    database_url: str = "mysql+asyncmy://demo:replace-me@127.0.0.1:3306/geo_crm_demo"
    database_pool_size: int = 10
    database_pool_max_overflow: int = 10

    jwt_secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_seconds: int = 604800
    jwt_cookie: str = "geo_access_token"

    invite_cookie: str = "geo_invite_token"

    customer_portal_url: str = "http://localhost:47822"
    channel_intake_public_url: str = ""
    admin_portal_url: str = "http://localhost:47821"

    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_redirect_uri: str = ""
    feishu_tenant_key: str = ""
    feishu_sales_departments: str = "销售部"
    feishu_viewer_departments: str = "客户成功,销售运营"
    feishu_sales_department_ids: str = ""
    feishu_skip_department_check: bool = False
    admin_feishu_open_ids: str = ""
    # 唯一超级管理员（飞书 open_id）；优先于 ADMIN_FEISHU_OPEN_IDS
    super_admin_feishu_open_id: str = ""
    # 部门 ID→中文名兜底（飞书未开通 department.base 权限时）
    feishu_department_labels_path: str = ""
    feishu_department_map_path: str = ""
    # 组织同步：从这些根部门子树发现新成员（open_department_id，逗号分隔）
    feishu_org_root_department_ids: str = ""

    # 打卡现场照片本地目录（暂不上云；相对路径相对 geo-api 根目录）
    checkin_attachments_dir: str = "data/checkin-attachments"
    checkin_attachment_max_bytes: int = 10 * 1024 * 1024
    checkin_attachment_max_count: int = 9

    # CRM 附件本地目录（线索 / 客户 / 商机；暂不上云）
    crm_attachments_dir: str = "data/crm-attachments"
    crm_attachment_max_bytes: int = 25 * 1024 * 1024
    crm_attachment_max_count: int = 20

    # 官网 / 36氪 / Mark 统一线索入站：默认关闭，需通过共享密钥显式启用。
    lead_integration_enabled: bool = False
    # 通用密钥仅供本地兼容；测试/生产应配置三个平台独立密钥。
    lead_integration_secret: str = ""
    lead_integration_website_secret: str = ""
    lead_integration_36kr_secret: str = ""
    lead_integration_mark_secret: str = ""
    # 推荐第三方接入：Authorization: Bearer <平台独立 API Key>。
    # 旧 HMAC 密钥仅用于兼容迁移，不与 Bearer Key 混用。
    lead_integration_website_token: str = ""
    lead_integration_36kr_token: str = ""
    lead_integration_mark_token: str = ""
    lead_integration_legacy_hmac_enabled: bool = True
    lead_integration_timestamp_tolerance_seconds: int = 300
    # Mark PDF 下载专用配置。
    mark_integration_files_dir: str = "data/mark-integration-files"
    mark_integration_pdf_max_bytes: int = 25 * 1024 * 1024
    mark_integration_file_hosts: str = ""
    mark_integration_allow_private_hosts: bool = False
    mark_integration_private_cidrs: str = ""
    mark_integration_download_timeout_seconds: float = 60.0
    mark_integration_worker_interval_seconds: float = 15.0
    mark_integration_max_attempts: int = 5
    mark_review_callback_enabled: bool = False
    mark_review_callback_url: str = ""
    mark_review_callback_secret: str = ""
    mark_review_callback_timeout_seconds: float = 15.0

    # 飞书组织全量同步并发（每个 worker 内；部门发现与 DB 写入共用）
    feishu_org_sync_concurrency: int = 8
    feishu_org_discover_concurrency: int = 16

    # 飞书通讯录定时同步（users 表 + feishu_sales_contacts 销售部快照，单任务）
    feishu_org_sync_enabled: bool = True
    feishu_org_sync_interval_hours: float = 3.0
    feishu_org_sync_on_startup: bool = False

    # 客户「下次计划跟进」到期提醒（北京时间每日定点扫描）
    follow_up_reminder_enabled: bool = True
    follow_up_reminder_hour: int = 8

    # Redis 缓存（可选；未配置或关闭时读路径回源 MySQL）
    redis_url: str = ""
    redis_key_prefix: str = "local"
    redis_cache_enabled: bool = True
    redis_connect_timeout_ms: int = 200
    redis_op_timeout_ms: int = 100
    # CRM 列表/工作台短缓存（可独立关闭；默认跟随总开关）
    redis_crm_cache_enabled: bool = True
    # 内部失效接口共享密钥（空则禁用路径 B）
    redis_internal_token: str = ""

    # 生产：关闭 Swagger/OpenAPI（development 默认开）
    api_docs_enabled: bool = True
    # 公网敏感路径限流（进程内；多 worker 各自计数）
    rate_limit_enabled: bool = True
    rate_limit_submit_per_minute: int = 30
    rate_limit_resolve_per_minute: int = 60
    rate_limit_integration_per_minute: int = 120
    # 可选 Sentry（未配置 DSN 则不启用）
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0

    @property
    def feishu_org_sync_interval_seconds(self) -> float:
        return max(self.feishu_org_sync_interval_hours, 0.5) * 3600

    @property
    def checkin_attachments_path(self) -> str:
        from pathlib import Path

        raw = Path(self.checkin_attachments_dir)
        if raw.is_absolute():
            return str(raw)
        # geo-api 包根：app/config.py → parents[1] = geo-api/
        root = Path(__file__).resolve().parents[1]
        return str((root / raw).resolve())

    @property
    def crm_attachments_path(self) -> str:
        from pathlib import Path

        raw = Path(self.crm_attachments_dir)
        if raw.is_absolute():
            return str(raw)
        root = Path(__file__).resolve().parents[1]
        return str((root / raw).resolve())

    @property
    def mark_integration_files_path(self) -> str:
        from pathlib import Path

        raw = Path(self.mark_integration_files_dir)
        if raw.is_absolute():
            return str(raw)
        root = Path(__file__).resolve().parents[1]
        return str((root / raw).resolve())

    @property
    def mark_integration_file_host_list(self) -> list[str]:
        return [host.strip().lower().rstrip(".") for host in self.mark_integration_file_hosts.split(",") if host.strip()]

    @property
    def mark_integration_private_cidr_list(self) -> list[str]:
        return [item.strip() for item in self.mark_integration_private_cidrs.split(",") if item.strip()]

    def lead_integration_secret_for(self, platform: str) -> str:
        dedicated = {
            "website": self.lead_integration_website_secret,
            "36kr": self.lead_integration_36kr_secret,
            "mark": self.lead_integration_mark_secret,
        }.get(platform, "")
        return (dedicated or self.lead_integration_secret).strip()

    def lead_integration_token_for(self, platform: str) -> str:
        return {
            "website": self.lead_integration_website_token,
            "36kr": self.lead_integration_36kr_token,
            "mark": self.lead_integration_mark_token,
        }.get(platform, "").strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def admin_open_id_list(self) -> list[str]:
        return [x.strip() for x in self.admin_feishu_open_ids.split(",") if x.strip()]

    @property
    def super_admin_open_id(self) -> str:
        return self.super_admin_feishu_open_id.strip()

    @property
    def sales_department_id_list(self) -> list[str]:
        return [x.strip() for x in self.feishu_sales_department_ids.split(",") if x.strip()]

    @property
    def org_root_department_id_list(self) -> list[str]:
        raw = self.feishu_org_root_department_ids.strip()
        if raw:
            return list(dict.fromkeys(x.strip() for x in raw.split(",") if x.strip()))
        return list(dict.fromkeys(self.sales_department_id_list))

    @model_validator(mode="after")
    def _reject_insecure_production_config(self) -> "Settings":
        # JWT 是后端运行时安全策略，跟随 APP_ENV；GEO_ENV 仅用于产品功能开关，
        # 测试或本地联调可能临时切换 GEO_ENV，不应改变签发时长。
        effective_env = (self.app_env or "development").strip().lower()
        expected_jwt_ttl = JWT_TTL_SECONDS_BY_ENV.get(effective_env)
        if expected_jwt_ttl is not None and self.jwt_access_token_expire_seconds != expected_jwt_ttl:
            raise ValueError(
                f"{effective_env} 环境 JWT_ACCESS_TOKEN_EXPIRE_SECONDS 必须为 "
                f"{expected_jwt_ttl} 秒"
            )
        if self.app_env != "production":
            return self
        if self.jwt_secret_key in _INSECURE_JWT or len(self.jwt_secret_key) < 16:
            raise ValueError("生产环境 JWT_SECRET_KEY 未正确配置")
        if "change_me" in self.database_url.lower() or "geo_dev_local" in self.database_url:
            raise ValueError("生产环境 DATABASE_URL 不得使用开发库或占位密码")
        if self.feishu_skip_department_check:
            raise ValueError("生产环境不得开启 FEISHU_SKIP_DEPARTMENT_CHECK")
        if self.lead_integration_enabled:
            invalid_platforms = [
                platform
                for platform in ("website", "36kr", "mark")
                if len(self.lead_integration_token_for(platform)) < 32
                and (
                    not self.lead_integration_legacy_hmac_enabled
                    or len(self.lead_integration_secret_for(platform)) < 32
                )
            ]
            if invalid_platforms:
                raise ValueError(
                    "生产启用线索集成时三平台 Bearer Token（或兼容期 HMAC 密钥）"
                    "均不得少于 32 字符："
                    + "、".join(invalid_platforms)
                )
        if self.lead_integration_enabled and not self.mark_integration_file_host_list:
            raise ValueError("生产启用线索集成时必须配置 MARK_INTEGRATION_FILE_HOSTS")
        if self.mark_review_callback_enabled:
            if not self.mark_review_callback_url.startswith("https://"):
                raise ValueError("生产启用 Mark 审核回传时必须配置 HTTPS MARK_REVIEW_CALLBACK_URL")
            if len(self.mark_review_callback_secret.strip()) < 32:
                raise ValueError("MARK_REVIEW_CALLBACK_SECRET 不得少于 32 字符")
        # 生产默认关闭 OpenAPI；仅当显式 API_DOCS_ENABLED=true 时打开（不推荐）
        import os

        raw = (os.environ.get("API_DOCS_ENABLED") or "").strip().lower()
        if raw in ("1", "true", "yes"):
            object.__setattr__(self, "api_docs_enabled", True)
        else:
            object.__setattr__(self, "api_docs_enabled", False)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    """开发环境热重载 .env 后调用，避免缓存旧配置。"""
    get_settings.cache_clear()
    # Feature flags cache GEO_ENV / overrides; clear so hot-reload picks up changes.
    from app.core.geo_features import clear_feature_cache

    clear_feature_cache()
    return get_settings()
