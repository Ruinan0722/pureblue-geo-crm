from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.modules.requests.repository import RequestRepository


async def test_insert_retries_request_code_collision(monkeypatch):
    db = MagicMock()
    savepoints = [AsyncMock(), AsyncMock()]
    db.begin_nested = AsyncMock(side_effect=savepoints)
    db.flush = AsyncMock(
        side_effect=[IntegrityError("INSERT", {}, Exception("duplicate code")), None]
    )
    db.add = MagicMock()
    repo = RequestRepository(db)
    repo.find_recent_duplicate = AsyncMock(return_value=None)
    repo._sync_form_rows = AsyncMock()
    repo._record_with_children = AsyncMock(return_value="record")
    codes = iter(["GEO-OV-20260812-1000", "GEO-OV-20260812-1001"])
    monkeypatch.setattr(repo, "_generate_code", lambda data: next(codes))

    result = await repo.insert(
        staff_user_id="staff-1",
        invite_id="invite-1",
        owner_name="销售甲",
        data={"companyName": "Acme", "geoVariant": "overseas"},
        status="submitted",
    )

    assert result == "record"
    assert db.flush.await_count == 2
    savepoints[0].rollback.assert_awaited_once()
    savepoints[1].commit.assert_awaited_once()
    saved_row = repo._record_with_children.await_args.args[0]
    assert saved_row.code == "GEO-OV-20260812-1001"


async def test_insert_raises_after_five_request_code_collisions(monkeypatch):
    db = MagicMock()
    savepoints = [AsyncMock() for _ in range(5)]
    db.begin_nested = AsyncMock(side_effect=savepoints)
    collision = IntegrityError("INSERT", {}, Exception("duplicate code"))
    db.flush = AsyncMock(side_effect=[collision] * 5)
    db.add = MagicMock()
    repo = RequestRepository(db)
    repo.find_recent_duplicate = AsyncMock(return_value=None)
    monkeypatch.setattr(repo, "_generate_code", lambda data: "GEO-OV-20260812-1000")

    with pytest.raises(IntegrityError):
        await repo.insert(
            staff_user_id="staff-1",
            invite_id="invite-1",
            owner_name="销售甲",
            data={"companyName": "Acme", "geoVariant": "overseas"},
            status="submitted",
        )

    assert db.flush.await_count == 5
    for savepoint in savepoints:
        savepoint.rollback.assert_awaited_once()
