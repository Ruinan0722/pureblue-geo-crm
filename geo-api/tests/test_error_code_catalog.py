"""错误码 catalog 一致性：后端目录 ↔ 异常层级 ↔ HTTP 映射 ↔ 前端镜像。"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.core import exceptions as exc_mod
from app.core.error_codes import ERROR_CODE_HTTP, ERROR_CODE_MESSAGES, ErrorCode
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_MIRROR = ROOT / "geo-admin/modules/auth/lib/error-codes.ts"


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _app_error_codes() -> set[str]:
    codes: set[str] = set()
    for _, member in inspect.getmembers(exc_mod, inspect.isclass):
        if issubclass(member, exc_mod.AppError) and member is not exc_mod.AppError:
            instance = member()  # type: ignore[operator]
            codes.add(str(instance.code))
    return codes


def test_every_catalog_code_has_http_and_message():
    assert set(ERROR_CODE_HTTP) == set(ErrorCode.__args__)  # type: ignore[attr-defined]
    assert set(ERROR_CODE_MESSAGES) == set(ErrorCode.__args__)  # type: ignore[attr-defined]
    for code in ERROR_CODE_HTTP:
        assert 400 <= ERROR_CODE_HTTP[code] <= 599
        assert ERROR_CODE_MESSAGES[code].strip()


def test_app_error_subclasses_use_catalog_codes():
    assert _app_error_codes() <= set(ErrorCode.__args__)  # type: ignore[attr-defined]


def test_default_messages_match_catalog():
    assert exc_mod.AppError().message == ERROR_CODE_MESSAGES["app_error"]
    assert exc_mod.NotFoundError().message == ERROR_CODE_MESSAGES["not_found"]
    assert exc_mod.PermissionDeniedError().message == ERROR_CODE_MESSAGES["permission_denied"]
    assert exc_mod.ValidationError().message == ERROR_CODE_MESSAGES["validation_error"]


def test_frontend_mirror_matches_catalog():
    source = FRONTEND_MIRROR.read_text(encoding="utf-8")
    http_block = re.search(r"ERROR_CODE_HTTP: Record<string, number> = \{(.*?)\}", source, re.DOTALL)
    assert http_block, "前端镜像缺少 ERROR_CODE_HTTP"
    pairs = re.findall(r"^\s*([a-z_]+):\s*(\d+),", http_block.group(1), re.MULTILINE)
    frontend_http = {name: int(status) for name, status in pairs}
    assert frontend_http == ERROR_CODE_HTTP


@pytest.mark.asyncio
async def test_handler_uses_catalog_mapping():
    app = create_app()

    @app.get("/_test/catalog-not-found")
    async def _nf():
        raise exc_mod.NotFoundError()

    @app.get("/_test/catalog-conflict")
    async def _cf():
        raise exc_mod.ConflictError("冲突")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/_test/catalog-not-found")
        assert res.status_code == ERROR_CODE_HTTP["not_found"]
        assert res.json() == {"error": ERROR_CODE_MESSAGES["not_found"]}
        res2 = await client.get("/_test/catalog-conflict")
        assert res2.status_code == ERROR_CODE_HTTP["conflict"]
        assert res2.json() == {"error": "冲突"}
