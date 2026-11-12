"""定时任务：将飞书组织信息同步到 users 表，并维护 feishu_sales_contacts 销售部快照。"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import SessionLocal
from app.core.feishu.contact import (
    _is_active_user,
    _load_department_records,
    build_feishu_user_org_profile_from_records,
    discover_active_open_ids_for_org_sync,
    fetch_department_leaders_by_open_id_for_roots,
    fetch_feishu_user_detail,
    fetch_feishu_users_batch,
    get_configured_sales_department_tree_ids,
    resolve_feishu_user_org_profile,
)
from app.core.time_utils import utc_now
from app.models import FeishuSyncLog, User
from app.models.user import EMPLOYMENT_ACTIVE, EMPLOYMENT_RESIGNED
from app.modules.auth.permissions import ROLE_DATA_SCOPE, normalize_role
from app.modules.users.contacts_repository import ContactsRepository
from app.modules.users.repository import UsersRepository
from app.modules.users.role_resolver import resolve_staff_role_for_login

logger = logging.getLogger(__name__)

ORG_BULK_JOB_NAME = "org_bulk"
ORG_BULK_STALE_HOURS = 2


def _encode_job_meta(**fields: Any) -> str:
    return json.dumps(fields, ensure_ascii=False)


def _decode_job_meta(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {"errors": [line for line in raw.splitlines() if line.strip()]}


@dataclass
class FeishuOrgSyncUserResult:
    feishu_open_id: str
    user_id: str | None = None
    changed: bool = False
    updated_fields: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class FeishuOrgSyncSummary:
    synced_count: int = 0
    updated_count: int = 0
    unchanged_count: int = 0
    error_count: int = 0
    errors: list[str] = field(default_factory=list)
    users: list[FeishuOrgSyncUserResult] = field(default_factory=list)
    sales_contacts_active: int = 0
    sales_contacts_deactivated: int = 0
    discovered_count: int = 0
    feishu_active_snapshot_count: int = 0
    resigned_snapshot_count: int = 0
    local_only_count: int = 0
    permission_affecting_changes: int = 0
    leaders_assigned: int = 0
    leaders_cleared: int = 0
    leaders_changed: int = 0
    leaders_role_granted: int = 0
    leaders_role_revoked: int = 0
    leader_change_details: list[str] = field(default_factory=list)


_PERMISSION_AFFECTING_FIELDS = frozenset({"role", "employment_status", "department_ids", "department_names"})


def _count_permission_affecting_changes(summary: FeishuOrgSyncSummary) -> int:
    """角色 / 在职变更会计入；姓名头像部门展示变更不计。"""
    total = 0
    for item in summary.users:
        if item.error:
            continue
        if any(field in _PERMISSION_AFFECTING_FIELDS for field in item.updated_fields):
            total += 1
    return total


def _bulk_sync_concurrency() -> int:
    return max(1, get_settings().feishu_org_sync_concurrency)


def _discover_concurrency() -> int:
    return max(1, get_settings().feishu_org_discover_concurrency)


def _normalize_department_names(names: list[str] | None) -> list[str]:
    if not names:
        return []
    return sorted({n.strip() for n in names if isinstance(n, str) and n.strip()})


def _normalize_avatar(value: str | None) -> str | None:
    trimmed = (value or "").strip()
    return trimmed or None


def _user_in_sales_department_tree(
    department_ids: list[str] | None,
    sales_tree_ids: set[str],
) -> bool:
    if not department_ids or not sales_tree_ids:
        return False
    return any(dept_id in sales_tree_ids for dept_id in department_ids if dept_id)


def _diff_user_against_snapshot(user: User, snapshot: dict) -> list[str]:
    changed: list[str] = []
    if user.name != snapshot["name"]:
        changed.append("name")
    if _normalize_avatar(user.avatar_url) != _normalize_avatar(snapshot.get("avatar_url")):
        changed.append("avatar_url")
    if _normalize_department_names(
        user.department_names if isinstance(user.department_names, list) else []
    ) != _normalize_department_names(snapshot.get("department_names")):
        changed.append("department_names")
    user_dept_ids = sorted(
        d for d in (user.department_ids if isinstance(user.department_ids, list) else []) if isinstance(d, str) and d
    )
    snap_dept_ids = sorted(
        d for d in (snapshot.get("department_ids") or []) if isinstance(d, str) and d
    )
    if user_dept_ids != snap_dept_ids:
        changed.append("department_ids")
    expected_status = EMPLOYMENT_ACTIVE if snapshot.get("is_active", True) else EMPLOYMENT_RESIGNED
    if user.employment_status != expected_status:
        changed.append("employment_status")
    return changed


async def _mark_stale_org_bulk_jobs(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            UPDATE feishu_sync_logs
               SET status = 'failed',
                   error_message = '任务超时未完成，已自动标记失败',
                   finished_at = :now
             WHERE job_name = :job_name
               AND status = 'running'
               AND finished_at IS NULL
               AND started_at < DATE_SUB(:now, INTERVAL :hours HOUR)
            """
        ),
        {
            "now": utc_now(),
            "job_name": ORG_BULK_JOB_NAME,
            "hours": ORG_BULK_STALE_HOURS,
        },
    )


async def try_start_org_bulk_sync(db: AsyncSession) -> str | None:
    """跨 worker 互斥：写入 running 日志行，成功则返回 job_id。"""
    await _mark_stale_org_bulk_jobs(db)
    running = (
        await db.execute(
            text(
                """
                SELECT id
                  FROM feishu_sync_logs
                 WHERE job_name = :job_name
                   AND status = 'running'
                   AND finished_at IS NULL
                 LIMIT 1
                 FOR UPDATE
                """
            ),
            {"job_name": ORG_BULK_JOB_NAME},
        )
    ).first()
    if running:
        return None

    job_id = str(uuid.uuid4())
    now = utc_now()
    total_count = int((await db.execute(select(func.count()).select_from(User))).scalar_one() or 0)
    db.add(
        FeishuSyncLog(
            id=job_id,
            job_name=ORG_BULK_JOB_NAME,
            status="running",
            record_count=0,
            error_message=_encode_job_meta(total=total_count),
            started_at=now,
        )
    )
    await db.flush()
    return job_id


async def is_org_bulk_sync_running(db: AsyncSession) -> bool:
    await _mark_stale_org_bulk_jobs(db)
    running = (
        await db.execute(
            text(
                """
                SELECT id
                  FROM feishu_sync_logs
                 WHERE job_name = :job_name
                   AND status = 'running'
                   AND finished_at IS NULL
                 LIMIT 1
                """
            ),
            {"job_name": ORG_BULK_JOB_NAME},
        )
    ).first()
    return running is not None


async def _update_org_bulk_progress(job_id: str, processed_count: int) -> None:
    async with SessionLocal() as db:
        await db.execute(
            text(
                """
                UPDATE feishu_sync_logs
                   SET record_count = :processed_count
                 WHERE id = :job_id
                   AND status = 'running'
                   AND finished_at IS NULL
                """
            ),
            {"job_id": job_id, "processed_count": processed_count},
        )
        await db.commit()


async def _finish_org_bulk_sync(db: AsyncSession, job_id: str, summary: FeishuOrgSyncSummary) -> None:
    now = utc_now()
    error_message = _encode_job_meta(
        updated_count=summary.updated_count,
        unchanged_count=summary.unchanged_count,
        error_count=summary.error_count,
        errors=summary.errors[:20],
        sales_contacts_active=summary.sales_contacts_active,
        sales_contacts_deactivated=summary.sales_contacts_deactivated,
        discovered_count=summary.discovered_count,
        feishu_active_snapshot_count=summary.feishu_active_snapshot_count,
        resigned_snapshot_count=summary.resigned_snapshot_count,
        local_only_count=summary.local_only_count,
        processed_total=summary.synced_count,
        leaders_assigned=summary.leaders_assigned,
        leaders_cleared=summary.leaders_cleared,
        leaders_changed=summary.leaders_changed,
        leaders_role_granted=summary.leaders_role_granted,
        leaders_role_revoked=summary.leaders_role_revoked,
        leader_change_details=summary.leader_change_details[:20],
    )
    await db.execute(
        text(
            """
            UPDATE feishu_sync_logs
               SET status = :status,
                   record_count = :record_count,
                   error_message = :error_message,
                   finished_at = :finished_at
             WHERE id = :job_id
            """
        ),
        {
            "job_id": job_id,
            "status": "success" if summary.error_count == 0 else "partial",
            # record_count 以飞书在职快照为准，便于与通讯录人数对照；完整处理数见 meta.processed_total
            "record_count": summary.feishu_active_snapshot_count,
            "error_message": error_message,
            "finished_at": now,
        },
    )
    await db.commit()


async def recently_completed_org_bulk_sync(
    db: AsyncSession,
    *,
    within_seconds: float,
) -> bool:
    """最近是否已有成功/部分成功的全量同步（用于多 worker 启动防抖）。"""
    if within_seconds <= 0:
        return False
    row = (
        await db.execute(
            text(
                """
                SELECT id
                  FROM feishu_sync_logs
                 WHERE job_name = :job_name
                   AND status IN ('success', 'partial')
                   AND finished_at IS NOT NULL
                   AND finished_at > DATE_SUB(:now, INTERVAL :seconds SECOND)
                 LIMIT 1
                """
            ),
            {
                "job_name": ORG_BULK_JOB_NAME,
                "now": utc_now(),
                "seconds": int(within_seconds),
            },
        )
    ).first()
    return row is not None


async def _fail_org_bulk_sync(db: AsyncSession, job_id: str, exc: BaseException) -> None:
    message = str(exc).strip() or type(exc).__name__
    await db.execute(
        text(
            """
            UPDATE feishu_sync_logs
               SET status = 'failed',
                   error_message = :error_message,
                   finished_at = :finished_at
             WHERE id = :job_id
            """
        ),
        {
            "job_id": job_id,
            "error_message": _encode_job_meta(error=message),
            "finished_at": utc_now(),
        },
    )
    await db.commit()


async def _maybe_sync_sales_contact(
    db: AsyncSession,
    *,
    snapshot: dict,
    sales_tree_ids: set[str],
) -> None:
    if not sales_tree_ids:
        return
    if not snapshot.get("is_active", True):
        return
    open_id = snapshot["feishu_open_id"]
    if not _user_in_sales_department_tree(snapshot.get("department_ids"), sales_tree_ids):
        return

    await ContactsRepository(db).upsert_contact(
        feishu_open_id=open_id,
        name=snapshot["name"],
        department_ids=snapshot.get("department_ids"),
        department_names=snapshot.get("department_names"),
        job_title=snapshot.get("job_title"),
        synced_at=utc_now(),
    )


def _active_sales_open_ids_from_snapshots(
    snapshots: dict[str, dict],
    sales_tree_ids: set[str],
) -> set[str]:
    if not sales_tree_ids:
        return set()
    return {
        open_id
        for open_id, snap in snapshots.items()
        if snap.get("is_active", True)
        and _user_in_sales_department_tree(snap.get("department_ids"), sales_tree_ids)
    }


async def _finalize_sales_contacts(
    db: AsyncSession,
    *,
    open_ids: list[str],
    snapshots: dict[str, dict],
    sales_tree_ids: set[str],
) -> tuple[int, int]:
    """维护 feishu_sales_contacts 快照；返回 (active_count, deactivated_count)。"""
    if not sales_tree_ids:
        logger.warning("飞书组织同步：未配置 FEISHU_SALES_DEPARTMENT_IDS，跳过 sales_contacts 维护")
        return 0, 0

    ou_open_ids = [oid for oid in open_ids if str(oid).startswith("ou_")]
    if not ou_open_ids:
        return 0, 0

    coverage = len(snapshots) / len(ou_open_ids)
    if coverage < 0.8:
        logger.warning(
            "飞书组织同步：用户快照覆盖率 %.0f%% 过低，跳过 sales_contacts deactivate",
            coverage * 100,
        )
        return len(_active_sales_open_ids_from_snapshots(snapshots, sales_tree_ids)), 0

    active_sales_ids = _active_sales_open_ids_from_snapshots(snapshots, sales_tree_ids)
    deactivated = await ContactsRepository(db).deactivate_missing(active_sales_ids, utc_now())
    return len(active_sales_ids), deactivated


async def sync_user_org_from_feishu(
    db: AsyncSession,
    feishu_open_id: str,
    *,
    fallback_name: str | None = None,
    fallback_avatar: str | None = None,
    allow_inactive: bool = False,
    sales_tree_ids: set[str] | None = None,
    snapshot: dict | None = None,
    skip_role_resolution: bool = False,
) -> tuple[User | None, FeishuOrgSyncUserResult]:
    users_repo = UsersRepository(db)
    tree_ids = sales_tree_ids if sales_tree_ids is not None else await get_configured_sales_department_tree_ids()
    if snapshot is None:
        snapshot = await resolve_feishu_user_org_profile(
            feishu_open_id,
            fallback_name=fallback_name,
            fallback_avatar=fallback_avatar,
        )

    if not snapshot["is_active"] and not allow_inactive:
        raise RuntimeError("您的飞书账号已离职或停用，无法登录")

    existing = await users_repo.get_by_feishu_open_id(feishu_open_id)

    # 从未入库的离职/停用账号：不新建，保留历史仅覆盖已有 users 行
    if not snapshot["is_active"] and existing is None:
        return None, FeishuOrgSyncUserResult(
            feishu_open_id=feishu_open_id,
            changed=False,
        )

    changed_fields = _diff_user_against_snapshot(existing, snapshot) if existing else [
        "name",
        "avatar_url",
        "department_names",
        "department_ids",
        "employment_status",
    ]

    if (
        existing
        and not skip_role_resolution
        and not (existing.role_locked or existing.role_source == "manual")
        and snapshot["is_active"]
    ):
        try:
            expected_role, _ = await resolve_staff_role_for_login(
                db,
                feishu_open_id=feishu_open_id,
                department_names=snapshot["department_names"],
            )
            if existing.role != expected_role and "role" not in changed_fields:
                changed_fields.append("role")
        except RuntimeError:
            pass

    if existing and not changed_fields:
        await _maybe_sync_sales_contact(db, snapshot=snapshot, sales_tree_ids=tree_ids)
        return existing, FeishuOrgSyncUserResult(
            feishu_open_id=feishu_open_id,
            user_id=existing.id,
            changed=False,
        )

    try:
        user = await users_repo.resolve_and_upsert(
            feishu_open_id=feishu_open_id,
            name=snapshot["name"],
            avatar_url=snapshot.get("avatar_url"),
            department_names=snapshot["department_names"],
            department_ids=snapshot.get("department_ids") or [],
            skip_role_resolution=skip_role_resolution or not snapshot["is_active"],
        )
    except RuntimeError as exc:
        # 通讯录全量同步：部门未映射到系统角色时仍入库（默认 viewer），登录权限另判
        if "暂无系统访问权限" not in str(exc) or not allow_inactive:
            raise
        logger.info(
            "飞书组织同步：%s 部门未映射角色，按 viewer 入库 departments=%s",
            feishu_open_id,
            snapshot.get("department_names"),
        )
        user = await users_repo.resolve_and_upsert(
            feishu_open_id=feishu_open_id,
            name=snapshot["name"],
            avatar_url=snapshot.get("avatar_url"),
            department_names=snapshot["department_names"],
            department_ids=snapshot.get("department_ids") or [],
            skip_role_resolution=True,
        )
        if "role" not in changed_fields:
            changed_fields.append("role")

    target_status = EMPLOYMENT_ACTIVE if snapshot["is_active"] else EMPLOYMENT_RESIGNED
    if user.employment_status != target_status:
        user = await users_repo.set_employment_status(user.id, target_status)
        if "employment_status" not in changed_fields:
            changed_fields.append("employment_status")

    await _maybe_sync_sales_contact(db, snapshot=snapshot, sales_tree_ids=tree_ids)

    return user, FeishuOrgSyncUserResult(
        feishu_open_id=feishu_open_id,
        user_id=user.id,
        changed=True,
        updated_fields=changed_fields,
    )


async def _sync_one_user_for_bulk(
    open_id: str,
    snapshot: dict | None,
    sales_tree_ids: set[str],
    semaphore: asyncio.Semaphore,
) -> FeishuOrgSyncUserResult:
    async with semaphore, SessionLocal() as db:
        try:
            if snapshot is None:
                raise RuntimeError("飞书未返回用户信息")
            existing = await UsersRepository(db).get_by_feishu_open_id(open_id)
            # 手动锁定 / manual 来源不重算角色；其余在职用户按部门规则重算（修复缓存与权限漂移）
            if existing and (existing.role_locked or existing.role_source == "manual"):
                skip_role_resolution = True
            else:
                skip_role_resolution = False
            user, result = await sync_user_org_from_feishu(
                db,
                open_id,
                allow_inactive=True,
                sales_tree_ids=sales_tree_ids,
                snapshot=snapshot,
                skip_role_resolution=skip_role_resolution,
            )
            await db.commit()
            if user is not None and not result.user_id:
                result.user_id = user.id
            return result
        except Exception as exc:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            await db.rollback()
            message = str(exc).strip() or type(exc).__name__
            logger.warning("飞书组织同步失败 %s: %s", open_id, message)
            return FeishuOrgSyncUserResult(
                feishu_open_id=open_id,
                error=message,
            )


def _resigned_snapshot_from_user(user: User) -> dict:
    """飞书已不可用时，用库内资料构造离职快照。"""
    department_names = (
        user.department_names if isinstance(user.department_names, list) else []
    )
    return {
        "feishu_open_id": user.feishu_open_id,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "department_ids": [],
        "department_names": department_names,
        "department_breadcrumbs": [],
        "primary_department_open_id": None,
        "primary_department_breadcrumb": None,
        "job_title": None,
        "is_active": False,
    }


async def _prepare_bulk_org_snapshots(
    open_ids: list[str],
) -> dict[str, dict]:
    """先批量拉飞书用户 + 共享部门缓存，再本地组装快照。"""
    logger.info("飞书组织同步：批量拉取 %d 人", len(open_ids))
    feishu_users = await fetch_feishu_users_batch(open_ids)

    all_dept_ids: set[str] = set()
    for user in feishu_users.values():
        for dept_id in user.get("department_ids") or []:
            if isinstance(dept_id, str) and dept_id:
                all_dept_ids.add(dept_id)

    logger.info("飞书组织同步：预加载 %d 个部门", len(all_dept_ids))
    dept_cache = await _load_department_records(list(all_dept_ids))

    snapshots: dict[str, dict] = {}
    for open_id in open_ids:
        if not str(open_id).startswith("ou_"):
            continue
        user = feishu_users.get(open_id)
        if not user:
            continue
        try:
            snapshots[open_id] = build_feishu_user_org_profile_from_records(
                user,
                dept_cache,
                open_id=open_id,
            )
        except Exception as exc:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            logger.warning("飞书组织快照组装失败 %s: %s", open_id, exc)

    return snapshots


async def _attach_resigned_snapshots_for_missing(
    db: AsyncSession,
    open_ids: list[str],
    snapshots: dict[str, dict],
) -> int:
    """飞书 batch 未返回的已入库账号：按离职快照继续同步（不报错丢弃）。"""
    attached = 0
    users_repo = UsersRepository(db)
    for open_id in open_ids:
        if not str(open_id).startswith("ou_") or open_id in snapshots:
            continue
        existing = await users_repo.get_by_feishu_open_id(open_id)
        if existing is None:
            continue
        snapshots[open_id] = _resigned_snapshot_from_user(existing)
        attached += 1
        logger.info("飞书组织同步：%s 飞书未返回，按离职处理", open_id)
    return attached


@dataclass
class DepartmentLeaderCurrentState:
    feishu_open_id: str
    name: str
    manual_department_open_id: str | None
    manual_department_name: str | None
    manual_department_leader: bool
    feishu_led_department_ids: list[str]


@dataclass
class DepartmentLeaderSyncAction:
    feishu_open_id: str
    name: str
    kind: str  # assign | change | clear
    detail: str
    feishu_led_department_ids: list[str] | None
    manual_department_open_id: str | None
    manual_department_name: str | None
    manual_department_leader: bool


def _normalize_led_department_ids(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            trimmed = raw.strip()
            return [trimmed] if trimmed else []
    if not isinstance(raw, list):
        return []
    return sorted({str(item).strip() for item in raw if isinstance(item, str) and item.strip()})


def _format_led_departments(pairs: list[tuple[str, str]]) -> str:
    if not pairs:
        return "无"
    return ", ".join(f"{name or dept_id}({dept_id})" for dept_id, name in pairs)


def compute_department_leader_sync_actions(
    desired: dict[str, list[tuple[str, str]]],
    current_rows: list[DepartmentLeaderCurrentState],
) -> list[DepartmentLeaderSyncAction]:
    """对比飞书期望负责人与库内标注，生成覆盖写入动作（飞书为准）。"""
    current_by_oid = {row.feishu_open_id: row for row in current_rows if row.feishu_open_id}
    actions: list[DepartmentLeaderSyncAction] = []

    for open_id, pairs in desired.items():
        led_ids = [dept_id for dept_id, _ in pairs]
        primary_id = led_ids[0] if led_ids else None
        primary_name = pairs[0][1] if pairs else None
        row = current_by_oid.get(open_id)
        if row is None:
            continue

        current_ids = _normalize_led_department_ids(row.feishu_led_department_ids)
        current_primary = (row.manual_department_open_id or "").strip() or None
        current_name = (row.manual_department_name or "").strip() or None
        unchanged = (
            row.manual_department_leader
            and current_ids == led_ids
            and current_primary == primary_id
            and (current_name or None) == (primary_name or None)
        )
        if unchanged:
            continue

        had_leader = row.manual_department_leader or bool(current_ids)
        kind = "change" if had_leader else "assign"
        if had_leader:
            if current_ids:
                before = _format_led_departments([(dept_id, "") for dept_id in current_ids])
            elif current_primary:
                before = _format_led_departments([(current_primary, current_name or "")])
            else:
                before = "无"
            detail = f"{row.name}: {before} -> {_format_led_departments(pairs)}"
        else:
            detail = f"{row.name}: 新任 {_format_led_departments(pairs)}"
        actions.append(
            DepartmentLeaderSyncAction(
                feishu_open_id=open_id,
                name=row.name,
                kind=kind,
                detail=detail,
                feishu_led_department_ids=led_ids,
                manual_department_open_id=primary_id,
                manual_department_name=primary_name,
                manual_department_leader=True,
            )
        )

    for row in current_rows:
        if row.feishu_open_id in desired:
            continue
        current_ids = _normalize_led_department_ids(row.feishu_led_department_ids)
        if not row.manual_department_leader and not current_ids:
            continue
        actions.append(
            DepartmentLeaderSyncAction(
                feishu_open_id=row.feishu_open_id,
                name=row.name,
                kind="clear",
                detail=(
                    f"{row.name}: 撤权 "
                    f"{_format_led_departments([(d, row.manual_department_name or '') for d in current_ids] if current_ids else [(row.manual_department_open_id or '', row.manual_department_name or '')])}"
                ),
                feishu_led_department_ids=None,
                manual_department_open_id=None,
                manual_department_name=None,
                manual_department_leader=False,
            )
        )

    return actions


async def _load_department_leader_current_states(
    db: AsyncSession,
) -> list[DepartmentLeaderCurrentState]:
    rows = (
        await db.execute(
            text(
                """
                SELECT feishu_open_id, name,
                       manual_department_open_id, manual_department_name,
                       manual_department_leader, feishu_led_department_ids
                  FROM users
                 WHERE feishu_open_id IS NOT NULL
                   AND feishu_open_id != ''
                """
            )
        )
    ).all()
    result: list[DepartmentLeaderCurrentState] = []
    for open_id, name, manual_oid, manual_name, is_leader, led_ids in rows:
        result.append(
            DepartmentLeaderCurrentState(
                feishu_open_id=str(open_id),
                name=str(name or open_id),
                manual_department_open_id=(str(manual_oid).strip() if manual_oid else None),
                manual_department_name=(str(manual_name).strip() if manual_name else None),
                manual_department_leader=bool(is_leader),
                feishu_led_department_ids=_normalize_led_department_ids(led_ids),
            )
        )
    return result


async def _apply_department_leader_sync_actions(
    db: AsyncSession,
    actions: list[DepartmentLeaderSyncAction],
) -> None:
    now = utc_now()
    for action in actions:
        led_json = (
            json.dumps(action.feishu_led_department_ids, ensure_ascii=False)
            if action.feishu_led_department_ids is not None
            else None
        )
        await db.execute(
            text(
                """
                UPDATE users
                   SET feishu_led_department_ids = :led_ids,
                       manual_department_open_id = :manual_oid,
                       manual_department_name = :manual_name,
                       manual_department_leader = :is_leader,
                       updated_at = :updated_at
                 WHERE feishu_open_id = :open_id
                """
            ),
            {
                "led_ids": led_json,
                "manual_oid": action.manual_department_open_id,
                "manual_name": action.manual_department_name,
                "is_leader": 1 if action.manual_department_leader else 0,
                "updated_at": now,
                "open_id": action.feishu_open_id,
            },
        )
        # 飞书成员部门为根「0」等导致 department_names 为空时，用负责部门路径回填
        if action.manual_department_leader and action.feishu_led_department_ids:
            from app.core.feishu.department_labels import resolve_department_display_path

            paths = []
            for dept_id in action.feishu_led_department_ids:
                path = resolve_department_display_path(dept_id)
                if path and path not in paths:
                    paths.append(path)
            if paths:
                await db.execute(
                    text(
                        """
                        UPDATE users
                           SET department_names = :names,
                               updated_at = :updated_at
                         WHERE feishu_open_id = :open_id
                           AND (
                                 department_names IS NULL
                              OR JSON_LENGTH(department_names) = 0
                           )
                        """
                    ),
                    {
                        "names": json.dumps(paths, ensure_ascii=False),
                        "updated_at": now,
                        "open_id": action.feishu_open_id,
                    },
                )


# 已具备 department/all 可见性的角色：负责人同步不再降级/覆盖
_LEADER_SCOPE_ALREADY_OK = frozenset(
    code
    for code, scope in ROLE_DATA_SCOPE.items()
    if scope in ("department", "all")
)
_LEADER_ROLE_CODE = "leader"


def _parse_department_names_json(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return [raw.strip()] if raw.strip() else []
    if not isinstance(raw, list):
        return []
    return [str(item).strip() for item in raw if isinstance(item, str) and item.strip()]


async def _grant_department_leader_visibility(
    db: AsyncSession,
    *,
    user_id: str,
    feishu_open_id: str,
    name: str,
    role: str,
    role_locked: bool,
    role_source: str,
    data_scope_override: str | None,
) -> str | None:
    """确保飞书部门负责人具备 department 数据范围。返回变更说明或 None。"""
    current_role = normalize_role(role or "viewer")
    if current_role in _LEADER_SCOPE_ALREADY_OK and current_role != _LEADER_ROLE_CODE:
        if (data_scope_override or "").strip() == "own":
            # 更高角色被强制 own 时，清掉覆盖以恢复角色默认范围
            await db.execute(
                text(
                    """
                    UPDATE users
                       SET data_scope_override = NULL, updated_at = :ts
                     WHERE id = :uid
                    """
                ),
                {"uid": user_id, "ts": utc_now()},
            )
            return f"{name}: 清除 data_scope_override=own（保留 {current_role}）"
        return None

    # 手动锁定身份：不改角色，只打开部门范围覆盖
    if role_locked or role_source == "manual":
        if (data_scope_override or "").strip() == "department":
            return None
        await db.execute(
            text(
                """
                UPDATE users
                   SET data_scope_override = 'department', updated_at = :ts
                 WHERE id = :uid
                """
            ),
            {"uid": user_id, "ts": utc_now()},
        )
        return f"{name}: 角色已锁定({current_role})，设置 data_scope_override=department"

    # 已是 leader：仍对齐 RBAC 绑定，防止 users.role 与 user_role_assignments 漂移
    if current_role == _LEADER_ROLE_CODE:
        await UsersRepository(db).sync_feishu_primary_role(user_id, _LEADER_ROLE_CODE)
        if (data_scope_override or "").strip() == "own":
            await db.execute(
                text(
                    """
                    UPDATE users
                       SET data_scope_override = NULL, updated_at = :ts
                     WHERE id = :uid
                    """
                ),
                {"uid": user_id, "ts": utc_now()},
            )
            return f"{name}: leader 对齐并清除 data_scope_override=own"
        return None

    await db.execute(
        text(
            """
            UPDATE users
               SET role = :role,
                   role_source = 'feishu',
                   data_scope_override = NULL,
                   updated_at = :ts
             WHERE id = :uid
            """
        ),
        {"uid": user_id, "role": _LEADER_ROLE_CODE, "ts": utc_now()},
    )
    await UsersRepository(db).sync_feishu_primary_role(user_id, _LEADER_ROLE_CODE)
    return f"{name}: {current_role} -> leader（可见负责部门下属）"


async def _revoke_department_leader_visibility(
    db: AsyncSession,
    *,
    user_id: str,
    feishu_open_id: str,
    name: str,
    role: str,
    role_locked: bool,
    role_source: str,
    data_scope_override: str | None,
    department_names: list[str],
) -> str | None:
    """撤权：收回因负责人身份获得的 department 可见性。"""
    current_role = normalize_role(role or "viewer")
    details: list[str] = []

    if (data_scope_override or "").strip() == "department":
        await db.execute(
            text(
                """
                UPDATE users
                   SET data_scope_override = NULL, updated_at = :ts
                 WHERE id = :uid
                """
            ),
            {"uid": user_id, "ts": utc_now()},
        )
        details.append("清除 data_scope_override=department")

    # 仅收回同步写入的 leader；不降 admin/ops 等
    if (
        current_role == _LEADER_ROLE_CODE
        and not role_locked
        and role_source != "manual"
    ):
        try:
            restored, _ = await resolve_staff_role_for_login(
                db,
                feishu_open_id=feishu_open_id,
                department_names=department_names,
            )
        except RuntimeError:
            restored = "sales"
        restored = normalize_role(restored)
        if restored == _LEADER_ROLE_CODE:
            restored = "sales"
        await db.execute(
            text(
                """
                UPDATE users
                   SET role = :role,
                       role_source = 'feishu',
                       updated_at = :ts
                 WHERE id = :uid
                """
            ),
            {"uid": user_id, "role": restored, "ts": utc_now()},
        )
        await UsersRepository(db).sync_feishu_primary_role(user_id, restored)
        details.append(f"leader -> {restored}")

    if not details:
        return None
    return f"{name}: 撤权 " + "；".join(details)


async def _reconcile_department_leader_privileges(
    db: AsyncSession,
    summary: FeishuOrgSyncSummary,
    *,
    desired_open_ids: set[str],
    cleared_open_ids: set[str],
) -> None:
    """按飞书负责人名单赋/收「看下属」权限。"""
    open_ids = sorted(desired_open_ids | cleared_open_ids)
    if not open_ids:
        return

    rows = (
        await db.execute(
            text(
                """
                SELECT id, name, feishu_open_id, role, role_locked, role_source,
                       data_scope_override, department_names
                  FROM users
                 WHERE feishu_open_id IN :oids
                """
            ),
            {"oids": tuple(open_ids)},
        )
    ).mappings().all()

    for row in rows:
        oid = str(row["feishu_open_id"])
        if oid in desired_open_ids:
            detail = await _grant_department_leader_visibility(
                db,
                user_id=str(row["id"]),
                feishu_open_id=oid,
                name=str(row["name"] or oid),
                role=str(row["role"] or "viewer"),
                role_locked=bool(row["role_locked"]),
                role_source=str(row["role_source"] or "feishu"),
                data_scope_override=row["data_scope_override"],
            )
            if detail:
                summary.leaders_role_granted += 1
                summary.permission_affecting_changes += 1
                summary.leader_change_details.append(detail)

            # 成员部门为空时，用飞书负责部门路径回填展示名
            names = _parse_department_names_json(row["department_names"])
            if not names:
                led_row = (
                    await db.execute(
                        text(
                            """
                            SELECT feishu_led_department_ids
                              FROM users WHERE id = :uid LIMIT 1
                            """
                        ),
                        {"uid": row["id"]},
                    )
                ).first()
                led_ids = _normalize_led_department_ids(led_row[0] if led_row else None)
                if led_ids:
                    from app.core.feishu.department_labels import resolve_department_display_path

                    paths = []
                    for dept_id in led_ids:
                        path = resolve_department_display_path(dept_id)
                        if path and path not in paths:
                            paths.append(path)
                    if paths:
                        await db.execute(
                            text(
                                """
                                UPDATE users
                                   SET department_names = :names, updated_at = :ts
                                 WHERE id = :uid
                                """
                            ),
                            {
                                "names": json.dumps(paths, ensure_ascii=False),
                                "ts": utc_now(),
                                "uid": row["id"],
                            },
                        )
        elif oid in cleared_open_ids:
            detail = await _revoke_department_leader_visibility(
                db,
                user_id=str(row["id"]),
                feishu_open_id=oid,
                name=str(row["name"] or oid),
                role=str(row["role"] or "viewer"),
                role_locked=bool(row["role_locked"]),
                role_source=str(row["role_source"] or "feishu"),
                data_scope_override=row["data_scope_override"],
                department_names=_parse_department_names_json(row["department_names"]),
            )
            if detail:
                summary.leaders_role_revoked += 1
                summary.permission_affecting_changes += 1
                summary.leader_change_details.append(detail)


async def _sync_department_leaders_from_feishu(
    db: AsyncSession,
    summary: FeishuOrgSyncSummary,
) -> None:
    """以飞书部门负责人为准覆盖标注，并赋予/收回看下属权限。"""
    try:
        desired = await fetch_department_leaders_by_open_id_for_roots()
    except Exception:
        logger.exception("飞书部门负责人拉取失败，跳过负责人同步")
        summary.errors.append("department_leaders: 飞书拉取失败")
        summary.error_count += 1
        return

    current_rows = await _load_department_leader_current_states(db)
    known_oids = {row.feishu_open_id for row in current_rows}
    missing = sorted(oid for oid in desired if oid not in known_oids)
    for oid in missing[:10]:
        depts = _format_led_departments(desired[oid])
        detail = f"{oid}: 飞书负责 {depts}，但本地 users 无此账号"
        summary.leader_change_details.append(detail)
        logger.warning("飞书部门负责人同步跳过（本地无用户）%s", detail)

    actions = compute_department_leader_sync_actions(desired, current_rows)
    if actions:
        await _apply_department_leader_sync_actions(db, actions)
        for action in actions:
            summary.leader_change_details.append(action.detail)
            if action.kind == "assign":
                summary.leaders_assigned += 1
            elif action.kind == "clear":
                summary.leaders_cleared += 1
            else:
                summary.leaders_changed += 1
            summary.permission_affecting_changes += 1

    desired_open_ids = set(desired.keys()) & known_oids
    cleared_open_ids = {a.feishu_open_id for a in actions if a.kind == "clear"}
    # 字段未变时也要对齐权限（例如此前只同步了负责人标注）
    await _reconcile_department_leader_privileges(
        db,
        summary,
        desired_open_ids=desired_open_ids,
        cleared_open_ids=cleared_open_ids,
    )

    if not actions and not missing and summary.leaders_role_granted == 0 and summary.leaders_role_revoked == 0:
        logger.info("飞书部门负责人同步：无变更（飞书负责人 %d 人）", len(desired))
    else:
        logger.info(
            "飞书部门负责人同步完成：飞书负责人=%d assigned=%d changed=%d cleared=%d "
            "role_granted=%d role_revoked=%d missing_local=%d",
            len(desired),
            summary.leaders_assigned,
            summary.leaders_changed,
            summary.leaders_cleared,
            summary.leaders_role_granted,
            summary.leaders_role_revoked,
            len(missing),
        )

    if len(summary.leader_change_details) > 50:
        summary.leader_change_details = summary.leader_change_details[:50]


async def _collect_open_ids_from_org_roots() -> set[str]:
    """收集飞书在职成员：配置根部门 ∪ 应用 scopes ∪ 根部门 0。"""
    root_ids = get_settings().org_root_department_id_list
    return await discover_active_open_ids_for_org_sync(
        root_ids,
        concurrency=_discover_concurrency(),
    )


async def sync_all_users_org_from_feishu(db: AsyncSession, *, job_id: str | None = None) -> FeishuOrgSyncSummary:
    rows = (await db.execute(select(User.feishu_open_id).order_by(User.name))).all()
    open_ids = [str(open_id) for (open_id,) in rows if open_id]

    discovered = await _collect_open_ids_from_org_roots()
    known = set(open_ids)
    new_open_ids = sorted(oid for oid in discovered if oid.startswith("ou_") and oid not in known)
    if new_open_ids:
        logger.info("飞书组织同步：从根部门子树发现 %d 个新成员", len(new_open_ids))
        open_ids.extend(new_open_ids)

    summary = FeishuOrgSyncSummary(
        synced_count=len(open_ids),
        discovered_count=len(discovered),
        local_only_count=sum(1 for oid in open_ids if not str(oid).startswith("ou_")),
    )

    if not open_ids:
        return summary

    snapshots = await _prepare_bulk_org_snapshots(open_ids)
    resigned_missing = await _attach_resigned_snapshots_for_missing(db, open_ids, snapshots)
    if resigned_missing:
        logger.info("飞书组织同步：%d 人飞书未返回，将标记为离职", resigned_missing)

    summary.feishu_active_snapshot_count = sum(
        1 for snap in snapshots.values() if snap.get("is_active", True)
    )
    summary.resigned_snapshot_count = sum(
        1 for snap in snapshots.values() if not snap.get("is_active", True)
    )

    sales_tree_ids = await get_configured_sales_department_tree_ids()
    semaphore = asyncio.Semaphore(_bulk_sync_concurrency())

    processed = 0
    for open_id in open_ids:
        if open_id in snapshots:
            continue
        processed += 1
        if not str(open_id).startswith("ou_"):
            summary.users.append(
                FeishuOrgSyncUserResult(feishu_open_id=open_id, changed=False),
            )
            summary.unchanged_count += 1
            continue
        message = "飞书未返回用户信息且本地无该用户"
        summary.error_count += 1
        summary.errors.append(f"{open_id}: {message}")
        summary.users.append(
            FeishuOrgSyncUserResult(feishu_open_id=open_id, error=message),
        )

    tasks = [
        asyncio.create_task(
            _sync_one_user_for_bulk(open_id, snapshots[open_id], sales_tree_ids, semaphore)
        )
        for open_id in open_ids
        if open_id in snapshots
    ]

    if job_id and processed > 0:
        await _update_org_bulk_progress(job_id, processed)

    for task in asyncio.as_completed(tasks):
        result = await task
        processed += 1
        summary.users.append(result)
        if result.error:
            summary.error_count += 1
            summary.errors.append(f"{result.feishu_open_id}: {result.error}")
        elif result.changed:
            summary.updated_count += 1
        else:
            summary.unchanged_count += 1
        if job_id and (processed == len(open_ids) or processed % 5 == 0):
            await _update_org_bulk_progress(job_id, processed)

    active_sales_ids, deactivated = await _finalize_sales_contacts(
        db,
        open_ids=open_ids,
        snapshots=snapshots,
        sales_tree_ids=sales_tree_ids,
    )
    summary.sales_contacts_active = active_sales_ids
    summary.sales_contacts_deactivated = deactivated
    summary.permission_affecting_changes = _count_permission_affecting_changes(summary)
    # 先提交 users / 销售通讯录，避免长事务 REPEATABLE READ 读到赋权前的旧 role
    await db.commit()

    async with SessionLocal() as leader_db:
        await _sync_department_leaders_from_feishu(leader_db, summary)
        await leader_db.commit()

    return summary


async def run_org_bulk_sync_job(job_id: str) -> None:
    try:
        async with SessionLocal() as db:
            summary = await sync_all_users_org_from_feishu(db, job_id=job_id)
        async with SessionLocal() as db:
            await _finish_org_bulk_sync(db, job_id, summary)
        # MySQL 成功后再失效 Redis（失败路径不调）
        from app.core.cache_invalidation import invalidate_after_org_sync

        await invalidate_after_org_sync(
            permission_affecting_changes=summary.permission_affecting_changes,
        )
        logger.info(
            "飞书组织后台同步完成 job=%s processed=%d feishu_active=%d resigned_snap=%d "
            "discovered=%d updated=%d unchanged=%d errors=%d sales_contacts=%d deactivated=%d "
            "permission_affecting=%d leaders_assigned=%d leaders_changed=%d leaders_cleared=%d "
            "leaders_role_granted=%d leaders_role_revoked=%d",
            job_id,
            summary.synced_count,
            summary.feishu_active_snapshot_count,
            summary.resigned_snapshot_count,
            summary.discovered_count,
            summary.updated_count,
            summary.unchanged_count,
            summary.error_count,
            summary.sales_contacts_active,
            summary.sales_contacts_deactivated,
            summary.permission_affecting_changes,
            summary.leaders_assigned,
            summary.leaders_changed,
            summary.leaders_cleared,
            summary.leaders_role_granted,
            summary.leaders_role_revoked,
        )
    except Exception as exc:
        logger.exception("飞书组织后台同步失败 job=%s", job_id)
        try:
            async with SessionLocal() as db:
                await _fail_org_bulk_sync(db, job_id, exc)
        except Exception:
            logger.exception("写入飞书组织同步失败日志时出错 job=%s", job_id)


async def verify_feishu_user_reachable(feishu_open_id: str) -> bool:
    try:
        user = await fetch_feishu_user_detail(feishu_open_id)
        return _is_active_user(user)
    except RuntimeError:
        return False
