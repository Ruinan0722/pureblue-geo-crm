from __future__ import annotations

from typing import Any

from app.core.deps import (
    user_data_scope,
    user_has_permission,
)
from app.core.exceptions import (
    PermissionDeniedError,
)
from app.modules.auth.schemas import AuthUser
from app.modules.users.repository import UsersRepository

from .helpers_common import (
    _doc,
    _sort_follow_ups_newest_first,
)
from .helpers_customers import (
    _coverage_doc_with_children,
    _coverage_public_doc,
    _customer_master_columns,
    _strip_customer_master_document,
)


class BaseCustomerMixin:
    async def _assert_customer_master_readable(self, user: AuthUser, row=None) -> None:
                """公司主档可读：有客户模块权限且非纯 SDR。"""
                if self._is_sdr_role(user):
                    raise PermissionDeniedError()
                if not user_has_permission(user, "section:customers"):
                    raise PermissionDeniedError()
                if row is None:
                    raise PermissionDeniedError()
                if bool(getattr(row, "in_public_pool", False)) and not user_has_permission(
                    user, "public_pool:review"
                ):
                    raise PermissionDeniedError("该客户已进入公海池")

    async def _assert_customer_linkable_for_convert(self, user: AuthUser, row) -> None:
                """转客户关联已有公司：销售按主档可读；SDR 凭线索转客户权限可关联（不开放客户经营入口）。"""
                if row is None:
                    raise PermissionDeniedError()
                if self._is_sdr_role(user):
                    # 细粒度挂靠权限 leads:convert；兼容遗留总写码 leads:write
                    self._assert_lead_write(user, "leads:convert")
                    return
                await self._assert_customer_master_readable(user, row)

    async def _assert_customer_access(self, user: AuthUser, row) -> None:
                """兼容旧调用：主档可读即可（对接池内容另由 coverage 过滤）。"""
                await self._assert_customer_master_readable(user, row)

    async def _assert_coverage_access(
                self,
                user: AuthUser,
                coverage,
                *,
                write: bool = False,
                coverage_scope: str | None = None,
            ) -> None:
                allowed = await self._owner_filter(user, coverage_scope=coverage_scope)
                if allowed is None:
                    return
                if coverage.owner_user_id not in allowed:
                    raise PermissionDeniedError()
                # Leader 代改下属池允许；普通销售不可写他人
                if write and coverage.owner_user_id != user.id and user_data_scope(user) == "own":
                    raise PermissionDeniedError()

    async def _assert_customer_attachment_access(self, user: AuthUser, customer_id: str) -> None:
                """客户行上的附件：仅当存在可见对接池时放行（防主档可读导致串池）。"""
                if self._is_sdr_role(user):
                    raise PermissionDeniedError()
                if not user_has_permission(user, "section:customers"):
                    raise PermissionDeniedError()
                allowed = await self._owner_filter(user)
                if allowed is None:
                    return
                if not await self.repo.customer_has_coverage_for_owners(customer_id, allowed):
                    raise PermissionDeniedError()

    async def _get_or_create_coverage(
                self,
                *,
                customer_id: str,
                owner_user_id: str,
                owner_name: str = "",
                seed: dict[str, Any] | None = None,
                status: str = "awaiting_contact",
                ensure_leaders: bool = True,
            ):
                existing = await self.repo.get_coverage_by_customer_owner(customer_id, owner_user_id)
                if existing:
                    if ensure_leaders:
                        await self._ensure_leader_coverages_for_owner(customer_id, owner_user_id)
                    return existing, False
                seed_doc = dict(seed or {})
                seed_doc.setdefault("ownerName", owner_name)
                seed_doc.setdefault("contacts", [])
                seed_doc.setdefault("notes", [])
                seed_doc.setdefault("attachments", [])
                seed_doc.setdefault("status", status)
                row = await self.repo.create_coverage(
                    customer_id=customer_id,
                    owner_user_id=owner_user_id,
                    document=seed_doc,
                    status=status,
                )
                if ensure_leaders:
                    await self._ensure_leader_coverages_for_owner(customer_id, owner_user_id)
                return row, True

    async def _ensure_leader_coverages_for_owner(self, customer_id: str, sales_owner_user_id: str) -> list[str]:
                """销售开池后：为其管辖 Leader 自动建空壳对接池（已存在则跳过）。"""
                sales_uid = (sales_owner_user_id or "").strip()
                if not sales_uid or not customer_id:
                    return []
                leaders = await UsersRepository(self.db).get_covering_leader_user_ids(sales_uid)
                created_ids: list[str] = []
                users_repo = UsersRepository(self.db)
                for leader_id in leaders:
                    if leader_id == sales_uid:
                        continue
                    leader = await users_repo.get_by_id(leader_id)
                    leader_name = (leader.name if leader else "") or ""
                    _cov, created = await self._get_or_create_coverage(
                        customer_id=customer_id,
                        owner_user_id=leader_id,
                        owner_name=leader_name,
                        seed={
                            "ownerName": leader_name,
                            "contacts": [],
                            "notes": [],
                            "attachments": [],
                            "status": "awaiting_contact",
                            "importMeta": {"source": "auto_leader_coverage", "fromOwnerUserId": sales_uid},
                        },
                        status="awaiting_contact",
                        ensure_leaders=False,  # 防止 Leader 再级联
                    )
                    if created:
                        created_ids.append(_cov.id)
                return created_ids

    def _compose_customer_view(
                self,
                user: AuthUser,
                row,
                coverages: list,
                *,
                opportunity_count: int | None = None,
                contract_count: int | None = None,
                aggregate_pools: bool | None = None,
                coverage_children: dict | None = None,
            ) -> dict[str, Any]:
                """主档 + 可见对接池；扁平字段兼容旧前端。

                Leader/管理视角（非 own）：默认汇总可见池的 contacts/notes/attachments 并标归属；
                status/isKey/计划跟进仍以本人池为准。销售或只看自己：仅扁平本人（或唯一可见）池。
                """
                master = _strip_customer_master_document(_doc(row))
                master = _customer_master_columns(row, master)
                master["id"] = row.id
                master["companyName"] = master.get("companyName") or row.company_name or ""
                # Customer 前端契约中下列主档字段均为必有字符串。历史数据可能在
                # document 和列中同时为 NULL，若原样返回会使编辑表单对 undefined 调用 trim。
                # 在唯一的详情/列表组装点补齐，保证所有客户视图的 API 契约一致。
                for key in (
                    "brandName",
                    "region",
                    "city",
                    "industryL1",
                    "industryL2",
                    "foundedDate",
                    "creditCode",
                    "scale",
                    "nature",
                    "sdrTransferDate",
                    "source",
                    "createdAt",
                ):
                    master[key] = str(master.get(key) or "")
                try:
                    master["registeredCapital"] = float(master.get("registeredCapital") or 0)
                except (TypeError, ValueError):
                    master["registeredCapital"] = 0.0
                try:
                    master["annualRevenue"] = float(master.get("annualRevenue") or 0)
                except (TypeError, ValueError):
                    master["annualRevenue"] = 0.0
                migration = str(master.get("migrationStatus") or "")
                if not migration and getattr(row, "migration_status", None):
                    migration = str(row.migration_status)

                can_edit_master = self._can_edit_customer_master(user)
                scope = user_data_scope(user)
                own_coverage = next((cv for cv in coverages if cv.owner_user_id == user.id), None)
                # Leader/管理：多池或「本人+至少一可见池」时汇总；只看自己时 coverages 已收窄为本人
                do_aggregate = (
                    aggregate_pools
                    if aggregate_pools is not None
                    else (scope != "own" and len(coverages) > 1)
                )

                coverage_docs: list[dict[str, Any]] = []
                # 可写：池 owner 或 managed Leader/admin；子表合并进公开文档（删 JSON 列后必读）
                for cv in coverages:
                    can_edit = cv.owner_user_id == user.id or scope != "own"
                    if scope == "all":
                        can_edit = True
                    pub = _coverage_public_doc(
                        cv,
                        can_edit=(cv.owner_user_id == user.id) or can_edit_master or scope != "own",
                    )
                    pub["canEdit"] = can_edit
                    coverage_docs.append(
                        _coverage_doc_with_children(
                            pub,
                            (coverage_children or {}).get(cv.id) or {},
                        )
                    )

                primary = own_coverage if own_coverage is not None else (coverages[0] if coverages else None)

                view = dict(master)
                view["migrationStatus"] = migration or None
                view["canEditMaster"] = can_edit_master
                view["coverages"] = coverage_docs
                view["myCoverageId"] = own_coverage.id if own_coverage is not None else None

                def _stamp_owner(items: list, owner_name: str) -> list[dict[str, Any]]:
                    out: list[dict[str, Any]] = []
                    for raw in items:
                        if not isinstance(raw, dict):
                            continue
                        item = dict(raw)
                        if owner_name and not item.get("coverageOwner"):
                            item["coverageOwner"] = owner_name
                        out.append(item)
                    return out

                if do_aggregate and coverages:
                    contacts: list[dict[str, Any]] = []
                    notes: list[dict[str, Any]] = []
                    attachments: list[dict[str, Any]] = []
                    for cv in coverages:
                        cdoc = _coverage_doc_with_children(
                            _doc(cv),
                            (coverage_children or {}).get(cv.id) or {},
                        )
                        owner_name = str(cdoc.get("ownerName") or cdoc.get("owner") or "")
                        contacts.extend(_stamp_owner(cdoc.get("contacts") if isinstance(cdoc.get("contacts"), list) else [], owner_name))
                        notes.extend(_stamp_owner(cdoc.get("notes") if isinstance(cdoc.get("notes"), list) else [], owner_name))
                        attachments.extend(
                            _stamp_owner(cdoc.get("attachments") if isinstance(cdoc.get("attachments"), list) else [], owner_name)
                        )
                    view["contacts"] = contacts
                    # coverages 已完成数据范围过滤；这里只对可见记录做跨池全局倒序。
                    view["notes"] = _sort_follow_ups_newest_first(notes)
                    view["attachments"] = attachments
                    # 经营状态以本人池为准
                    if own_coverage is not None:
                        pdoc = _doc(own_coverage)
                        view["status"] = own_coverage.status
                        view["owner"] = str(pdoc.get("ownerName") or pdoc.get("owner") or "")
                        view["lastFollowAt"] = str(pdoc.get("lastFollowAt") or "")
                        view["nextFollowAt"] = str(pdoc.get("nextFollowAt") or "")
                        view["isKey"] = bool(pdoc.get("isKey") or False)
                    elif primary is not None:
                        pdoc = _doc(primary)
                        view["status"] = primary.status
                        view["owner"] = str(pdoc.get("ownerName") or pdoc.get("owner") or "")
                        view["lastFollowAt"] = str(pdoc.get("lastFollowAt") or "")
                        view["nextFollowAt"] = str(pdoc.get("nextFollowAt") or "")
                        view["isKey"] = bool(pdoc.get("isKey") or False)
                    else:
                        view["status"] = ""
                        view["owner"] = ""
                        view["lastFollowAt"] = ""
                        view["nextFollowAt"] = ""
                        view["isKey"] = False
                elif primary:
                    pdoc = _coverage_doc_with_children(
                        _doc(primary),
                        (coverage_children or {}).get(primary.id) or {},
                    )
                    view["status"] = primary.status
                    view["owner"] = str(pdoc.get("ownerName") or pdoc.get("owner") or "")
                    owner_name = str(pdoc.get("ownerName") or pdoc.get("owner") or "")
                    contacts = pdoc.get("contacts") if isinstance(pdoc.get("contacts"), list) else []
                    notes = pdoc.get("notes") if isinstance(pdoc.get("notes"), list) else []
                    attachments = pdoc.get("attachments") if isinstance(pdoc.get("attachments"), list) else []
                    # 单池（Leader/管理员/运营视角）：联系人/跟进/附件同样标注归属，
                    # 与多池聚合视图一致，避免管理员只看得到归属而超管/运营单池时缺失。
                    if scope != "own":
                        contacts = _stamp_owner(contacts, owner_name)
                        notes = _stamp_owner(notes, owner_name)
                        attachments = _stamp_owner(attachments, owner_name)
                    view["contacts"] = contacts
                    view["notes"] = _sort_follow_ups_newest_first(notes)
                    view["attachments"] = attachments
                    view["lastFollowAt"] = str(pdoc.get("lastFollowAt") or "")
                    view["nextFollowAt"] = str(pdoc.get("nextFollowAt") or "")
                    view["isKey"] = bool(pdoc.get("isKey") or False)
                else:
                    # 无可见池：主档可见，经营字段空（决策 12）
                    view["status"] = ""
                    view["owner"] = ""
                    view["contacts"] = []
                    view["notes"] = []
                    view["attachments"] = []
                    view["lastFollowAt"] = ""
                    view["nextFollowAt"] = ""
                    view["isKey"] = False
                    # 兼容未迁移旧档：主档内嵌经营数据仅全量范围（admin/ops）可见。
                    # department/own 一律走池隔离——未归因（pending）客户的联系人/跟进
                    # 在迁移归因进池前不跨区域展示（决策 12：主档可读 ≠ 池内容可读）。
                    if migration in ("legacy_shared", "pending") and getattr(row, "document", None):
                        legacy = _doc(row)
                        if scope == "all" and isinstance(legacy.get("contacts"), list) and legacy.get("contacts"):
                            view["contacts"] = legacy.get("contacts") or []
                            view["notes"] = legacy.get("notes") if isinstance(legacy.get("notes"), list) else []
                            view["attachments"] = (
                                legacy.get("attachments") if isinstance(legacy.get("attachments"), list) else []
                            )
                            view["status"] = str(legacy.get("status") or row.status or "")
                            view["owner"] = str(legacy.get("owner") or "")

                if opportunity_count is not None:
                    view["opportunityCount"] = opportunity_count
                if contract_count is not None:
                    view["contractCount"] = contract_count
                return view
