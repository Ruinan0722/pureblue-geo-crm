"""客户子公司独立表：写穿同步与读取。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.crm.repository import CrmRepository


@pytest.mark.asyncio
async def test_sync_customer_subsidiaries_writes_rows():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    customer = SimpleNamespace(id="c-1")
    await repo._sync_customer_subsidiaries(
        customer,
        {
            "subsidiaries": [
                {
                    "id": "SUB-1-01",
                    "name": "杭州秋田满满科技有限公司上海分公司",
                    "shortName": "上海分公司",
                    "creditCode": "91310000MA1XXXX",
                    "city": "上海",
                }
            ]
        },
    )
    added = [c.args[0] for c in db.add.call_args_list]
    rows = [x for x in added if x.__class__.__name__ == "CrmCustomerSubsidiary"]
    assert len(rows) == 1
    assert rows[0].id == "SUB-1-01"
    assert rows[0].customer_id == "c-1"
    assert rows[0].name.startswith("杭州秋田")
    assert rows[0].short_name == "上海分公司"
    assert rows[0].sort_order == 0
    db.execute.assert_awaited()


@pytest.mark.asyncio
async def test_sync_customer_subsidiaries_requires_key():
    from app.core.exceptions import ValidationError

    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    with pytest.raises(ValidationError, match="subsidiaries"):
        await repo._sync_customer_subsidiaries(SimpleNamespace(id="c-1"), {"companyName": "Acme"})
    db.execute.assert_not_called()
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_list_customer_subsidiaries_maps_camel_case():
    db = AsyncMock()
    db.add = MagicMock()
    repo = CrmRepository(db)
    row = SimpleNamespace(
        id="SUB-1",
        name="子公司A",
        short_name="分A",
        credit_code="X",
        city="杭州",
    )

    class _Result:
        def scalars(self):
            return self

        def all(self):
            return [row]

    db.execute = AsyncMock(return_value=_Result())
    out = await repo.list_customer_subsidiaries("c-1")
    assert out == [
        {
            "id": "SUB-1",
            "name": "子公司A",
            "shortName": "分A",
            "creditCode": "X",
            "city": "杭州",
        }
    ]
