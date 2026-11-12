"""飞书通讯录：销售部成员（与 geo-admin feishu-contact 对齐）。

缓存层级（关 REDIS 不等于关飞书缓存）：
1. Redis：`feishu:sales_colleagues` / `feishu:dept_tree:*`
2. 本模块进程内 `_sales_members_cache` / `_department_tree_cache`（降级与防惊群）
3. geo-admin 另有独立进程内缓存（设置页选人）

组织同步或权限变更后应走 cache_invalidation.invalidate_feishu_caches，必要时重启 worker。
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from app.config import get_settings
from app.core.feishu.client import clear_feishu_token_memory, feishu_get, get_tenant_access_token
from app.core.feishu.department_labels import (
    resolve_department_breadcrumb,
    resolve_department_display_path,
    strip_company_root_prefix,
)
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

SALES_MEMBERS_CACHE_TTL_SEC = 30 * 60
DEPARTMENT_TREE_CACHE_TTL_SEC = 60 * 60
# 部门负责人映射：与部门树同频（60min）。树有缓存但「部门→负责人」batch 查询无缓存，
# 导致每个 Leader 的列表/详情请求都重新打飞书 departments/batch（本地刷屏 + 配额消耗）。
LED_DEPT_IDS_CACHE_TTL_SEC = 60 * 60

# 进程内短缓存（Redis miss 时防同进程惊群）；失效时一并清空
_sales_members_cache: dict[str, object] | None = None
_department_tree_cache: dict[str, tuple[float, list[str]]] = {}
_led_dept_ids_cache: dict[str, tuple[float, list[str]]] = {}
_sales_members_lock = asyncio.Lock()


@dataclass(frozen=True)
class SalesColleague:
    feishu_open_id: str
    name: str
    department_ids: tuple[str, ...] = ()
    job_title: str | None = None


def _is_active_user(user: dict) -> bool:
    """判断飞书用户是否在职可用。

    离职残留常见形态：batch 仍返回姓名/头像等精简字段，但 ``status`` 缺失或为空对象，
    且无 ``department_ids``——按已离职处理，避免继续当作在职同步进库。
    """
    status = user.get("status")
    department_ids = user.get("department_ids")
    if not department_ids and (status is None or status == {}):
        return False

    status = status or {}
    return not any(
        status.get(k)
        for k in ("is_frozen", "is_resigned", "is_exited", "is_unjoin")
    )


async def _fetch_departments_batch(department_ids: list[str]) -> list[dict]:
    if not department_ids:
        return []
    qs = "&".join(f"department_ids={did}" for did in department_ids)
    data = await feishu_get(
        f"/contact/v3/departments/batch?"
        f"department_id_type=open_department_id&user_id_type=open_id&{qs}"
    )
    return data.get("items") or []


def _department_leader_open_ids(item: dict) -> set[str]:
    """从飞书部门对象提取负责人 open_id（leader_user_id + leaders[]）。"""
    leaders: set[str] = set()
    primary = item.get("leader_user_id")
    if isinstance(primary, str) and primary.strip():
        leaders.add(primary.strip())
    for entry in item.get("leaders") or []:
        if not isinstance(entry, dict):
            continue
        lid = entry.get("leaderID") or entry.get("leader_id") or entry.get("leaderId")
        if isinstance(lid, str) and lid.strip():
            leaders.add(lid.strip())
    return leaders


def _org_and_sales_root_department_ids() -> list[str]:
    from app.config import get_settings

    settings = get_settings()
    return list(
        dict.fromkeys(
            [*settings.sales_department_id_list, *settings.org_root_department_id_list]
        )
    )


async def fetch_department_leaders_by_open_id_for_roots(
    root_ids: list[str] | None = None,
) -> dict[str, list[tuple[str, str]]]:
    """扫描配置根子树，返回 open_id → 按 dept_id 排序的 (dept_id, dept_name) 列表。"""
    roots = list(dict.fromkeys(rid for rid in (root_ids or _org_and_sales_root_department_ids()) if rid))
    if not roots:
        return {}

    tree_ids = await collect_department_tree_ids_for_roots(roots)
    if not tree_ids:
        return {}

    by_leader: dict[str, list[tuple[str, str]]] = {}
    for i in range(0, len(tree_ids), 50):
        chunk = tree_ids[i : i + 50]
        for item in await _fetch_departments_batch(chunk):
            dept_id = item.get("open_department_id")
            if not isinstance(dept_id, str) or not dept_id:
                continue
            dept_name = resolve_department_display_path(
                dept_id,
                fallback=(item.get("name") or "").strip() or None,
            )
            for leader_oid in _department_leader_open_ids(item):
                by_leader.setdefault(leader_oid, []).append((dept_id, dept_name))

    for oid, pairs in by_leader.items():
        # 同部门去重后按 dept_id 排序，保证主负责部门稳定
        unique = {dept_id: name for dept_id, name in pairs}
        by_leader[oid] = sorted(unique.items(), key=lambda x: x[0])
    return by_leader


async def fetch_department_ids_led_by_open_id(open_id: str) -> list[str]:
    """返回飞书中该用户作为部门负责人的 open_department_id（限销售/组织根子树）。

    用于销售 Leader 的 data_scope=department：按「负责人」可见其负责部门及下级。
    """
    oid = (open_id or "").strip()
    if not oid:
        return []

    now = time.time()
    cached = _led_dept_ids_cache.get(oid)
    if cached and cached[0] > now:
        return list(cached[1])

    roots = _org_and_sales_root_department_ids()
    if not roots:
        return []

    tree_ids = await collect_department_tree_ids_for_roots(roots)
    if not tree_ids:
        return []

    led: list[str] = []
    seen: set[str] = set()
    for i in range(0, len(tree_ids), 50):
        chunk = tree_ids[i : i + 50]
        for item in await _fetch_departments_batch(chunk):
            if oid not in _department_leader_open_ids(item):
                continue
            dept_id = item.get("open_department_id")
            if isinstance(dept_id, str) and dept_id and dept_id not in seen:
                seen.add(dept_id)
                led.append(dept_id)
    _led_dept_ids_cache[oid] = (now + LED_DEPT_IDS_CACHE_TTL_SEC, led)
    return led


async def list_child_departments(parent_id: str, token: str) -> list[dict[str, str]]:
    """飞书「获取子部门列表」：返回 {id, name}（open_department_id）。"""
    children: list[dict[str, str]] = []
    page_token: str | None = None
    while True:
        params = "department_id_type=open_department_id&page_size=50"
        if page_token:
            params += f"&page_token={page_token}"
        data = await feishu_get(
            f"/contact/v3/departments/{parent_id}/children?{params}",
            token=token,
        )
        for item in data.get("items") or []:
            dept_id = str(item.get("open_department_id") or "").strip()
            name = str(item.get("name") or "").strip()
            if dept_id:
                children.append({"id": dept_id, "name": name or dept_id})
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return children


async def _list_child_department_ids(parent_id: str, token: str) -> list[str]:
    return [item["id"] for item in await list_child_departments(parent_id, token)]


async def _get_dept_tree_cached(root_id: str) -> list[str] | None:
    mem = _department_tree_cache.get(root_id)
    if mem and mem[0] > time.time():
        return mem[1]
    cached = await get_redis().cache_get("feishu", "dept_tree", root_id)
    if isinstance(cached, list) and all(isinstance(x, str) for x in cached):
        _department_tree_cache[root_id] = (time.time() + DEPARTMENT_TREE_CACHE_TTL_SEC, list(cached))
        return list(cached)
    return None


async def _set_dept_tree_cached(root_id: str, dept_ids: list[str]) -> None:
    _department_tree_cache[root_id] = (time.time() + DEPARTMENT_TREE_CACHE_TTL_SEC, dept_ids)
    await get_redis().cache_set(
        "feishu",
        "dept_tree",
        root_id,
        value=dept_ids,
        ttl=DEPARTMENT_TREE_CACHE_TTL_SEC,
    )


def clear_feishu_contact_memory_caches() -> None:
    """组织同步失效时清空进程内飞书缓存。"""
    global _sales_members_cache
    _sales_members_cache = None
    _department_tree_cache.clear()
    _led_dept_ids_cache.clear()
    clear_feishu_token_memory()


async def _collect_department_tree_ids(root_id: str, token: str) -> list[str]:
    cached = await _get_dept_tree_cached(root_id)
    if cached is not None:
        return cached

    ids = {root_id}
    frontier = [root_id]
    while frontier:
        child_lists = await asyncio.gather(
            *(_list_child_department_ids(pid, token) for pid in frontier)
        )
        next_frontier: list[str] = []
        for child_ids in child_lists:
            for cid in child_ids:
                if cid not in ids:
                    ids.add(cid)
                    next_frontier.append(cid)
        frontier = next_frontier

    result = list(ids)
    await _set_dept_tree_cached(root_id, result)
    return result


async def collect_department_tree_ids_for_roots(
    root_ids: list[str],
    token: str | None = None,
) -> list[str]:
    """并发拉取多个根部门下的全部子部门 ID（飞书无「一次返回整棵树」接口，按层 BFS + gather）。"""
    access_token = token or await get_tenant_access_token()
    unique_roots = list(dict.fromkeys(root_id for root_id in root_ids if root_id))
    if not unique_roots:
        return []

    async def _walk_one_root(root_id: str) -> set[str]:
        cached = await _get_dept_tree_cached(root_id)
        if cached is not None:
            return set(cached)

        ids = {root_id}
        frontier = [root_id]
        while frontier:
            child_lists = await asyncio.gather(
                *(_list_child_department_ids(pid, access_token) for pid in frontier)
            )
            next_frontier: list[str] = []
            for child_ids in child_lists:
                for cid in child_ids:
                    if cid not in ids:
                        ids.add(cid)
                        next_frontier.append(cid)
            frontier = next_frontier

        result = list(ids)
        await _set_dept_tree_cached(root_id, result)
        return set(result)

    root_sets = await asyncio.gather(*(_walk_one_root(root_id) for root_id in unique_roots))
    merged: set[str] = set()
    for dept_ids in root_sets:
        merged.update(dept_ids)
    return list(merged)


async def fetch_users_in_departments_concurrent(
    department_ids: list[str],
    *,
    token: str | None = None,
    concurrency: int = 8,
    active_only: bool = True,
) -> dict[str, dict]:
    """按部门并发拉取成员（find_by_department），返回 open_id → user。"""
    access_token = token or await get_tenant_access_token()
    unique_dept_ids = list(dict.fromkeys(dept_id for dept_id in department_ids if dept_id))
    if not unique_dept_ids:
        return {}

    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def _fetch_one(dept_id: str) -> list[dict]:
        async with semaphore:
            return await _fetch_users_in_department(dept_id, access_token)

    user_lists = await asyncio.gather(*(_fetch_one(dept_id) for dept_id in unique_dept_ids))
    by_open_id: dict[str, dict] = {}
    for users in user_lists:
        for user in users:
            open_id = user.get("open_id")
            if not open_id:
                continue
            if active_only and not _is_active_user(user):
                continue
            by_open_id[str(open_id)] = user
    return by_open_id


async def discover_active_open_ids_from_roots(
    root_ids: list[str],
    *,
    concurrency: int = 8,
) -> set[str]:
    """先拉部门树，再按部门并发拉成员，汇总在职 open_id。"""
    token = await get_tenant_access_token()
    dept_ids = await collect_department_tree_ids_for_roots(root_ids, token)
    users = await fetch_users_in_departments_concurrent(
        dept_ids,
        token=token,
        concurrency=concurrency,
        active_only=True,
    )
    return set(users.keys())


async def fetch_contact_scopes(token: str | None = None) -> dict:
    """应用通讯录可见范围（部门 / 用户 / 用户组）。"""
    access_token = token or await get_tenant_access_token()
    data = await feishu_get(
        "/contact/v3/scopes?user_id_type=open_id&department_id_type=open_department_id",
        token=access_token,
    )
    return data if isinstance(data, dict) else {}


async def discover_active_open_ids_for_org_sync(
    configured_roots: list[str],
    *,
    concurrency: int = 8,
) -> set[str]:
    """组织同步用的在职 open_id 集合。

    合并：配置根部门 ∪ 应用可见部门 scopes ∪ 根部门 ``0`` 直属成员 ∪ scopes 单独授权用户。
    避免仅靠不完整的 ``FEISHU_ORG_ROOT_DEPARTMENT_IDS`` 漏掉人力/财务/租户根成员等。
    """
    token = await get_tenant_access_token()
    root_ids = list(dict.fromkeys(rid for rid in configured_roots if rid))
    scope_user_ids: list[str] = []

    try:
        scopes = await fetch_contact_scopes(token)
        for did in scopes.get("department_ids") or []:
            if isinstance(did, str) and did.strip() and did not in root_ids:
                root_ids.append(did)
        scope_user_ids = [
            uid
            for uid in (scopes.get("user_ids") or [])
            if isinstance(uid, str) and uid.startswith("ou_")
        ]
    except Exception as exc:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
        logger.warning("飞书 scopes 拉取失败，仅使用配置根部门: %s", exc)

    discovered: set[str] = set()
    if root_ids:
        discovered |= await discover_active_open_ids_from_roots(
            root_ids,
            concurrency=concurrency,
        )

    # 租户根部门「0」上可能有不在任何子部门的成员（如管理员）
    try:
        dept0_users = await fetch_users_in_departments_concurrent(
            ["0"],
            token=token,
            concurrency=1,
            active_only=True,
        )
        discovered.update(dept0_users.keys())
    except Exception as exc:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
        logger.warning("飞书根部门 0 成员拉取失败: %s", exc)

    if scope_user_ids:
        missing = [oid for oid in scope_user_ids if oid not in discovered]
        if missing:
            batch = await fetch_feishu_users_batch(missing)
            for oid, user in batch.items():
                if _is_active_user(user):
                    discovered.add(oid)

    logger.info(
        "飞书组织发现：roots=%d discovered=%d scope_users=%d",
        len(root_ids),
        len(discovered),
        len(scope_user_ids),
    )
    return discovered


async def _fetch_users_in_department(department_id: str, token: str) -> list[dict]:
    users: list[dict] = []
    page_token: str | None = None
    while True:
        params = (
            f"department_id={department_id}"
            "&department_id_type=open_department_id"
            "&user_id_type=open_id"
            "&page_size=50"
        )
        if page_token:
            params += f"&page_token={page_token}"
        data = await feishu_get(f"/contact/v3/users/find_by_department?{params}", token=token)
        users.extend(data.get("items") or [])
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return users


async def _fetch_users_in_department_tree(root_id: str, token: str) -> list[dict]:
    dept_ids = await _collect_department_tree_ids(root_id, token)
    user_lists = await asyncio.gather(
        *(_fetch_users_in_department(did, token) for did in dept_ids)
    )
    return [u for batch in user_lists for u in batch]


def resolve_sales_department_ids() -> list[str]:
    settings = get_settings()
    return list(dict.fromkeys(settings.sales_department_id_list))


async def _load_sales_members() -> list[SalesColleague]:
    token = await get_tenant_access_token()
    department_ids = resolve_sales_department_ids()
    if not department_ids:
        raise RuntimeError(
            "未能定位销售部部门 ID。请在环境变量 FEISHU_SALES_DEPARTMENT_IDS 中配置 open_department_id。"
        )

    by_open_id: dict[str, SalesColleague] = {}
    user_lists = await asyncio.gather(
        *(_fetch_users_in_department_tree(did, token) for did in department_ids)
    )
    for users in user_lists:
        for user in users:
            open_id = user.get("open_id")
            name = (user.get("name") or "").strip()
            if not open_id or not name or not _is_active_user(user):
                continue
            dept_ids = tuple(d for d in (user.get("department_ids") or []) if isinstance(d, str))
            job_title = (user.get("job_title") or "").strip() or None
            by_open_id[open_id] = SalesColleague(
                feishu_open_id=open_id,
                name=name,
                department_ids=dept_ids,
                job_title=job_title,
            )

    colleagues = sorted(by_open_id.values(), key=lambda c: c.name)
    if not colleagues:
        raise RuntimeError("飞书销售部暂无可用成员，请检查 FEISHU_SALES_DEPARTMENT_IDS 或通讯录权限范围")
    return colleagues


async def fetch_feishu_user_detail(open_id: str) -> dict:
    data = await feishu_get(
        f"/contact/v3/users/{open_id}?user_id_type=open_id&department_id_type=open_department_id",
    )
    user = data.get("user")
    if not user:
        raise RuntimeError("飞书未返回用户信息")
    return user


async def fetch_feishu_users_batch(open_ids: list[str]) -> dict[str, dict]:
    """批量拉取用户信息，最多 50 人/次（飞书 contact/v3/users/batch）。"""
    users: dict[str, dict] = {}
    unique_ids = [
        oid for oid in dict.fromkeys(open_ids)
        if oid and str(oid).startswith("ou_")
    ]
    for index in range(0, len(unique_ids), 50):
        chunk = unique_ids[index : index + 50]
        qs = "&".join(f"user_ids={oid}" for oid in chunk)
        data = await feishu_get(
            "/contact/v3/users/batch"
            f"?user_id_type=open_id&department_id_type=open_department_id&{qs}"
        )
        for user in data.get("items") or []:
            open_id = user.get("open_id")
            if open_id:
                users[str(open_id)] = user
    return users


async def fetch_feishu_user_department_ids(open_id: str) -> list[str]:
    user = await fetch_feishu_user_detail(open_id)
    return user.get("department_ids") or []


async def _load_department_records(department_ids: list[str]) -> dict[str, dict]:
    """批量拉取部门信息（含 parent_department_id，需 contact:department.organize:readonly）。"""
    cache: dict[str, dict] = {}
    pending = {d for d in department_ids if d}
    while pending:
        chunk = list(pending)[:50]
        pending -= set(chunk)
        for item in await _fetch_departments_batch(chunk):
            dept_id = item.get("open_department_id")
            if dept_id:
                cache[dept_id] = item
        for dept_id in list(chunk):
            parent = (cache.get(dept_id) or {}).get("parent_department_id")
            if parent and parent not in ("0", "") and parent not in cache:
                pending.add(parent)
    return cache


def _build_department_breadcrumb(department_id: str, cache: dict[str, dict]) -> str:
    """实时优先：沿父链用飞书 API 部门名拼完整路径。

    飞书应用开通 contact:department.base:readonly 后，部门记录带 name；
    链上任一节点拿不到名字（缓存缺失/部门已删）时回退本地配置 breadcrumb。
    """
    parts: list[str] = []
    current: str | None = department_id
    visited: set[str] = set()
    while current and current not in ("0", "") and current not in visited:
        visited.add(current)
        record = cache.get(current)
        name = (record.get("name") or "").strip() if record else ""
        if not name:
            return resolve_department_breadcrumb(department_id) or ""
        parts.append(name)
        parent = record.get("parent_department_id") if record else None
        current = parent if isinstance(parent, str) and parent not in ("0", "") else None
    parts.reverse()
    path = strip_company_root_prefix(" > ".join(parts))
    return path or resolve_department_breadcrumb(department_id) or ""


def _extract_avatar_url(user: dict, fallback: str | None = None) -> str | None:
    avatar = user.get("avatar")
    if isinstance(avatar, dict):
        raw = (
            avatar.get("avatar_72")
            or avatar.get("avatar_240")
            or avatar.get("avatar_origin")
            or fallback
            or ""
        )
    elif isinstance(avatar, str):
        raw = avatar or fallback or ""
    else:
        raw = fallback or ""
    trimmed = str(raw).strip()
    return trimmed or None


def build_feishu_user_org_profile_from_records(
    user: dict,
    dept_cache: dict[str, dict],
    *,
    open_id: str | None = None,
    fallback_name: str | None = None,
    fallback_avatar: str | None = None,
) -> dict:
    """用已拉取的用户与部门缓存组装组织快照（不再请求飞书）。"""
    resolved_open_id = (open_id or user.get("open_id") or "").strip()
    if not resolved_open_id:
        raise RuntimeError("飞书未返回用户 open_id")

    department_ids = [
        d for d in (user.get("department_ids") or [])
        if isinstance(d, str) and d and d != "0"
    ]
    department_names: list[str] = []
    department_breadcrumbs: list[str] = []
    for dept_id in department_ids:
        record = dept_cache.get(dept_id) or {}
        api_name = (record.get("name") or "").strip() or None
        breadcrumb = _build_department_breadcrumb(dept_id, dept_cache)
        display_path = breadcrumb or api_name or resolve_department_display_path(dept_id)
        if display_path and display_path not in department_names:
            department_names.append(display_path)
        if breadcrumb and breadcrumb not in department_breadcrumbs:
            department_breadcrumbs.append(breadcrumb)
        elif display_path and display_path not in department_breadcrumbs:
            department_breadcrumbs.append(display_path)

    name = (user.get("name") or fallback_name or "").strip()
    if not name:
        raise RuntimeError("飞书未返回用户姓名")

    avatar_url = _extract_avatar_url(user, fallback_avatar)
    job_title = (user.get("job_title") or "").strip() or None

    return {
        "feishu_open_id": resolved_open_id,
        "name": name,
        "avatar_url": avatar_url,
        "department_ids": department_ids,
        "department_names": department_names,
        "department_breadcrumbs": department_breadcrumbs,
        "primary_department_open_id": department_ids[0] if department_ids else None,
        "primary_department_breadcrumb": department_breadcrumbs[0] if department_breadcrumbs else None,
        "job_title": job_title,
        "is_active": _is_active_user(user),
    }


async def resolve_feishu_user_org_profile(
    open_id: str,
    *,
    fallback_name: str | None = None,
    fallback_avatar: str | None = None,
) -> dict:
    """从飞书拉取用户组织信息快照（姓名、部门名、部门路径）。"""
    user = await fetch_feishu_user_detail(open_id)
    department_ids = [d for d in (user.get("department_ids") or []) if isinstance(d, str) and d]
    cache = await _load_department_records(department_ids)
    return build_feishu_user_org_profile_from_records(
        user,
        cache,
        open_id=open_id,
        fallback_name=fallback_name,
        fallback_avatar=fallback_avatar,
    )


async def get_configured_sales_department_tree_ids() -> set[str]:
    token = await get_tenant_access_token()
    ids: set[str] = set()
    for root_id in resolve_sales_department_ids():
        for dept_id in await _collect_department_tree_ids(root_id, token):
            ids.add(dept_id)
    return ids


async def is_user_in_sales_department_tree(open_id: str) -> bool:
    department_ids = await fetch_feishu_user_department_ids(open_id)
    if department_ids:
        tree_ids = await get_configured_sales_department_tree_ids()
        if any(dept_id in tree_ids for dept_id in department_ids):
            return True

    try:
        members = await fetch_sales_department_members()
        return any(member.feishu_open_id == open_id for member in members)
    except RuntimeError as exc:
        print(f"[feishu-contact] 销售部组织树成员校验失败: {exc}")
        return False


async def fetch_feishu_user_department_names(open_id: str) -> list[str]:
    department_ids = await fetch_feishu_user_department_ids(open_id)
    if not department_ids:
        return []

    names: list[str] = []
    for i in range(0, len(department_ids), 50):
        chunk = department_ids[i : i + 50]
        qs = "&".join(f"department_ids={did}" for did in chunk)
        batch = await feishu_get(
            f"/contact/v3/departments/batch?department_id_type=open_department_id&{qs}"
        )
        for item in batch.get("items") or []:
            name = (item.get("name") or "").strip()
            if name:
                names.append(name)
    return names


def _colleagues_from_cache_payload(raw: object) -> list[SalesColleague] | None:
    if not isinstance(raw, list):
        return None
    out: list[SalesColleague] = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        open_id = item.get("feishu_open_id") or item.get("feishuOpenId")
        name = item.get("name")
        if not open_id or not name:
            return None
        dept_ids = item.get("department_ids") or item.get("departmentIds") or []
        if not isinstance(dept_ids, list):
            dept_ids = []
        out.append(
            SalesColleague(
                feishu_open_id=str(open_id),
                name=str(name),
                department_ids=tuple(str(d) for d in dept_ids if d),
                job_title=(str(item["job_title"]) if item.get("job_title") else None),
            )
        )
    return out


def _colleagues_to_cache_payload(colleagues: list[SalesColleague]) -> list[dict]:
    return [
        {
            "feishu_open_id": c.feishu_open_id,
            "name": c.name,
            "department_ids": list(c.department_ids),
            "job_title": c.job_title,
        }
        for c in colleagues
    ]


async def fetch_sales_department_members() -> list[SalesColleague]:
    global _sales_members_cache

    if _sales_members_cache:
        expires = float(_sales_members_cache["expires_at"])  # type: ignore[arg-type]
        if expires > time.time():
            return _sales_members_cache["colleagues"]  # type: ignore[return-value]

    redis_cached = await get_redis().cache_get("feishu", "sales_colleagues")
    parsed = _colleagues_from_cache_payload(redis_cached)
    if parsed is not None:
        _sales_members_cache = {
            "expires_at": time.time() + SALES_MEMBERS_CACHE_TTL_SEC,
            "colleagues": parsed,
        }
        return parsed

    async with _sales_members_lock:
        if _sales_members_cache:
            expires = float(_sales_members_cache["expires_at"])  # type: ignore[arg-type]
            if expires > time.time():
                return _sales_members_cache["colleagues"]  # type: ignore[return-value]

        redis_again = await get_redis().cache_get("feishu", "sales_colleagues")
        parsed_again = _colleagues_from_cache_payload(redis_again)
        if parsed_again is not None:
            _sales_members_cache = {
                "expires_at": time.time() + SALES_MEMBERS_CACHE_TTL_SEC,
                "colleagues": parsed_again,
            }
            return parsed_again

        colleagues = await _load_sales_members()
        _sales_members_cache = {
            "expires_at": time.time() + SALES_MEMBERS_CACHE_TTL_SEC,
            "colleagues": colleagues,
        }
        await get_redis().cache_set(
            "feishu",
            "sales_colleagues",
            value=_colleagues_to_cache_payload(colleagues),
            ttl=SALES_MEMBERS_CACHE_TTL_SEC,
        )
        return colleagues
