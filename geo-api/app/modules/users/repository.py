from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationError
from app.core.time_utils import utc_now
from app.models import User
from app.models.user import EMPLOYMENT_ACTIVE, EMPLOYMENT_RESIGNED
from app.modules.auth.permissions import StaffRole
from app.modules.users.role_resolver import is_super_admin_open_id, resolve_staff_role_for_login

UNASSIGNED_OWNER = "未分配"


# leader_open_id → (expires_at_epoch, report_user_ids)
_DIRECT_REPORT_CACHE: dict[str, tuple[float, list[str]]] = {}
_DIRECT_REPORT_CACHE_TTL_SEC = 300.0


class UsersRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_feishu_open_id(self, feishu_open_id: str) -> User | None:
        result = await self.db.execute(select(User).where(User.feishu_open_id == feishu_open_id))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: str) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str, *, active_only: bool = False) -> User | None:
        trimmed = name.strip()
        if not trimmed:
            return None
        stmt = select(User).where(User.name == trimmed)
        if active_only:
            stmt = stmt.where(User.employment_status == EMPLOYMENT_ACTIVE)
        result = await self.db.execute(stmt)
        rows = list(result.scalars().all())
        if len(rows) == 1:
            return rows[0]
        if len(rows) > 1:
            raise ValidationError(f"存在多个同名用户「{trimmed}」，无法唯一确定跟进人")
        return None

    async def get_active_feishu_user_by_name(self, name: str) -> User | None:
        """按姓名解析正式飞书组织成员，排除 dev/导入占位账号。"""
        trimmed = name.strip()
        if not trimmed:
            return None
        result = await self.db.execute(
            select(User).where(
                User.name == trimmed,
                User.employment_status == EMPLOYMENT_ACTIVE,
                User.feishu_open_id.like("ou\\_%", escape="\\"),
            )
        )
        rows = list(result.scalars().all())
        if len(rows) == 1:
            return rows[0]
        if len(rows) > 1:
            raise ValidationError(f"存在多个同名飞书成员「{trimmed}」，无法唯一确定通知对象")
        return None

    async def list_active_directory(self) -> list[User]:
        result = await self.db.execute(
            select(User)
            .where(User.employment_status == EMPLOYMENT_ACTIVE)
            .order_by(User.name)
        )
        return list(result.scalars().all())

    async def set_employment_status(
        self,
        user_id: str,
        status: str,
    ) -> User:
        """标记在职/离职。离职不删除用户，也不清空需求单 staff_user_id，便于历史回溯。"""
        now = utc_now()
        values: dict = {
            "employment_status": status,
            "updated_at": now,
        }
        if status == EMPLOYMENT_RESIGNED:
            existing = await self.get_by_id(user_id)
            if existing and not existing.left_at:
                values["left_at"] = now
        elif status == EMPLOYMENT_ACTIVE:
            values["left_at"] = None

        await self.db.execute(update(User).where(User.id == user_id).values(**values))
        await self.db.flush()
        row = await self.get_by_id(user_id)
        assert row is not None
        return row

    async def resolve_user_id_by_owner_name(self, owner_name: str) -> str | None:
        trimmed = owner_name.strip()
        if not trimmed or trimmed in (UNASSIGNED_OWNER, "—", "-"):
            return None

        user = await self.get_by_name(trimmed, active_only=True)
        if user:
            return user.id

        row = (
            await self.db.execute(
                text(
                    """
                    SELECT u.id
                    FROM feishu_sales_contacts f
                    JOIN users u ON u.feishu_open_id = f.feishu_open_id
                    WHERE f.name = :name
                      AND f.is_active = 1
                      AND u.employment_status = :active
                    LIMIT 2
                    """
                ),
                {"name": trimmed, "active": EMPLOYMENT_ACTIVE},
            )
        ).all()
        if len(row) == 1:
            return str(row[0][0])
        if len(row) > 1:
            raise ValidationError(f"存在多个同名销售「{trimmed}」，无法唯一确定跟进人")

        # 明确禁止把新跟进人改派给已离职账号（历史单仍保留原 staff_user_id）
        resigned = await self.get_by_name(trimmed, active_only=False)
        if resigned and resigned.is_resigned:
            raise ValidationError(f"「{trimmed}」已离职，请改派给在职同事")

        raise ValidationError(f"未找到跟进人「{trimmed}」，请从销售同事列表中选择")


    async def upsert_feishu_user(
        self,
        *,
        feishu_open_id: str,
        name: str,
        avatar_url: str | None,
        department_names: list[str],
        role: StaffRole,
        department_ids: list[str] | None = None,
    ) -> User:
        now = utc_now()
        # None = 不改 department_ids；显式 list（含空）才写入
        update_dept_ids = department_ids is not None
        dept_ids = (
            [d for d in department_ids if isinstance(d, str) and d.strip()]
            if update_dept_ids
            else None
        )
        existing = await self.get_by_feishu_open_id(feishu_open_id)
        if existing:
            values: dict[str, Any] = {
                "name": name,
                "avatar_url": avatar_url,
                "role": role,
                "role_source": "feishu",
                "department_names": department_names,
                "updated_at": now,
            }
            if update_dept_ids:
                values["department_ids"] = dept_ids or None
            await self.db.execute(
                update(User).where(User.feishu_open_id == feishu_open_id).values(**values)
            )
            await self.db.flush()
            row = await self.get_by_feishu_open_id(feishu_open_id)
            assert row is not None
            return row

        row = User(
            id=str(uuid.uuid4()),
            feishu_open_id=feishu_open_id,
            name=name,
            avatar_url=avatar_url,
            role=role,
            role_source="feishu",
            department_names=department_names,
            department_ids=(dept_ids or None) if update_dept_ids else None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def sync_feishu_primary_role(self, user_id: str, role_code: str) -> None:
        """飞书同步：替换为部门默认的唯一身份（不叠加多角色）。"""
        role_row = (
            await self.db.execute(
                text("SELECT id FROM rbac_roles WHERE code = :code LIMIT 1"),
                {"code": role_code},
            )
        ).first()
        if not role_row:
            return
        role_id = role_row[0]
        now = utc_now()
        await self.db.execute(
            text("DELETE FROM user_role_assignments WHERE user_id = :uid"),
            {"uid": user_id},
        )
        await self.db.execute(
            text(
                """
                INSERT INTO user_role_assignments
                  (user_id, role_id, is_primary, assigned_at, created_at, updated_at)
                VALUES (:uid, :rid, 1, :ts, :ts, :ts)
                """
            ),
            {"uid": user_id, "rid": role_id, "ts": now},
        )

    async def resolve_and_upsert(
        self,
        *,
        feishu_open_id: str,
        name: str,
        avatar_url: str | None,
        department_names: list[str],
        department_ids: list[str] | None = None,
        skip_role_resolution: bool = False,
    ) -> User:
        existing = await self.get_by_feishu_open_id(feishu_open_id)
        force_super_admin = is_super_admin_open_id(feishu_open_id)
        if (
            existing
            and not force_super_admin
            and (
                skip_role_resolution
                or existing.role_locked
                or existing.role_source == "manual"
            )
        ):
            now = utc_now()
            values: dict[str, Any] = {
                "name": name,
                "avatar_url": avatar_url,
                "department_names": department_names,
                "updated_at": now,
            }
            if department_ids is not None:
                values["department_ids"] = [
                    d for d in department_ids if isinstance(d, str) and d.strip()
                ] or None
            await self.db.execute(
                update(User).where(User.feishu_open_id == feishu_open_id).values(**values)
            )
            await self.db.flush()
            row = await self.get_by_feishu_open_id(feishu_open_id)
            assert row is not None
            return row

        if force_super_admin:
            user = await self.upsert_feishu_user(
                feishu_open_id=feishu_open_id,
                name=name,
                avatar_url=avatar_url,
                department_names=department_names,
                department_ids=department_ids,
                role="super_admin",
            )
            # 清 lock / 细调，避免升超管后残留业务态
            now = utc_now()
            await self.db.execute(
                update(User)
                .where(User.feishu_open_id == feishu_open_id)
                .values(
                    role_locked=False,
                    data_scope_override=None,
                    role_source="feishu",
                    updated_at=now,
                )
            )
            await self.db.execute(
                text("DELETE FROM user_permission_overrides WHERE user_id = :uid"),
                {"uid": user.id},
            )
            await self.db.flush()
            await self.sync_feishu_primary_role(user.id, "super_admin")
            refreshed = await self.get_by_feishu_open_id(feishu_open_id)
            assert refreshed is not None
            return refreshed

        if skip_role_resolution:
            role: StaffRole = existing.role if existing else "viewer"  # type: ignore[assignment]
            user = await self.upsert_feishu_user(
                feishu_open_id=feishu_open_id,
                name=name,
                avatar_url=avatar_url,
                department_names=department_names,
                department_ids=department_ids,
                role=role,
            )
            if existing:
                return user
            await self.sync_feishu_primary_role(user.id, role)
            return user

        role, resolved_department_names = await resolve_staff_role_for_login(
            self.db,
            feishu_open_id=feishu_open_id,
            department_names=department_names,
        )
        user = await self.upsert_feishu_user(
            feishu_open_id=feishu_open_id,
            name=name,
            avatar_url=avatar_url,
            department_names=resolved_department_names,
            department_ids=department_ids,
            role=role,
        )
        await self.sync_feishu_primary_role(user.id, role)
        return user

    @staticmethod
    def _coerce_json_list(value: Any) -> list[Any]:
        """MySQL JSON 经 text() 查询时可能是 list 或 JSON 字符串。"""
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw[0] in "[ {":
                try:
                    import json

                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        return parsed
                except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
                    pass
            return [raw]
        return []

    @staticmethod
    def _parse_user_departments(
        department_names: list[str] | str | None,
        manual_department_name: str | None = None,
    ) -> list[str]:
        names: list[str] = []
        if manual_department_name and manual_department_name.strip():
            names.append(manual_department_name.strip())
        for item in UsersRepository._coerce_json_list(department_names):
            if isinstance(item, str) and item.strip():
                names.append(item.strip())
        return names

    @staticmethod
    def _parse_department_ids(*sources: Any) -> list[str]:
        ids: list[str] = []
        seen: set[str] = set()
        for source in sources:
            for item in UsersRepository._coerce_json_list(source):
                if isinstance(item, str) and item.strip() and item.strip() not in seen:
                    seen.add(item.strip())
                    ids.append(item.strip())
        return ids

    @staticmethod
    def _departments_overlap(dept_a: list[str], dept_b: list[str]) -> bool:
        set_a = {d.strip() for d in dept_a if d and d.strip()}
        set_b = {d.strip() for d in dept_b if d and d.strip()}
        if not set_a or not set_b:
            return False
        for a in set_a:
            for b in set_b:
                if a == b or a in b or b in a:
                    return True
        return False

    async def _expand_department_subtree(self, root_ids: list[str]) -> set[str]:
        """展开飞书部门树（含子部门）；失败时退回仅根部门。"""
        roots = [d for d in root_ids if d]
        if not roots:
            return set()
        try:
            from app.core.feishu.contact import collect_department_tree_ids_for_roots

            tree = await collect_department_tree_ids_for_roots(roots)
            return set(tree) | set(roots)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            return set(roots)

    async def get_department_peer_user_ids(
        self,
        user_id: str,
        department_names: list[str],
    ) -> list[str]:
        """部门数据范围：按飞书部门树（含子部门）汇总可见用户。

        - Leader / department scope：可见本人所属部门及下级部门内销售的客户/需求/商机/合同等
        - 飞书部门负责人（leader_user_id）：额外以负责部门为根展开子树
        - 上级部门 Leader 因子树更大而自动看到更多人
        - 无 department_ids 的历史用户回退部门名模糊匹配
        """
        viewer = (
            await self.db.execute(
                text(
                    """
                    SELECT id, department_ids, department_names, manual_department_name,
                           manual_department_open_id, manual_department_leader,
                           feishu_open_id, feishu_led_department_ids
                      FROM users
                     WHERE id = :uid
                     LIMIT 1
                    """
                ),
                {"uid": user_id},
            )
        ).first()
        if not viewer:
            return [user_id]

        viewer_dept_ids = self._parse_department_ids(viewer[1])
        manual_open_id = (viewer[4] or "").strip() if viewer[4] else ""
        is_manual_leader = bool(viewer[5])
        if is_manual_leader and manual_open_id and manual_open_id not in viewer_dept_ids:
            viewer_dept_ids.append(manual_open_id)

        for led_id in self._parse_department_ids(viewer[7] if len(viewer) > 7 else None):
            if led_id not in viewer_dept_ids:
                viewer_dept_ids.append(led_id)

        feishu_open_id = (viewer[6] or "").strip() if len(viewer) > 6 and viewer[6] else ""
        if feishu_open_id:
            try:
                from app.core.feishu.contact import fetch_department_ids_led_by_open_id

                for led_id in await fetch_department_ids_led_by_open_id(feishu_open_id):
                    if led_id not in viewer_dept_ids:
                        viewer_dept_ids.append(led_id)
            except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
                pass

        viewer_names = self._parse_user_departments(
            department_names if department_names else viewer[2],
            viewer[3],
        )

        scope_dept_ids = await self._expand_department_subtree(viewer_dept_ids)

        rows = (
            await self.db.execute(
                text(
                    """
                    SELECT u.id,
                           u.department_ids,
                           u.department_names,
                           u.manual_department_name,
                           c.department_ids AS contact_department_ids
                      FROM users u
                 LEFT JOIN feishu_sales_contacts c
                        ON c.feishu_open_id = u.feishu_open_id
                    """
                ),
            )
        ).all()

        peer_ids: list[str] = []
        for uid, dept_ids_raw, dept_names_raw, manual_name, contact_dept_ids in rows:
            if uid == user_id:
                peer_ids.append(uid)
                continue

            peer_dept_ids = self._parse_department_ids(dept_ids_raw, contact_dept_ids)
            if scope_dept_ids and peer_dept_ids:
                if any(did in scope_dept_ids for did in peer_dept_ids):
                    peer_ids.append(uid)
                    continue
                # 已有部门 ID 但不在可见子树内：不回退名字，避免平级串部门
                continue

            # 历史数据无 department_ids：回退部门名模糊匹配
            if not viewer_names:
                continue
            peer_names = self._parse_user_departments(dept_names_raw, manual_name)
            if self._departments_overlap(viewer_names, peer_names):
                peer_ids.append(uid)

        if user_id not in peer_ids:
            peer_ids.append(user_id)
        return peer_ids

    async def get_managed_scope_user_ids(self, user_id: str) -> list[str]:
        """销售隔离可见集合：自己 ∪ 直接下级 ∪ 管辖部门子树成员（不含「仅同部门同伴」）。

        无 feishu_led / manual_leader / 直属下级时通常只有自己（售前/普通销售的「自己的池」）。
        """
        viewer = (
            await self.db.execute(
                text(
                    """
                    SELECT id, manual_department_open_id, manual_department_leader,
                           feishu_open_id, feishu_led_department_ids
                      FROM users
                     WHERE id = :uid
                     LIMIT 1
                    """
                ),
                {"uid": user_id},
            )
        ).first()
        if not viewer:
            return [user_id]

        roots: list[str] = []
        manual_open_id = (viewer[1] or "").strip() if viewer[1] else ""
        is_manual_leader = bool(viewer[2])
        if is_manual_leader and manual_open_id:
            roots.append(manual_open_id)

        for led_id in self._parse_department_ids(viewer[4] if len(viewer) > 4 else None):
            if led_id not in roots:
                roots.append(led_id)

        feishu_open_id = (viewer[3] or "").strip() if len(viewer) > 3 and viewer[3] else ""
        if feishu_open_id:
            try:
                from app.core.feishu.contact import fetch_department_ids_led_by_open_id

                for led_id in await fetch_department_ids_led_by_open_id(feishu_open_id):
                    if led_id not in roots:
                        roots.append(led_id)
            except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
                pass

        result_ids = {user_id}
        # 直接下级：飞书 leader_user_id == 我（失败则跳过，不阻塞管辖子树）
        if feishu_open_id:
            await self._add_direct_report_user_ids(result_ids, leader_open_id=feishu_open_id)

        if not roots:
            return list(result_ids)

        scope_dept_ids = await self._expand_department_subtree(roots)
        rows = (
            await self.db.execute(
                text(
                    """
                    SELECT u.id,
                           u.department_ids,
                           c.department_ids AS contact_department_ids
                      FROM users u
                 LEFT JOIN feishu_sales_contacts c
                        ON c.feishu_open_id = u.feishu_open_id
                     WHERE u.employment_status = :active
                    """
                ),
                {"active": EMPLOYMENT_ACTIVE},
            )
        ).all()

        for uid, dept_ids_raw, contact_dept_ids in rows:
            if uid == user_id:
                continue
            peer_dept_ids = self._parse_department_ids(dept_ids_raw, contact_dept_ids)
            if scope_dept_ids and peer_dept_ids and any(did in scope_dept_ids for did in peer_dept_ids):
                result_ids.add(uid)

        return list(result_ids)

    async def get_covering_leader_user_ids(self, member_user_id: str) -> list[str]:
        """返回管辖该成员的 Leader 用户 id（成员落在其 managed 范围内）。

        用于销售开池时自动给 Leader 建空壳对接池。不含成员本人；
        仅考虑 data_scope≠own 的角色（leader/ops/admin 等），且须真正管辖到该成员。

        性能：对候选 Leader 的管辖根部门一次性展开子树（有 Redis/进程缓存），
        禁止对每个候选再走 get_managed_scope_user_ids（会连环打飞书，转客户极慢）。
        """
        from app.modules.auth.permissions import get_data_scope

        uid = (member_user_id or "").strip()
        if not uid:
            return []

        member = (
            await self.db.execute(
                text(
                    """
                    SELECT id, department_ids, feishu_open_id, role
                      FROM users
                     WHERE id = :uid
                     LIMIT 1
                    """
                ),
                {"uid": uid},
            )
        ).first()
        if not member:
            return []

        member_depts = set(self._parse_department_ids(member[1]))
        if not member_depts:
            return []

        candidates = (
            await self.db.execute(
                text(
                    """
                    SELECT id, role, manual_department_open_id, manual_department_leader,
                           feishu_led_department_ids, feishu_open_id
                      FROM users
                     WHERE employment_status = :active
                       AND id != :uid
                       AND (
                            role IN ('leader', 'ops', 'admin', 'super_admin', 'presales')
                         OR manual_department_leader = 1
                         OR (feishu_led_department_ids IS NOT NULL
                             AND JSON_LENGTH(feishu_led_department_ids) > 0)
                       )
                    """
                ),
                {"active": EMPLOYMENT_ACTIVE, "uid": uid},
            )
        ).all()

        # 先收集全部管辖根，批量展开（避免 N 次飞书）
        cand_roots: list[tuple[str, list[str]]] = []
        all_roots: list[str] = []
        seen_roots: set[str] = set()
        for row in candidates:
            cand_id = str(row[0] or "").strip()
            if not cand_id:
                continue
            role = str(row[1] or "").strip()
            if get_data_scope(role) == "own":
                continue
            roots: list[str] = []
            manual_oid = (str(row[2]).strip() if row[2] else "")
            if bool(row[3]) and manual_oid:
                roots.append(manual_oid)
            for led_id in self._parse_department_ids(row[4]):
                if led_id not in roots:
                    roots.append(led_id)
            if not roots:
                continue
            cand_roots.append((cand_id, roots))
            for r in roots:
                if r not in seen_roots:
                    seen_roots.add(r)
                    all_roots.append(r)

        if not cand_roots:
            return []

        # root -> 子树部门集合
        root_scope: dict[str, set[str]] = {}
        for root in all_roots:
            root_scope[root] = await self._expand_department_subtree([root])

        out: list[str] = []
        seen: set[str] = set()
        for cand_id, roots in cand_roots:
            if cand_id in seen:
                continue
            scope: set[str] = set()
            for r in roots:
                scope |= root_scope.get(r) or set()
            if scope and any(d in scope for d in member_depts):
                seen.add(cand_id)
                out.append(cand_id)
        return out

    async def _add_direct_report_user_ids(self, result_ids: set[str], *, leader_open_id: str) -> None:
        """把飞书直属下级并入可见集合（销售通讯录成员；进程内短缓存，避免列表每次打飞书）。"""
        leader_oid = (leader_open_id or "").strip()
        if not leader_oid:
            return

        now = time.time()
        cached = _DIRECT_REPORT_CACHE.get(leader_oid)
        if cached and cached[0] > now:
            result_ids.update(cached[1])
            return

        rows = (
            await self.db.execute(
                text(
                    """
                    SELECT u.id, u.feishu_open_id
                      FROM users u
                      JOIN feishu_sales_contacts c
                        ON c.feishu_open_id = u.feishu_open_id
                     WHERE u.employment_status = :active
                       AND c.is_active = 1
                       AND u.feishu_open_id IS NOT NULL
                       AND u.feishu_open_id != ''
                    """
                ),
                {"active": EMPLOYMENT_ACTIVE},
            )
        ).all()
        open_ids = [str(r[1]).strip() for r in rows if r and r[1]]
        if not open_ids:
            _DIRECT_REPORT_CACHE[leader_oid] = (now + _DIRECT_REPORT_CACHE_TTL_SEC, [])
            return
        oid_to_uid = {str(r[1]).strip(): str(r[0]) for r in rows if r and r[0] and r[1]}
        report_ids: list[str] = []
        try:
            from app.core.feishu.contact import fetch_feishu_users_batch

            details = await fetch_feishu_users_batch(open_ids)
            for oid, detail in (details or {}).items():
                if not isinstance(detail, dict):
                    continue
                if str(detail.get("leader_user_id") or "").strip() != leader_oid:
                    continue
                uid = oid_to_uid.get(str(oid).strip())
                if uid:
                    report_ids.append(uid)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            # 失败不写缓存，下次可重试；本请求仅依赖管辖子树
            return

        _DIRECT_REPORT_CACHE[leader_oid] = (now + _DIRECT_REPORT_CACHE_TTL_SEC, report_ids)
        result_ids.update(report_ids)

    async def get_sales_directory_user_ids(self) -> list[str]:
        """销售成员目录对应用户 id（飞书销售组织快照 ∩ 本地 active users）。"""
        rows = (
            await self.db.execute(
                text(
                    """
                    SELECT DISTINCT u.id
                      FROM users u
                      JOIN feishu_sales_contacts c
                        ON c.feishu_open_id = u.feishu_open_id
                     WHERE u.employment_status = :active
                       AND c.is_active = 1
                    """
                ),
                {"active": EMPLOYMENT_ACTIVE},
            )
        ).all()
        return [str(r[0]) for r in rows if r and r[0]]

    async def get_sdr_directory_user_ids(self) -> list[str]:
        """SDR 成员目录对应用户 id（在职且主角色为 sdr 的本地用户）。

        用于 SDR 部门共享线索池：池内所有 SDR 可见彼此归属的线索，
        也作为「归属 SDR」改派的可指派集合。
        """
        result = await self.db.execute(
            select(User.id).where(
                User.employment_status == EMPLOYMENT_ACTIVE,
                User.role == "sdr",
            )
        )
        return [str(row_id) for row_id in result.scalars().all() if row_id]

    async def get_sdr_directory_user_names(self) -> list[str]:
        """SDR 成员目录对应显示名（与 id 目录同一口径）。

        用于共享线索池按 sdr 归属字段（导入线索）纳入可见范围。
        """
        result = await self.db.execute(
            select(User.name).where(
                User.employment_status == EMPLOYMENT_ACTIVE,
                User.role == "sdr",
            )
        )
        return [str(name) for name in result.scalars().all() if name]
