"""回归：user_role_assignments 写入必须携带 created_at/updated_at。

迁移 032 起这两列为 NOT NULL 且无 server default，漏写会触发
MySQL 1364（登录 / 组织同步均会 500）。
"""

from __future__ import annotations

from collections import namedtuple
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.users.repository import UsersRepository

_RoleRow = namedtuple("_RoleRow", ["id"])


@pytest.mark.asyncio
async def test_sync_feishu_primary_role_insert_carries_timestamps():
    db = AsyncMock()
    result = MagicMock()
    result.first.return_value = _RoleRow(id="role-sales")
    db.execute.return_value = result

    await UsersRepository(db).sync_feishu_primary_role("user-1", "sales")

    sql_calls = [str(c.args[0]) for c in db.execute.call_args_list]
    insert_sql = next(
        sql for sql in sql_calls if "INSERT INTO user_role_assignments" in sql
    )
    assert "created_at" in insert_sql
    assert "updated_at" in insert_sql
