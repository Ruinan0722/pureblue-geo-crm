"""人员目录必须只信任运行时有效权限，不能用角色名绕过用户级 deny。"""

from app.modules.auth.schemas import AuthUser
from app.modules.users.router import _can_read_directory


def _user(*, role: str, permissions: list[str]) -> AuthUser:
    return AuthUser(
        id="u1",
        feishu_open_id="ou1",
        name="测试用户",
        role=role,
        permissions=permissions,
    )


def test_admin_without_effective_directory_permission_is_denied() -> None:
    assert not _can_read_directory(_user(role="admin", permissions=[]))
    assert not _can_read_directory(_user(role="super_admin", permissions=[]))


def test_related_effective_permission_allows_directory_for_any_role() -> None:
    assert _can_read_directory(_user(role="sales", permissions=["section:customers"]))
    assert _can_read_directory(_user(role="custom_role", permissions=["request:assign_owner"]))
