"""SUPER_ADMIN_FEISHU_OPEN_ID 优先于 ADMIN 白名单。"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_is_super_admin_open_id(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPER_ADMIN_FEISHU_OPEN_ID", "ou_super")
    monkeypatch.setenv("ADMIN_FEISHU_OPEN_IDS", "ou_super,ou_admin")
    from app.config import get_settings
    from app.modules.users.role_resolver import _is_admin_open_id, is_super_admin_open_id

    get_settings.cache_clear()
    assert is_super_admin_open_id("ou_super") is True
    assert _is_admin_open_id("ou_super") is False
    assert _is_admin_open_id("ou_admin") is True
    assert is_super_admin_open_id("ou_admin") is False


@pytest.mark.asyncio
async def test_resolve_staff_role_prefers_super_admin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPER_ADMIN_FEISHU_OPEN_ID", "ou_super")
    monkeypatch.setenv("ADMIN_FEISHU_OPEN_IDS", "ou_admin")
    from app.config import get_settings
    from app.modules.users import role_resolver as rr

    get_settings.cache_clear()

    async def fake_rules(_db):
        return [("销售部", "sales")]

    monkeypatch.setattr(rr, "load_department_rules", fake_rules)

    role, depts = await rr.resolve_staff_role_for_login(
        db=None,  # type: ignore[arg-type]
        feishu_open_id="ou_super",
        department_names=["销售部"],
    )
    assert role == "super_admin"
    assert depts == ["销售部"]

    role2, _ = await rr.resolve_staff_role_for_login(
        db=None,  # type: ignore[arg-type]
        feishu_open_id="ou_admin",
        department_names=["销售部"],
    )
    assert role2 == "admin"


@pytest.mark.asyncio
async def test_resolve_staff_role_blocks_unmapped_department(monkeypatch: pytest.MonkeyPatch):
    """未映射部门不再回退为 sales：即使位于销售树内，无规则也直接拒绝登录。"""
    from app.config import get_settings
    from app.modules.users import role_resolver as rr

    get_settings.cache_clear()

    async def fake_rules(_db):
        return [("销售部", "sales")]

    monkeypatch.setattr(rr, "load_department_rules", fake_rules)

    with pytest.raises(RuntimeError):
        await rr.resolve_staff_role_for_login(
            db=None,  # type: ignore[arg-type]
            feishu_open_id="ou_unmapped",
            department_names=["销售管理中心 > 未映射部门"],
        )
