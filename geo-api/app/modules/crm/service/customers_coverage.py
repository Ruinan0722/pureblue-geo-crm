from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.core.deps import user_data_scope
from app.core.exceptions import (
    AppError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.time_utils import china_now
from app.modules.auth.schemas import AuthUser
from app.modules.crm.service.base import (
    _coverage_doc_with_children,
    _coverage_public_doc,
    _customer_update_write_codes,
    _doc,
)
from app.modules.users.repository import UsersRepository


def _rebalance_contact_primary(contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """保证每个对接池最多一个主联系人；无主时自动补选第一个。"""
    result = list(contacts)
    has_primary = any(c.get("isPrimary") for c in result)
    if has_primary:
        seen = False
        for contact in result:
            if contact.get("isPrimary"):
                if seen:
                    contact["isPrimary"] = False
                seen = True
    elif result:
        result[0]["isPrimary"] = True
    return result


def _mark_follow_up_contacts_connected(
    contacts: list[dict[str, Any]], notes: list[dict[str, Any]]
) -> None:
    """跟进记录勾选联系人后，该联系人状态从「待建联」升级为「已建联」。

    仅升级不降级：已是商机跟进/已合作/停止跟进的联系人保持原状态；
    兼容历史遗留 potential（待建联）值。直接原地修改 contacts 中的联系人对象。
    """
    note_contact_ids = {
        str(note.get("contactId") or "").strip()
        for note in (notes or [])
        if isinstance(note, dict) and str(note.get("contactId") or "").strip()
    }
    if not note_contact_ids:
        return
    for contact in contacts or []:
        if not isinstance(contact, dict):
            continue
        if str(contact.get("id") or "").strip() not in note_contact_ids:
            continue
        status = str(contact.get("status") or "awaiting_contact").strip()
        if status in ("", "awaiting_contact", "potential"):
            contact["status"] = "connected"


class CustomerCoverageMixin:
    async def list_customer_coverages(
            self, user: AuthUser, customer_id: str, *, coverage_scope: str | None = None
        ) -> list[dict[str, Any]]:
            self._assert_section(user, "customers")
            row = await self.repo.get_customer(customer_id)
            if not row:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, row)
            owners = await self._owner_filter(user, coverage_scope=coverage_scope)
            coverages = await self.repo.list_coverages_for_customer(customer_id, owner_ids=owners)
            view = await self._compose_customer_view_async(user, row, coverages)
            return list(view.get("coverages") or [])

    async def get_coverage(self, user: AuthUser, coverage_id: str) -> dict[str, Any]:
            self._assert_section(user, "customers")
            row = await self.repo.get_coverage(coverage_id)
            if not row:
                raise NotFoundError("对接池不存在")
            await self._assert_coverage_access(user, row)
            can_edit = row.owner_user_id == user.id or user_data_scope(user) != "own"
            if user_data_scope(user) == "all":
                can_edit = True
            # 删 JSON 列后联系人/跟进/附件只在子表；PATCH 回写后前端依赖本响应刷新标签
            children = await self.repo.list_coverage_children([row.id])
            return _coverage_doc_with_children(
                _coverage_public_doc(row, can_edit=can_edit),
                children.get(row.id) or {},
            )

    async def update_coverage(
            self, user: AuthUser, coverage_id: str, document: dict[str, Any]
        ) -> dict[str, Any]:
            self._assert_section(user, "customers")
            payload = dict(document or {})
            self._assert_customer_write_codes(user, _customer_update_write_codes(payload))
            row = await self.repo.get_coverage(coverage_id)
            if not row:
                raise NotFoundError("对接池不存在")
            await self._assert_coverage_access(user, row, write=True)
            cov_children = await self.repo.list_coverage_children([row.id])
            cov_doc = {
                **_coverage_doc_with_children(_doc(row), cov_children.get(row.id) or {}),
                **payload,
            }
            if "owner" in payload and "ownerName" not in payload:
                cov_doc["ownerName"] = payload.get("owner")
            if isinstance(payload.get("notes"), list):
                _mark_follow_up_contacts_connected(
                    cov_doc.get("contacts") or [], payload.get("notes") or []
                )
            row = await self.repo.save_coverage(
                row, cov_doc, status=str(payload.get("status") or cov_doc.get("status") or row.status)
            )
            # 同步客户列 denorm（兼容列表筛选）
            customer = await self.repo.get_customer(row.customer_id)
            if customer:
                cdoc = {
                    **_doc(customer),
                    "subsidiaries": await self.repo.list_customer_subsidiaries(customer.id),
                }
                cdoc["status"] = row.status
                if cov_doc.get("ownerName"):
                    cdoc["owner"] = cov_doc.get("ownerName")
                await self.repo.save_customer(customer, cdoc)
            await self._commit_and_invalidate_crm(user.id, row.owner_user_id)
            return await self.get_coverage(user, coverage_id)

    async def transfer_customer_contact(
            self,
            user: AuthUser,
            *,
            customer_id: str,
            contact_id: str,
            target_owner_name: str,
        ) -> dict[str, Any]:
            """联系人改派归属（方案 A：池间移动）。

            联系人归属 = 所在对接池负责人；改派 = 从源池移除并加入目标池
            （保留 id/createdAt，目标池不存在则自动建立）。服务端强制细码
            contact_edit + contact_assign、源池可写、目标为可指派成员
            （仅限销售成员目录；Leader 另限自身管辖可见范围且不能改派给自己），
            并写服务端审计。

            注意：改派只移动联系人本身，源池的跟进记录保留在原池（历史归属不迁移）；
            其 CrmFollowUp.contact_id 可能指向已不在本池的联系人，展示依赖冗余的
            contactName 字段，属既定语义，后续若按 contact_id 做统计/通知需另行处理。
            """
            self._assert_section(user, "customers")
            self._assert_customer_write(user, "customers:contact_edit")
            self._assert_customer_write(user, "customers:contact_assign")

            customer = await self.repo.get_customer(customer_id)
            if not customer:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, customer)

            contact = await self.repo.get_coverage_contact(
                customer_id=customer_id, contact_id=contact_id
            )
            if not contact:
                raise NotFoundError("联系人不存在")

            source = await self.repo.get_coverage(contact.coverage_id)
            if not source:
                raise NotFoundError("联系人所在对接池不存在")
            await self._assert_coverage_access(user, source, write=True)

            target_name = str(target_owner_name or "").strip()
            if not target_name or target_name in ("未分配", "待分配"):
                raise ValidationError("请选择有效的销售成员")
            target_user_id = await self._resolve_owner_user_id(user, target_name)
            await self._assert_assignable_owner(user, target_user_id)
            # 归属目标只能是销售成员目录中的同事（与可指派候选接口同一口径）
            sales_ids = await UsersRepository(self.db).get_sales_directory_user_ids()
            if target_user_id not in sales_ids:
                raise PermissionDeniedError("只能将联系人改派给销售成员目录中的同事")
            if user_data_scope(user) != "all":
                allowed = await self._owner_filter(user)
                if allowed is not None and target_user_id not in allowed:
                    raise PermissionDeniedError("只能将联系人改派给可见范围内的销售成员")
                # 销售 Leader：归属目标只能是下属销售，不能改派给自己
                if target_user_id == user.id:
                    raise PermissionDeniedError("只能将联系人改派给下属销售，不能改派给自己")

            source_owner_name = str(
                _doc(source).get("ownerName") or _doc(source).get("owner") or ""
            ).strip()
            if target_user_id == source.owner_user_id:
                # 目标即当前归属：幂等成功，无写库
                return await self.get_coverage(user, source.id)

            target_user = await UsersRepository(self.db).get_by_id(target_user_id)
            if target_user and (target_user.name or "").strip():
                target_name = target_user.name.strip()

            target, _created = await self._get_or_create_coverage(
                customer_id=customer_id,
                owner_user_id=target_user_id,
                owner_name=target_name,
                seed={
                    "ownerName": target_name,
                    "contacts": [],
                    "notes": [],
                    "attachments": [],
                    "status": "awaiting_contact",
                },
                status="awaiting_contact",
            )

            children = await self.repo.list_coverage_children([source.id, target.id])
            source_children = children.get(source.id) or {}
            target_children = children.get(target.id) or {}
            source_doc = _coverage_doc_with_children(_doc(source), source_children)
            target_doc = _coverage_doc_with_children(_doc(target), target_children)

            source_contacts = list(source_doc.get("contacts") or [])
            target_contacts = list(target_doc.get("contacts") or [])
            moved = next(
                (c for c in source_contacts if str(c.get("id") or "") == contact_id),
                None,
            )
            if moved is None:
                raise NotFoundError("联系人不存在")

            source_contacts = [
                c for c in source_contacts if str(c.get("id") or "") != contact_id
            ]
            moved_doc = dict(moved)
            target_contacts.append(moved_doc)
            source_doc["contacts"] = _rebalance_contact_primary(source_contacts)
            target_doc["contacts"] = _rebalance_contact_primary(target_contacts)

            source = await self.repo.save_coverage(
                source,
                source_doc,
                status=str(source_doc.get("status") or source.status or "awaiting_contact"),
            )
            target = await self.repo.save_coverage(
                target,
                target_doc,
                status=str(target_doc.get("status") or target.status or "awaiting_contact"),
            )

            company_name = str(
                _doc(customer).get("companyName")
                or getattr(customer, "company_name", "")
                or ""
            ).strip()
            contact_name = str(moved_doc.get("name") or contact.name or "").strip()
            await self.repo.create_audit_record(
                record_id=f"audit-{int(china_now().timestamp() * 1000)}-{uuid4().hex[:4]}"[:64],
                module="客户管理",
                entity_type="contact",
                entity_id=contact_id[:64],
                related_entity_ids=[customer_id],
                entity_name=(
                    f"{company_name} / {contact_name}" if company_name else contact_name
                )[:255],
                action="变更联系人归属",
                actor=(user.name or "")[:128],
                actor_user_id=user.id,
                timestamp_at=china_now().replace(microsecond=0),
                changes=[
                    {
                        "field": "owner",
                        "label": "成员归属",
                        "before": source_owner_name,
                        "after": target_name,
                    }
                ],
            )
            await self._commit_and_invalidate_crm(
                user.id, source.owner_user_id, target_user_id
            )
            return await self.get_coverage(user, target.id)

    async def list_assignable_contact_owners(
            self, user: AuthUser, customer_id: str
        ) -> dict[str, Any]:
            """改派联系人归属的可选成员：服务端按可指派集合下发，前端仅渲染此列表。

            all 范围（运营/管理员）：销售成员目录；
            Leader：销售成员目录 ∩ 自身管辖可见范围，且不含本人（只能改派给下属销售）。
            """
            self._assert_section(user, "customers")
            self._assert_customer_write(user, "customers:contact_edit")
            self._assert_customer_write(user, "customers:contact_assign")
            customer = await self.repo.get_customer(customer_id)
            if not customer:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, customer)

            users_repo = UsersRepository(self.db)
            ids = await users_repo.get_sales_directory_user_ids()
            # 归属目标只能是其他销售，本人不作为候选
            ids = [uid for uid in ids if uid != user.id]
            if user_data_scope(user) != "all":
                allowed = await self._owner_filter(user)
                if allowed is not None:
                    allowed_set = set(allowed)
                    ids = [uid for uid in ids if uid in allowed_set]

            active = {
                u.id: u.name
                for u in await users_repo.list_active_directory()
                if u.id and (u.name or "").strip()
            }
            items = [
                {"id": uid, "name": active[uid]}
                for uid in ids
                if uid in active
            ]
            items.sort(key=lambda item: (item["name"] or "").lower())
            return {"items": items}

    async def create_customer_coverage(
            self,
            user: AuthUser,
            customer_id: str,
            *,
            owner_user_id: str | None = None,
            document: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            self._assert_section(user, "customers")
            self._assert_any_customer_write(user)
            customer = await self.repo.get_customer(customer_id)
            if not customer:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, customer)
            target = (owner_user_id or user.id).strip()
            if target != user.id:
                await self._assert_assignable_owner(user, target)
                # 仅 Leader/admin 可为他人开池
                if user_data_scope(user) == "own":
                    raise PermissionDeniedError("普通销售仅可为自己建立对接池")
                allowed = await self._owner_filter(user)
                if allowed is not None and target not in allowed:
                    raise PermissionDeniedError("只能为可见范围内的销售建立对接池")
            owner_name = str((document or {}).get("ownerName") or (document or {}).get("owner") or user.name or "")
            seed = dict(document or {})
            status_val = str(seed.get("status") or "awaiting_contact")
            coverage, created = await self._get_or_create_coverage(
                customer_id=customer_id,
                owner_user_id=target,
                owner_name=owner_name,
                seed=seed,
                status=status_val,
            )
            if not created and seed:
                # 已存在则按 update 合并
                await self._assert_coverage_access(user, coverage, write=True)
                cov_children = await self.repo.list_coverage_children([coverage.id])
                cov_doc = {
                    **_coverage_doc_with_children(_doc(coverage), cov_children.get(coverage.id) or {}),
                    **seed,
                }
                coverage = await self.repo.save_coverage(coverage, cov_doc, status=status_val)
            await self._commit_and_invalidate_crm(user.id, target)
            return await self.get_coverage(user, coverage.id)

    async def _write_customer_owner_audit(
            self,
            *,
            user: AuthUser,
            customer_id: str,
            company_name: str,
            before_owner: str,
            after_owner: str,
        ) -> None:
            await self.repo.create_audit_record(
                record_id=f"audit-{int(china_now().timestamp() * 1000)}-{uuid4().hex[:4]}"[:64],
                module="客户管理",
                entity_type="customer",
                entity_id=customer_id[:64],
                related_entity_ids=None,
                entity_name=(company_name or "")[:255],
                action="变更负责人",
                actor=user.name[:128],
                actor_user_id=user.id,
                timestamp_at=china_now().replace(microsecond=0),
                changes=[
                    {
                        "field": "owner",
                        "label": "负责人",
                        "before": before_owner,
                        "after": after_owner,
                    }
                ],
            )

    async def batch_assign_customer_owner(
            self,
            user: AuthUser,
            *,
            customer_ids: list[str],
            owner: str,
        ) -> dict[str, Any]:
            """客户列表批量指定销售负责人；逐条校验可见性，聚合成功/失败。"""
            self._assert_section(user, "customers")
            self._assert_write(user, "customers:write")
            # 批量分配面向 Leader / 运营 / 管理员（部门或全局范围）；本人范围请走单客户编辑
            if user_data_scope(user) == "own":
                raise PermissionDeniedError("仅部门或全局数据范围可批量分配客户负责人")
            owner_name = str(owner or "").strip()
            if not owner_name or owner_name in ("未分配", "待分配"):
                raise ValidationError("请选择有效的销售负责人")

            seen: set[str] = set()
            ordered_ids: list[str] = []
            for raw in customer_ids or []:
                cid = str(raw or "").strip()
                if not cid or cid in seen:
                    continue
                seen.add(cid)
                ordered_ids.append(cid)
            if not ordered_ids:
                raise ValidationError("请至少选择一个客户")
            if len(ordered_ids) > 100:
                raise ValidationError("单次最多分配 100 个客户")

            next_owner_id = await self._resolve_owner_user_id(user, owner_name)
            await self._assert_assignable_owner(user, next_owner_id)

            succeeded: list[dict[str, str]] = []
            failed: list[dict[str, str]] = []
            touched_owners: set[str] = {user.id, next_owner_id}

            for customer_id in ordered_ids:
                company_name = ""
                try:
                    row = await self.repo.get_customer(customer_id)
                    if not row:
                        failed.append(
                            {
                                "customer_id": customer_id,
                                "company_name": "",
                                "reason": "客户不存在",
                            }
                        )
                        continue
                    await self._assert_customer_access(user, row)
                    prev = {
                        **_doc(row),
                        "subsidiaries": await self.repo.list_customer_subsidiaries(customer_id),
                    }
                    company_name = str(prev.get("companyName") or "")
                    prev_owner_name = str(prev.get("owner") or "").strip()
                    prev_owner_id = row.owner_user_id
                    if prev_owner_id:
                        touched_owners.add(prev_owner_id)

                    # 已是同一负责人：计成功、跳过写库
                    if prev_owner_id == next_owner_id and prev_owner_name == owner_name:
                        succeeded.append(
                            {
                                "customer_id": customer_id,
                                "company_name": company_name,
                                "reason": "",
                            }
                        )
                        continue

                    payload = dict(prev)
                    payload["owner"] = owner_name
                    if not payload.get("sdrUserId") and prev.get("sdrUserId"):
                        payload["sdrUserId"] = prev.get("sdrUserId")
                    if not payload.get("createdByUserId") and prev.get("createdByUserId"):
                        payload["createdByUserId"] = prev.get("createdByUserId")

                    row = await self.repo.save_customer(row, payload, owner_user_id=next_owner_id)
                    if next_owner_id != prev_owner_id:
                        await self._write_customer_owner_audit(
                            user=user,
                            customer_id=customer_id,
                            company_name=company_name,
                            before_owner=prev_owner_name,
                            after_owner=owner_name,
                        )
                    succeeded.append(
                        {
                            "customer_id": customer_id,
                            "company_name": company_name,
                            "reason": "",
                        }
                    )
                except AppError as e:
                    failed.append(
                        {
                            "customer_id": customer_id,
                            "company_name": company_name,
                            "reason": e.message or "分配失败",
                        }
                    )

            await self._commit_and_invalidate_crm(*touched_owners)
            return {
                "owner": owner_name,
                "succeeded": succeeded,
                "failed": failed,
            }
