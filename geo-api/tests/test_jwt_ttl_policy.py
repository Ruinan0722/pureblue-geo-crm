import pytest
from pydantic import ValidationError

from app.config import Settings


def _production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "production",
        "geo_env": "production",
        "jwt_secret_key": "production-jwt-secret-at-least-32-characters",
        "database_url": "mysql+asyncmy://geo_app:strong-password@db:3306/geo_crm",
        "jwt_access_token_expire_seconds": 86400,
        "feishu_skip_department_check": False,
    }
    values.update(overrides)
    return Settings(**values)


def test_production_jwt_ttl_is_one_day() -> None:
    settings = _production_settings()
    assert settings.jwt_access_token_expire_seconds == 86400


def test_production_rejects_seven_day_jwt_ttl() -> None:
    with pytest.raises(ValidationError, match="production 环境.*必须为 86400 秒"):
        _production_settings(jwt_access_token_expire_seconds=604800)


@pytest.mark.parametrize("env", ["development", "staging", "test"])
def test_non_production_jwt_ttl_is_seven_days(env: str) -> None:
    settings = Settings(
        app_env=env,
        geo_env=env,
        jwt_access_token_expire_seconds=604800,
    )
    assert settings.jwt_access_token_expire_seconds == 604800


@pytest.mark.parametrize("env", ["development", "staging", "test"])
def test_non_production_rejects_one_day_jwt_ttl(env: str) -> None:
    with pytest.raises(ValidationError, match=rf"{env} 环境.*必须为 604800 秒"):
        Settings(
            app_env=env,
            geo_env=env,
            jwt_access_token_expire_seconds=86400,
        )
