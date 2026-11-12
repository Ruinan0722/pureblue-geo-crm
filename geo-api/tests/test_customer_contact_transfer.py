"""联系人改派归属（方案 A：池间移动）：权限、可指派范围、主联系人、审计。"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.crm.schemas import TransferContactOwnerBody
from app.modules.crm.service import CrmService
from app.modules.crm.service.customers_coverage import _rebalance_contact_primary


def _user(
    *,
    user_id: str = "u-a",
    role: str = "leader",
    scope: str = "department",
    permissions: list[str] | None = None,
) -> AuthUser:
    perms = permissions or [
        "section:customers",
        "customers:contact_edit",
        "customers:contact_assign",
    ]
    return AuthUser(
        id=user_id,
        feishu_open_id=f"ou-{user_id}",
        name="Leader甲",
        role=role,
        permissions=perms,
        data_scope=scope,
        department_names=["销售Leader"],
    )


def _customer_row() -> SimpleNamespace:
    return SimpleNamespace(
        id="c1",
        company_name="Acme",
        document={"companyName": "Acme", "brandName": "Acme"},
    )


def _contact_row() -> SimpleNamespace:
    return SimpleNamespace(id="ct1", coverage_id="cv1", customer_id="c1", name="张三")


def _coverage_row(
    *, coverage_id: str = "cv1", owner_user_id: str = "u-a", status: str = "connected"
) -> SimpleNamespace:
    return SimpleNamespace(
        id=coverage_id,
        owner_user_id=owner_user_id,
        status=status,
        document={"ownerName": "销售A" if owner_user_id == "u-a" else "销售B"},
    )


def _patch_transfer_deps(svc) -> None:
    """成功路径依赖：源池一个主联系人、目标池已有联系人。"""
    source = _coverage_row()
    target = _coverage_row(coverage_id="cv2", owner_user_id="u-b", status="awaiting_contact")
    svc.repo.get_customer = AsyncMock(return_value=_customer_row())
    svc._assert_customer_master_readable = AsyncMock()
    svc.repo.get_coverage_contact = AsyncMock(return_value=_contact_row())
    svc.repo.get_coverage = AsyncMock(return_value=source)
    svc._assert_coverage_access = AsyncMock()
    svc._resolve_owner_user_id = AsyncMock(return_value="u-b")
    svc._assert_assignable_owner = AsyncMock()
    svc._owner_filter = AsyncMock(return_value=["u-a", "u-b"])
    svc._get_or_create_coverage = AsyncMock(return_value=(target, True))
    svc.repo.list_coverage_children = AsyncMock(
        return_value={
            "cv1": {
                "contacts": [
                    {"id": "ct1", "name": "张三", "title": "经理", "isPrimary": True},
                ],
                "notes": [],
                "attachments": [],
            },
            "cv2": {
                "contacts": [
                    {"id": "ct9", "name": "李四", "title": "顾问", "isPrimary": True},
                ],
                "notes": [],
                "attachments": [],
            },
        }
    )
    svc.repo.save_coverage = AsyncMock(side_effect=lambda row, document, status: row)
    svc.repo.create_audit_record = AsyncMock()
    svc._commit_and_invalidate_crm = AsyncMock()
    svc.get_coverage = AsyncMock(return_value={"id": "cv2"})
    return source, target


def test_transfer_body_alias_and_validation():
    body = TransferContactOwnerBody.model_validate({"targetOwnerName": "销售B"})
    assert body.target_owner_name == "销售B"
    with pytest.raises(PydanticValidationError):
        TransferContactOwnerBody(target_owner_name="")


def test_rebalance_contact_primary():
    contacts = [
        {"id": "a", "isPrimary": True},
        {"id": "b", "isPrimary": True},
    ]
    rebalanced = _rebalance_contact_primary(contacts)
    assert [c["isPrimary"] for c in rebalanced] == [True, False]
    assert _rebalance_contact_primary([{"id": "a", "isPrimary": False}])[0]["isPrimary"] is True
    assert _rebalance_contact_primary([]) == []


@pytest.mark.asyncio
async def test_leader_transfers_contact_to_subordinate_pool(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    source, _target = _patch_transfer_deps(svc)
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-a", "u-b", "u-c"]),
    )
    monkeypatch.setattr(
        UsersRepository,
        "get_by_id",
        AsyncMock(return_value=SimpleNamespace(name="销售B")),
    )

    result = await svc.transfer_customer_contact(
        _user(),
        customer_id="c1",
        contact_id="ct1",
        target_owner_name="销售B",
    )

    assert result == {"id": "cv2"}
    # 源池移除、目标池加入（保留 id），目标池已有主联系人时清掉移入的主标识
    source_args, _ = svc.repo.save_coverage.await_args_list[0]
    target_args, _ = svc.repo.save_coverage.await_args_list[1]
    assert source_args[1]["contacts"] == []
    moved = target_args[1]["contacts"][1]
    assert moved["id"] == "ct1"
    assert moved["isPrimary"] is False
    assert target_args[1]["contacts"][0]["id"] == "ct9"
    assert target_args[1]["contacts"][0]["isPrimary"] is True
    # 服务端审计
    audit_kwargs = svc.repo.create_audit_record.await_args.kwargs
    assert audit_kwargs["entity_type"] == "contact"
    assert audit_kwargs["entity_id"] == "ct1"
    assert audit_kwargs["related_entity_ids"] == ["c1"]
    assert audit_kwargs["action"] == "变更联系人归属"
    assert audit_kwargs["changes"][0] == {
        "field": "owner",
        "label": "成员归属",
        "before": "销售A",
        "after": "销售B",
    }
    svc._commit_and_invalidate_crm.assert_awaited_once_with("u-a", source.owner_user_id, "u-b")


@pytest.mark.asyncio
async def test_sales_without_assign_permission_denied():
    svc = CrmService(AsyncMock())
    sales = _user(
        user_id="u-s",
        role="sales",
        scope="own",
        permissions=["section:customers", "customers:contact_edit"],
    )
    with pytest.raises(PermissionDeniedError):
        await svc.transfer_customer_contact(
            sales,
            customer_id="c1",
            contact_id="ct1",
            target_owner_name="销售B",
        )


@pytest.mark.asyncio
async def test_leader_cannot_transfer_outside_managed_scope(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-a", "u-b", "u-c"]),
    )
    svc._owner_filter = AsyncMock(return_value=["u-a"])  # 管辖范围不含目标
    with pytest.raises(PermissionDeniedError, match="可见范围内"):
        await svc.transfer_customer_contact(
            _user(),
            customer_id="c1",
            contact_id="ct1",
            target_owner_name="销售B",
        )


@pytest.mark.asyncio
async def test_same_owner_is_noop_without_write(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-a", "u-b", "u-c"]),
    )
    admin = _user(user_id="u-admin", role="admin", scope="all")
    svc._resolve_owner_user_id = AsyncMock(return_value="u-a")  # 目标即源池负责人
    await svc.transfer_customer_contact(
        admin,
        customer_id="c1",
        contact_id="ct1",
        target_owner_name="销售A",
    )
    svc.repo.save_coverage.assert_not_called()
    svc.repo.create_audit_record.assert_not_called()


@pytest.mark.asyncio
async def test_leader_cannot_transfer_contact_to_self(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-a", "u-b", "u-c"]),
    )
    # 联系人位于下属 u-b 的池，Leader（u-a）尝试改派给自己
    svc.repo.get_coverage = AsyncMock(
        return_value=_coverage_row(coverage_id="cv1", owner_user_id="u-b")
    )
    svc._resolve_owner_user_id = AsyncMock(return_value="u-a")
    with pytest.raises(PermissionDeniedError, match="不能改派给自己"):
        await svc.transfer_customer_contact(
            _user(),
            customer_id="c1",
            contact_id="ct1",
            target_owner_name="Leader甲",
        )


@pytest.mark.asyncio
async def test_admin_cannot_transfer_to_non_sales_target(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    # 候选接口与 transfer 同一口径：all 范围也只能改派给销售成员目录
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-b"]),
    )
    admin = _user(user_id="u-admin", role="admin", scope="all")
    svc._resolve_owner_user_id = AsyncMock(return_value="u-x")  # 非销售成员
    with pytest.raises(PermissionDeniedError, match="销售成员目录"):
        await svc.transfer_customer_contact(
            admin,
            customer_id="c1",
            contact_id="ct1",
            target_owner_name="售前",
        )


@pytest.mark.asyncio
async def test_transfer_rejects_unassigned_target():
    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    with pytest.raises(ValidationError, match="有效的销售成员"):
        await svc.transfer_customer_contact(
            _user(),
            customer_id="c1",
            contact_id="ct1",
            target_owner_name="未分配",
        )


@pytest.mark.asyncio
async def test_transfer_contact_not_found():
    svc = CrmService(AsyncMock())
    _patch_transfer_deps(svc)
    svc.repo.get_coverage_contact = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError, match="联系人不存在"):
        await svc.transfer_customer_contact(
            _user(),
            customer_id="c1",
            contact_id="missing",
            target_owner_name="销售B",
        )


@pytest.mark.asyncio
async def test_assignable_owners_leader_filters_by_managed_scope(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    svc.repo.get_customer = AsyncMock(return_value=_customer_row())
    svc._owner_filter = AsyncMock(return_value=["u-a", "u-b"])
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-a", "u-b", "u-c"]),
    )
    monkeypatch.setattr(
        UsersRepository,
        "list_active_directory",
        AsyncMock(
            return_value=[
                SimpleNamespace(id="u-a", name="Leader甲"),
                SimpleNamespace(id="u-b", name="销售B"),
                SimpleNamespace(id="u-c", name="销售C"),
            ]
        ),
    )

    result = await svc.list_assignable_contact_owners(_user(), "c1")
    names = [item["name"] for item in result["items"]]
    # Leader 本人即使同时在销售目录与管辖范围内，也不作为归属候选
    assert names == ["销售B"]
    assert "销售C" not in names


@pytest.mark.asyncio
async def test_assignable_owners_admin_returns_sales_directory(monkeypatch):
    from app.modules.users.repository import UsersRepository

    svc = CrmService(AsyncMock())
    svc.repo.get_customer = AsyncMock(return_value=_customer_row())
    monkeypatch.setattr(
        UsersRepository,
        "get_sales_directory_user_ids",
        AsyncMock(return_value=["u-b", "u-c"]),
    )
    monkeypatch.setattr(
        UsersRepository,
        "list_active_directory",
        AsyncMock(
            return_value=[
                SimpleNamespace(id="u-b", name="销售B"),
                SimpleNamespace(id="u-c", name="销售C"),
            ]
        ),
    )

    admin = _user(user_id="u-admin", role="admin", scope="all")
    result = await svc.list_assignable_contact_owners(admin, "c1")
    names = [item["name"] for item in result["items"]]
    assert names == ["销售B", "销售C"]


@pytest.mark.asyncio
async def test_assignable_owners_requires_assign_permission():
    svc = CrmService(AsyncMock())
    sales = _user(
        user_id="u-s",
        role="sales",
        scope="own",
        permissions=["section:customers", "customers:contact_edit"],
    )
    with pytest.raises(PermissionDeniedError):
        await svc.list_assignable_contact_owners(sales, "c1")
