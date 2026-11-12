"""Role privilege ranking for single-identity enforcement."""

from __future__ import annotations

BUILTIN_ROLE_PRIVILEGE: dict[str, int] = {
    "super_admin": 100,
    "admin": 80,
    "marketing_leader": 55,
    "marketing": 45,
    "sales": 40,
    "staff": 40,
    "viewer": 20,
}

DATA_SCOPE_PRIVILEGE: dict[str, int] = {
    "own": 1,
    "department": 2,
    "all": 3,
}


def role_privilege_rank(
    code: str,
    *,
    data_scope: str | None = None,
    permission_count: int = 0,
) -> int:
    if code in BUILTIN_ROLE_PRIVILEGE:
        return BUILTIN_ROLE_PRIVILEGE[code]
    scope = DATA_SCOPE_PRIVILEGE.get(data_scope or "own", 1)
    perms = min(max(permission_count, 0), 50)
    return 20 + scope * 10 + perms // 5


def pick_highest_privilege_role(
    roles: list[tuple[str, str | None, int]],
) -> str:
    """roles: list of (code, data_scope, permission_count)."""
    if not roles:
        raise ValueError("roles empty")
    best_code, best_rank = roles[0][0], role_privilege_rank(
        roles[0][0], data_scope=roles[0][1], permission_count=roles[0][2]
    )
    for code, data_scope, permission_count in roles[1:]:
        rank = role_privilege_rank(code, data_scope=data_scope, permission_count=permission_count)
        if rank > best_rank:
            best_code, best_rank = code, rank
    return best_code
