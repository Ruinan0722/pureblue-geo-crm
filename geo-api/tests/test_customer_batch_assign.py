"""客户批量分配销售负责人：请求体校验与响应形状。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.modules.crm.schemas import (
    BatchAssignCustomerOwnerBody,
    BatchAssignCustomerOwnerResponse,
)


def test_batch_assign_body_requires_ids_and_owner():
    body = BatchAssignCustomerOwnerBody(customer_ids=["c1", "c2"], owner="张三")
    assert body.customer_ids == ["c1", "c2"]
    assert body.owner == "张三"
    # camelCase alias
    body2 = BatchAssignCustomerOwnerBody.model_validate(
        {"customerIds": ["c3"], "owner": "李四"}
    )
    assert body2.customer_ids == ["c3"]


def test_batch_assign_body_rejects_empty_ids():
    with pytest.raises(PydanticValidationError):
        BatchAssignCustomerOwnerBody(customer_ids=[], owner="张三")


def test_batch_assign_body_rejects_over_100():
    with pytest.raises(PydanticValidationError):
        BatchAssignCustomerOwnerBody(
            customer_ids=[f"c{i}" for i in range(101)],
            owner="张三",
        )


def test_batch_assign_response_shape():
    resp = BatchAssignCustomerOwnerResponse(
        owner="王五",
        succeeded=[{"customer_id": "c1", "company_name": "甲公司"}],
        failed=[{"customer_id": "c2", "reason": "无权限执行此操作"}],
    )
    dumped = resp.model_dump(by_alias=True)
    assert dumped["owner"] == "王五"
    assert dumped["succeeded"][0]["customerId"] == "c1"
    assert dumped["failed"][0]["reason"] == "无权限执行此操作"
