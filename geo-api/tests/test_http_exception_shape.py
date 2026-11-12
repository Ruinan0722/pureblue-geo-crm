"""HTTPException 序列化：dict detail 原样透传（409 冲突候选），字符串保持 {"error": ...}。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _app():
    app = create_app()

    @app.get("/_test/dict-detail")
    async def _dict_detail():
        raise HTTPException(
            status_code=409,
            detail={
                "message": "该公司已存在客户档案，请关联公司并建立我的对接，勿重复新建",
                "code": "conflict",
                "reason": "company_exists",
                "candidates": [{"id": "c1", "companyName": "Acme", "owner": "销售A"}],
                "hiddenMatchCount": 0,
            },
        )

    @app.get("/_test/str-detail")
    async def _str_detail():
        raise HTTPException(status_code=400, detail="公司名称不能为空")

    return app


@pytest.mark.asyncio
async def test_http_exception_keeps_dict_detail():
    transport = ASGITransport(app=_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/_test/dict-detail")
    assert res.status_code == 409
    body = res.json()
    assert body["error"].startswith("该公司已存在")
    assert body["detail"]["reason"] == "company_exists"
    assert body["detail"]["candidates"][0]["id"] == "c1"
    assert body["detail"]["message"].startswith("该公司已存在")


@pytest.mark.asyncio
async def test_http_exception_string_detail_stays_error_shape():
    transport = ASGITransport(app=_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/_test/str-detail")
    assert res.status_code == 400
    assert res.json() == {"error": "公司名称不能为空"}
