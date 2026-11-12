"""固定邀请链接：自动配发、仅本人可见、确定性 token、resolve 可用。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import OperationalError

from app.core.exceptions import PermissionDeniedError
from app.modules.auth.schemas import AuthUser
from app.modules.invites.service import InviteService


def _user(*, perms: list[str], user_id: str = "u-1", role: str = "sales") -> AuthUser:
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="员工",
        role=role,
        permissions=perms,
        data_scope="own",
    )


def _fixed_row(variant: str, user_id: str = "u-1"):
    return SimpleNamespace(
        id=f"inv-{variant}",
        token=f"staff-{user_id}-{variant}",
        staff_user_id=user_id,
        label=None,
        geo_variant=variant,
        revoked_at=None,
        visit_count=3,
        created_at="2026-08-07 00:00:00",
        is_fixed=True,
    )


def _svc(rows: list) -> InviteService:
    db = AsyncMock()
    svc = InviteService(db)
    svc.repo.get_fixed = AsyncMock(side_effect=lambda staff_id, variant: next(
        (r for r in rows if r.geo_variant == variant), None
    ))
    svc.repo.create_fixed = AsyncMock()
    return svc


def test_fixed_token_is_deterministic():
    svc = InviteService(AsyncMock())
    assert svc._fixed_token("u-1", "overseas") == "staff-u-1-overseas"
    assert svc._fixed_token("u-1", "overseas") == svc._fixed_token("u-1", "overseas")
    assert svc._fixed_token("u-1", "overseas") != svc._fixed_token("u-1", "domestic")


@pytest.mark.asyncio
async def test_list_requires_invite_manage():
    svc = _svc([])
    with pytest.raises(PermissionDeniedError):
        await svc.list_for_user(_user(perms=["section:requests"]))


@pytest.mark.asyncio
async def test_list_returns_only_own_fixed_invites():
    svc = _svc([_fixed_row("overseas"), _fixed_row("domestic")])
    out = await svc.list_for_user(_user(perms=["invite:manage"], user_id="u-1"))
    assert [i.geo_variant for i in out.invites] == ["overseas", "domestic"]
    assert all(i.staff_user_id == "u-1" for i in out.invites)
    assert all(i.url for i in out.invites)
    assert all(i.is_fixed for i in out.invites)


@pytest.mark.asyncio
async def test_list_auto_creates_missing_fixed_invites():
    db = AsyncMock()
    nested = AsyncMock()
    nested.__aenter__ = AsyncMock(return_value=None)
    nested.__aexit__ = AsyncMock(return_value=False)
    db.begin_nested = lambda: nested
    svc = InviteService(db)
    svc.repo.get_fixed = AsyncMock(return_value=None)
    svc.repo.get_by_token = AsyncMock(return_value=None)
    svc.repo.create_fixed = AsyncMock(side_effect=lambda staff_id, token, *, geo_variant="overseas": _fixed_row(geo_variant, staff_id))
    out = await svc.ensure_fixed_invites(_user(perms=["invite:manage"]))
    assert [i.geo_variant for i in out] == ["overseas", "domestic"]
    assert svc.repo.create_fixed.await_count == 2


@pytest.mark.asyncio
async def test_list_resurrects_stale_fixed_rows_with_same_token():
    """确定性 token 已存在（迁移/重置残留、is_fixed=0）时复活旧行，避免唯一约束冲突。"""
    db = AsyncMock()
    svc = InviteService(db)
    svc.repo.get_fixed = AsyncMock(return_value=None)
    svc.repo.get_by_token = AsyncMock(
        side_effect=lambda token: SimpleNamespace(
            id=f"inv-stale-{token.split('-')[-1]}",
            token=token,
            geo_variant=token.split("-")[-1],
        )
    )
    svc.repo.reactivate_fixed = AsyncMock(side_effect=lambda invite_id: _fixed_row(invite_id.rsplit("-", 1)[-1]))
    svc.repo.create_fixed = AsyncMock()
    out = await svc.ensure_fixed_invites(_user(perms=["invite:manage"]))
    assert [i.geo_variant for i in out] == ["overseas", "domestic"]
    assert svc.repo.reactivate_fixed.await_count == 2
    svc.repo.create_fixed.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_one_fixed_reuses_row_after_unique_conflict():
    """同 token 并发 INSERT 时，savepoint 冲突后按 token 复用，不向外抛 500。"""
    from sqlalchemy.exc import IntegrityError

    db = AsyncMock()
    # begin_nested 作为 async context manager
    nested = AsyncMock()
    nested.__aenter__ = AsyncMock(return_value=None)
    nested.__aexit__ = AsyncMock(return_value=False)
    db.begin_nested = lambda: nested

    svc = InviteService(db)
    svc.repo.get_fixed = AsyncMock(return_value=None)
    svc.repo.get_by_token = AsyncMock(
        side_effect=[
            None,  # 创建前
            _fixed_row("overseas"),  # 冲突后回读
        ]
    )
    svc.repo.create_fixed = AsyncMock(
        side_effect=IntegrityError("INSERT", {}, Exception("Duplicate entry"))
    )
    svc.repo.reactivate_fixed = AsyncMock(return_value=_fixed_row("overseas"))

    row = await svc._ensure_one_fixed(_user(perms=["invite:manage"]), "overseas")
    assert row.token == "staff-u-1-overseas"
    svc.repo.reactivate_fixed.assert_awaited()


@pytest.mark.asyncio
async def test_ensure_fixed_retries_after_concurrent_insert():
    """并发首次配发（快速切换用户）插入同一 token 触发死锁/唯一约束时，重试复用已插入行。"""
    db = AsyncMock()
    svc = InviteService(db)
    calls = {"create": 0}

    async def fake_get_fixed(staff_id, variant):
        if calls["create"] > 0:
            return _fixed_row(variant, staff_id)
        return None

    async def fake_get_by_token(token):
        return None

    async def fake_create_fixed(staff_id, token, *, geo_variant="overseas"):
        calls["create"] += 1
        raise OperationalError("INSERT INTO invites", {}, Exception("deadlock"))

    nested = AsyncMock()
    nested.__aenter__ = AsyncMock(return_value=None)
    nested.__aexit__ = AsyncMock(return_value=False)
    db.begin_nested = lambda: nested

    svc.repo.get_fixed = fake_get_fixed
    svc.repo.get_by_token = fake_get_by_token
    svc.repo.create_fixed = fake_create_fixed
    out = await svc.ensure_fixed_invites(_user(perms=["invite:manage"]))
    assert [i.geo_variant for i in out] == ["overseas", "domestic"]
    # 第一次插入冲突 → 整体重试后两个变体都复用已插入行，不再重复创建
    assert calls["create"] == 1


@pytest.mark.asyncio
async def test_resolve_works_for_fixed_token():
    db = AsyncMock()
    svc = InviteService(db)
    svc.repo.get_by_token = AsyncMock(return_value=_fixed_row("overseas"))
    svc.repo.increment_visit = AsyncMock()
    svc.repo.get_staff_name = AsyncMock(return_value="销售甲")
    out = await svc.resolve("staff-u-1-overseas", count_visit=True)
    assert out.valid is True
    assert out.geo_variant == "overseas"
    assert out.staff_name == "销售甲"
    svc.repo.increment_visit.assert_awaited_once_with("staff-u-1-overseas")
