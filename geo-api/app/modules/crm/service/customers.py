from __future__ import annotations

from app.modules.crm.service.base import (
    CUSTOMER_CREATE_SOURCES,
    CUSTOMER_POOL_FIELDS,
    CUSTOMER_RESPONSE_META_FIELDS,
    EMPTY_CUSTOMER_STATS,
    Any,
    AuthUser,
    LeadSourceOption,
    NotFoundError,
    PermissionDeniedError,
    UsersRepository,
    ValidationError,
    _china_today_iso,
    _coverage_doc_with_children,
    _customer_update_write_codes,
    _doc,
    _extract_pool_fields,
    _pool_fields_have_operating_content,
    _strip_customer_master_document,
    date,
    format_legacy_time,
    new_id,
    select,
    user_data_scope,
)
from app.modules.crm.service.customers_convert import CustomerConvertMixin
from app.modules.crm.service.customers_coverage import CustomerCoverageMixin
from app.modules.crm.service.leads import _lead_response


class CustomerMixin(CustomerConvertMixin, CustomerCoverageMixin):
    """客户主档/对接池/转客户混合（拆分后保持原接口）。"""

    async def _compose_customer_view_async(
                self, user, row, coverages, **kwargs
            ) -> dict[str, Any]:
                """加载对接池子表后组装客户视图（删 JSON 列后数组来自子表）。"""
                cov_children = await self.repo.list_coverage_children(
                    [cv.id for cv in coverages]
                )
                subsidiaries = await self.repo.list_customer_subsidiaries(row.id)
                view = self._compose_customer_view(
                    user,
                    row,
                    coverages,
                    coverage_children=cov_children,
                    **kwargs,
                )
                view["subsidiaries"] = subsidiaries
                return view

    async def _validated_customer_entry_source(
            self, payload: dict[str, Any]
        ) -> tuple[str, str]:
            """新增客户/联系人共用来源规则：四项一级来源，会议二级来源按启用目录校验。"""
            source = str(payload.get("source") or "").strip()
            if source not in CUSTOMER_CREATE_SOURCES:
                raise ValidationError("来源仅支持三方会议、自办会议或自拓")
            source_detail = str(payload.get("sourceDetail") or "").strip()
            if source == "自拓":
                return source, ""
            options = (
                await self.db.execute(
                    select(LeadSourceOption).where(
                        LeadSourceOption.primary_source == source,
                        LeadSourceOption.enabled.is_(True),
                        LeadSourceOption.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
            if options and not source_detail:
                raise ValidationError("请选择二级来源")
            if source_detail and not any(option.display_name == source_detail for option in options):
                raise ValidationError("二级来源不在所选一级来源的可选列表中，请刷新后重新选择")
            return source, source_detail

    async def list_customers(
            self,
            user: AuthUser,
            *,
            company_name: str | None = None,
            brand_name: str | None = None,
            owner: str | None = None,
            status: str | None = None,
            industry: str | None = None,
            industry_l2: str | None = None,
            region: str | None = None,
            credit_code: str | None = None,
            key_only: bool = False,
            last_follow_from: str | None = None,
            last_follow_to: str | None = None,
            next_follow_from: str | None = None,
            next_follow_to: str | None = None,
            relation: str | None = None,
            mine_only: bool = False,
            coverage_scope: str | None = None,
            page: int = 1,
            page_size: int = 10,
        ) -> dict[str, Any]:
            self._assert_section(user, "customers")
            # mine_only / coverageScope=self → 只看自己
            scope = "self" if mine_only else coverage_scope
            owners = await self._owner_filter(user, mine_only=mine_only, coverage_scope=scope)
            # 决策 12：默认列表展示全部公司主档（池内容仍按 owners 隔离）；
            # 「只看自己」才按本人对接池过滤
            show_all_masters = not mine_only and (scope or "").lower() != "self"
            inc = self._include_unassigned(user, mine_only=mine_only or (scope or "").lower() == "self")
            page = max(1, int(page or 1))
            page_size = min(100, max(1, int(page_size or 10)))
            rows, total = await self.repo.search_customers(
                owners,
                include_unassigned=inc,
                include_all_masters=show_all_masters,
                company_name=company_name,
                brand_name=brand_name,
                owner=None if mine_only else owner,
                status=status,
                industry=industry,
                industry_l2=industry_l2,
                region=region,
                credit_code=credit_code,
                key_only=key_only,
                last_follow_from=last_follow_from,
                last_follow_to=last_follow_to,
                next_follow_from=next_follow_from,
                next_follow_to=next_follow_to,
                relation=relation,
                page=page,
                page_size=page_size,
            )
            customer_ids = [row.id for row in rows]
            cov_map = await self.repo.list_coverages_for_customers(customer_ids, owner_ids=owners)
            opp_counts = await self.repo.count_opportunities_by_customer_ids(
                customer_ids, owner_ids=owners
            )
            contract_counts = await self.repo.count_contracts_by_customer_ids(
                customer_ids, owner_ids=owners
            )
            items: list[dict[str, Any]] = []
            for row in rows:
                items.append(
                    await self._compose_customer_view_async(
                        user,
                        row,
                        cov_map.get(row.id, []),
                        opportunity_count=int(opp_counts.get(row.id, 0)),
                        contract_count=int(contract_counts.get(row.id, 0)),
                    )
                )
            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    async def get_customer(
            self,
            user: AuthUser,
            customer_id: str,
            *,
            coverage_scope: str | None = None,
        ) -> dict[str, Any]:
            self._assert_section(user, "customers")
            row = await self.repo.get_customer(customer_id)
            if not row:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, row)
            owners = await self._owner_filter(user, coverage_scope=coverage_scope)
            coverages = await self.repo.list_coverages_for_customer(customer_id, owner_ids=owners)
            return await self._compose_customer_view_async(user, row, coverages)

    async def get_customer_stats(
            self,
            user: AuthUser,
            *,
            mine_only: bool = False,
            coverage_scope: str | None = None,
        ) -> dict[str, int]:
            self._assert_section(user, "customers")
            if self._is_sdr_role(user):
                return dict(EMPTY_CUSTOMER_STATS)
            scope = "self" if mine_only else coverage_scope
            owners = await self._owner_filter(user, mine_only=mine_only, coverage_scope=scope)
            show_all_masters = not mine_only and (scope or "").lower() != "self"
            return await self.repo.aggregate_customer_stats(
                owners, count_all_masters=show_all_masters
            )

    async def create_customer(self, user: AuthUser, document: dict[str, Any]) -> dict[str, Any]:
            """销售建档：公司主档 + 本人销售对接池一次建成；
            与「新增联系人」一致，同事务回填一条已转化线索到线索管理。

            必填项与线索转客户一致：公司名称、联系人姓名、电话或微信至少一项；
            公司名精确/信用代码冲突服务端硬拦截，与转客户查重规则一致。
            """
            self._assert_section(user, "customers")
            self._assert_customer_write(user, "customers:create")
            payload = dict(document or {})
            company_name = str(payload.get("companyName") or "").strip()
            if not company_name:
                raise ValidationError("公司名称不能为空")
            # 前端经 provider 组装联系人到 document.contacts[0]；同时兼容扁平字段（curl/测试）
            raw_contacts = payload.get("contacts")
            first_contact = {}
            if isinstance(raw_contacts, list) and raw_contacts and isinstance(raw_contacts[0], dict):
                first_contact = raw_contacts[0]
            contact_name = str(
                payload.get("contactName") or first_contact.get("name") or ""
            ).strip()
            phone = str(
                payload.get("contactPhone") or first_contact.get("phone") or ""
            ).strip()
            wechat = str(
                payload.get("contactWechat") or first_contact.get("wechat") or ""
            ).strip()
            contact_title = str(
                payload.get("contactTitle") or first_contact.get("title") or ""
            ).strip()
            contact_email = str(
                payload.get("contactEmail") or first_contact.get("email") or ""
            ).strip()
            wechat_added = bool(
                payload.get("wechatAdded", first_contact.get("wechatAdded", False))
            )
            if not contact_name:
                raise ValidationError("联系人姓名不能为空")
            if not phone and not wechat:
                raise ValidationError("联系人电话或微信至少填写一项")
            source, source_detail = await self._validated_customer_entry_source(payload)
            payload["source"] = source
            payload["sourceDetail"] = source_detail
            await self._raise_if_company_conflict(user, payload)

            owner_name = str(payload.get("owner") or "").strip() or (user.name or "")
            owner_user_id = await self._resolve_owner_user_id(user, owner_name)
            await self._assert_assignable_owner(user, owner_user_id)
            await self._assert_sales_customer_capacity(owner_user_id)

            today = date.today().isoformat()
            customer_id = str(payload.get("id") or new_id("c"))
            new_lead_id = new_id("l")
            customer_doc: dict[str, Any] = {
                "id": customer_id,
                "companyUid": f"CUS-{date.today().year}-{customer_id[-4:].upper()}",
                "companyName": company_name,
                "brandName": str(payload.get("brandName") or "").strip() or company_name,
                "region": str(payload.get("region") or "").strip(),
                "city": str(payload.get("city") or "").strip(),
                "industryL1": str(payload.get("industryL1") or "").strip(),
                "industryL2": str(payload.get("industryL2") or "").strip(),
                "foundedDate": str(payload.get("foundedDate") or "").strip(),
                "creditCode": str(payload.get("creditCode") or "").strip(),
                "registeredCapital": payload.get("registeredCapital") or 0,
                "annualRevenue": payload.get("annualRevenue") or 0,
                "scale": str(payload.get("scale") or "").strip(),
                "nature": str(payload.get("nature") or "").strip(),
                "sdr": "",
                "sdrUserId": "",
                "createdByUserId": user.id,
                "sourceLeadId": "",
                "sdrTransferDate": "",
                "source": source,
                "sourceDetail": source_detail,
                "createdAt": today,
                "subsidiaries": [],
                "migrationStatus": "done",
                "isolationVersion": 1,
            }
            customer_row = await self.repo.create_customer(
                document={**customer_doc, "status": "connected", "owner": owner_name},
                owner_user_id=owner_user_id,
            )
            coverage_seed: dict[str, Any] = {
                "ownerName": owner_name,
                "status": "connected",
                "isKey": bool(payload.get("isKey")),
                "contacts": [
                    {
                        "id": new_id("ct"),
                        "name": contact_name,
                        "title": contact_title,
                        "phone": phone,
                        "email": contact_email,
                        "wechat": wechat,
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": wechat_added,
                        "createdAt": format_legacy_time(),
                        "status": "awaiting_contact",
                        "source": source,
                        "sourceDetail": source_detail,
                        "sourceLeadId": new_lead_id,
                    }
                ],
                "notes": [],
                "attachments": [],
                "lastFollowAt": "",
                "sourceLeadId": "",
                "sdrName": "",
                "sdrTransferDate": "",
            }
            coverage, _ = await self._get_or_create_coverage(
                customer_id=customer_id,
                owner_user_id=owner_user_id,
                owner_name=owner_name,
                seed=coverage_seed,
                status="connected",
                ensure_leaders=False,
            )
            lead_doc: dict[str, Any] = {
                **payload,
                "id": new_lead_id,
                "createdAt": str(payload.get("createdAt") or _china_today_iso()),
                "companyName": company_name,
                "brandName": str(payload.get("brandName") or "").strip() or company_name,
                "website": str(payload.get("website") or "").strip(),
                "region": str(payload.get("region") or "").strip(),
                "city": str(payload.get("city") or "").strip(),
                "contactName": contact_name,
                "contactPhone": phone,
                "contactWechat": wechat,
                "sales": user.name,
                "sdr": "",
                "status": "converted",
                "followState": "converted",
                "transferDate": _china_today_iso(),
                "convertedCustomerId": customer_id,
                "convertedCoverageId": coverage.id,
                "sourceCustomerId": customer_id,
                "notes": list(payload.get("notes") or []),
                "attachments": list(payload.get("attachments") or []),
                "markMaterials": list(payload.get("markMaterials") or []),
            }
            await self.repo.create_lead(document=lead_doc, owner_user_id=user.id)
            await self._commit_and_invalidate_crm(user.id, owner_user_id)
            return await self._compose_customer_view_async(user, customer_row, [coverage])

    async def create_customer_contact_lead(
            self, user: AuthUser, customer_id: str, document: dict[str, Any]
        ) -> dict[str, Any]:
            """销售在客户下新增联系人时，同事务回填一条已转化线索。"""
            self._assert_section(user, "customers")
            self._assert_customer_write(user, "customers:contact_add")
            customer = await self.repo.get_customer(customer_id)
            if not customer:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, customer)
            coverage = await self.repo.get_coverage_by_customer_owner(customer_id, user.id)
            if not coverage:
                # 首次维护客户：自动建立本人对接池（对用户透明，决策 12）
                coverage, _ = await self._get_or_create_coverage(
                    customer_id=customer_id,
                    owner_user_id=user.id,
                    owner_name=(user.name or "").strip(),
                    seed={
                        "ownerName": (user.name or "").strip(),
                        "contacts": [],
                        "notes": [],
                        "attachments": [],
                    },
                    status="awaiting_contact",
                    ensure_leaders=False,
                )
            await self._assert_coverage_access(user, coverage, write=True)

            payload = dict(document or {})
            contact_name = str(payload.get("contactName") or "").strip()
            phone = str(payload.get("contactPhone") or "").strip()
            wechat = str(payload.get("contactWechat") or "").strip()
            if not contact_name:
                raise ValidationError("联系人姓名不能为空")
            if not phone and not wechat:
                raise ValidationError("联系人电话或微信至少填写一项")
            source, source_detail = await self._validated_customer_entry_source(payload)
            payload["source"] = source
            payload["sourceDetail"] = source_detail

            now = format_legacy_time()
            new_lead_id = str(payload.get("id") or new_id("l"))
            cov_children = await self.repo.list_coverage_children([coverage.id])
            coverage_doc = _coverage_doc_with_children(
                _doc(coverage),
                cov_children.get(coverage.id) or {},
            )
            contacts = list(coverage_doc.get("contacts") or [])
            contact = {
                "id": new_id("ct"),
                "name": contact_name,
                "title": str(payload.get("contactTitle") or "").strip(),
                "department": str(payload.get("contactDepartment") or "").strip(),
                "phone": phone,
                "email": str(payload.get("email") or "").strip(),
                "wechat": wechat,
                "wechatAdded": bool(payload.get("wechatAdded")),
                "status": str(payload.get("contactStatus") or "awaiting_contact"),
                "isPrimary": not contacts,
                "active": True,
                "createdAt": now,
                "source": source,
                "sourceDetail": source_detail,
                "sourceLeadId": new_lead_id,
            }
            contacts.append(contact)
            coverage_doc["contacts"] = contacts

            customer_doc = _doc(customer)
            lead_doc = {
                **payload,
                "id": new_lead_id,
                "createdAt": str(payload.get("createdAt") or _china_today_iso()),
                "companyName": customer_doc.get("companyName") or customer.company_name,
                "brandName": customer_doc.get("brandName") or "",
                "website": customer_doc.get("website") or "",
                "region": customer_doc.get("region") or "",
                "city": customer_doc.get("city") or "",
                "contactName": contact_name,
                "contactPhone": phone,
                "contactWechat": wechat,
                "sales": user.name,
                "sdr": "",
                "status": "converted",
                "followState": "converted",
                "transferDate": _china_today_iso(),
                "convertedCustomerId": customer_id,
                "convertedCoverageId": coverage.id,
                "sourceCustomerId": customer_id,
                "notes": list(payload.get("notes") or []),
                "attachments": list(payload.get("attachments") or []),
                "markMaterials": list(payload.get("markMaterials") or []),
            }
            coverage = await self.repo.save_coverage(
                coverage, coverage_doc, status=str(coverage_doc.get("status") or coverage.status)
            )
            lead = await self.repo.create_lead(document=lead_doc, owner_user_id=user.id)
            await self._commit_and_invalidate_crm(user.id)
            return {
                "lead": _lead_response(
                    lead,
                    notes=list(lead_doc.get("notes") or []),
                    attachments=list(lead_doc.get("attachments") or []),
                    importMeta=lead_doc.get("importMeta"),
                ),
                "customer": await self._compose_customer_view_async(user, customer, [coverage]),
            }

    async def update_customer(self, user: AuthUser, customer_id: str, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "customers")
            payload = dict(document or {})
            self._assert_customer_write_codes(user, _customer_update_write_codes(payload))
            row = await self.repo.get_customer(customer_id)
            if not row:
                raise NotFoundError("客户不存在")
            await self._assert_customer_master_readable(user, row)
            prev = {
                **_doc(row),
                "subsidiaries": await self.repo.list_customer_subsidiaries(customer_id),
            }
            pool_fields = _extract_pool_fields(payload)
            master_in = {
                k: v
                for k, v in payload.items()
                if k not in CUSTOMER_POOL_FIELDS and k not in CUSTOMER_RESPONSE_META_FIELDS
            }

            # 主档更新：仅 leader/ops/admin
            master_changed = any(
                master_in.get(k) != prev.get(k)
                for k in master_in
                if k not in ("id",)
            )
            next_doc = _strip_customer_master_document({**prev, **master_in})
            # 保留迁移标记（客户端不可改）
            if prev.get("migrationStatus") and not next_doc.get("migrationStatus"):
                next_doc["migrationStatus"] = prev.get("migrationStatus")
            for key in ("sdrUserId", "createdByUserId", "sourceLeadId", "sdr", "sdrTransferDate"):
                if not next_doc.get(key) and prev.get(key):
                    next_doc[key] = prev.get(key)

            owner_name = str(payload.get("owner") or "").strip()
            next_owner_id = row.owner_user_id
            if owner_name:
                prev_owner_name = str(prev.get("owner") or "").strip()
                resolved = await UsersRepository(self.db).resolve_user_id_by_owner_name(owner_name)
                if resolved:
                    next_owner_id = resolved
                elif owner_name != prev_owner_name:
                    raise ValidationError(f"未找到负责人「{owner_name}」，请选择系统中的有效同事")

            # 销售仅允许改对接池字段；若只改了池字段则放行主档不动
            if master_changed and not self._can_edit_customer_master(user) and not pool_fields and not owner_name:
                raise PermissionDeniedError("无权修改公司主档，请联系 Leader 或运营")

            prev_owner = row.owner_user_id
            if next_owner_id and next_owner_id != prev_owner:
                await self._assert_assignable_owner(user, next_owner_id)

            if self._can_edit_customer_master(user) or not master_changed:
                denorm_status = str(pool_fields.get("status") or prev.get("status") or row.status)
                denorm_owner = owner_name or str(prev.get("owner") or "")
                save_doc = {
                    **next_doc,
                    "status": denorm_status,
                    "owner": denorm_owner,
                    # 子公司集合：payload 显式传入则用新值，否则保留 compose 后的 prev
                    "subsidiaries": (
                        payload["subsidiaries"]
                        if "subsidiaries" in payload and isinstance(payload.get("subsidiaries"), list)
                        else prev.get("subsidiaries") or []
                    ),
                }
                row = await self.repo.save_customer(row, save_doc, owner_user_id=next_owner_id)

            # 对接池写入：仅写「本人池」，且仅普通销售（own 范围）整包回传自己的单池数据。
            # Leader/ops 的视图是聚合超集（含下属池条目），整包回写会串入本人池——
            # 即使 Leader 有本人池，customer PATCH 也不再回写池；改池一律走 /coverages/:id 定向写。
            write_own_pool = user_data_scope(user) == "own"
            if write_own_pool and pool_fields:
                coverage = await self.repo.get_coverage_by_customer_owner(customer_id, user.id)
                if coverage is None and _pool_fields_have_operating_content(pool_fields):
                    # 首次维护客户：自动建立本人对接池（对用户透明，决策 12）
                    coverage, _ = await self._get_or_create_coverage(
                        customer_id=customer_id,
                        owner_user_id=user.id,
                        owner_name=(user.name or "").strip(),
                        seed={
                            "ownerName": (user.name or "").strip(),
                            "contacts": [],
                            "notes": [],
                            "attachments": [],
                        },
                        status=str(pool_fields.get("status") or "awaiting_contact"),
                        ensure_leaders=False,
                    )
                if coverage is not None:
                    await self._assert_coverage_access(user, coverage, write=True)
                    cov_children = await self.repo.list_coverage_children([coverage.id])
                    cov_doc = _coverage_doc_with_children(
                        _doc(coverage),
                        cov_children.get(coverage.id) or {},
                    )
                    for key, value in pool_fields.items():
                        if key == "owner":
                            cov_doc["ownerName"] = value
                        elif key in ("opportunityCount", "contractCount"):
                            continue
                        else:
                            cov_doc[key] = value
                    if owner_name and user_data_scope(user) == "own":
                        # 销售改本人池展示名；Leader 代改主档负责人不覆盖本人池归属名
                        cov_doc["ownerName"] = owner_name
                    coverage = await self.repo.save_coverage(
                        coverage,
                        cov_doc,
                        status=str(cov_doc.get("status") or coverage.status),
                    )
                # coverage 为 None：无池且仅空池行李，跳过池写入（主档已在上方保存）

            if next_owner_id and next_owner_id != prev_owner:
                prev_name = str(prev.get("owner") or "").strip()
                await self._write_customer_owner_audit(
                    user=user,
                    customer_id=customer_id,
                    company_name=str(payload.get("companyName") or prev.get("companyName") or ""),
                    before_owner=prev_name,
                    after_owner=owner_name or prev_name,
                )
            await self._commit_and_invalidate_crm(user.id, prev_owner, next_owner_id)
            owners = await self._owner_filter(user)
            coverages = await self.repo.list_coverages_for_customer(customer_id, owner_ids=owners)
            return await self._compose_customer_view_async(user, row, coverages)
