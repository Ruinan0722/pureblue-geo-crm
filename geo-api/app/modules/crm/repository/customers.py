from __future__ import annotations

from app.models.crm import CrmCustomerSubsidiary, CrmSalesCoverage
from app.modules.crm.repository.base import (
    EMPTY_CUSTOMER_STATS,
    PARTIAL_COMPANY_NAME_MIN_LEN,
    Any,
    CrmContract,
    CrmCustomer,
    CrmOpportunity,
    Select,
    Sequence,
    _coverage_contact_in_status,
    _customer_company_name_key_expr,
    _doc_date,
    _doc_decimal,
    _doc_str,
    _now,
    _split_filter_values,
    and_,
    company_name_partial_needles,
    delete,
    func,
    new_id,
    normalize_company_name_key,
    or_,
    select,
)


class CustomersRepositoryMixin:
    def _customer_filter_clauses(
            self,
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
            owner_ids: list[str] | None = None,
        ) -> list[Any]:
            clauses: list[Any] = [CrmCustomer.in_public_pool.is_(False)]
            company_kw = (company_name or "").strip()
            if company_kw:
                clauses.append(CrmCustomer.company_name.like(f"%{company_kw}%"))
            brand_kw = (brand_name or "").strip()
            if brand_kw:
                clauses.append(func.coalesce(CrmCustomer.brand_name, "").like(f"%{brand_kw}%"))
            owner_kw = (owner or "").strip()
            if owner_kw:
                # 主档 denorm 或可见对接池 ownerName
                cov_owner = select(CrmSalesCoverage.id).where(
                    CrmSalesCoverage.customer_id == CrmCustomer.id,
                    CrmSalesCoverage.owner_name.like(f"%{owner_kw}%"),
                )
                scope = self._coverage_owner_scope_clause(owner_ids)
                if scope is not None:
                    cov_owner = cov_owner.where(scope)
                clauses.append(
                    or_(
                        func.coalesce(CrmCustomer.owner, "").like(f"%{owner_kw}%"),
                        cov_owner.exists(),
                    )
                )
            if status and status != "all":
                # 按联系人状态过滤（联系人为基本单位；多池公司：任一可见池的联系人命中即入选）
                aliases = {
                    "awaiting_contact": ["awaiting_contact", "potential"],
                    "connected": ["connected", "following"],
                    "opportunity_following": ["opportunity_following"],
                    "cooperating": ["cooperating"],
                    "stopped": ["stopped", "lost"],
                    "potential": ["awaiting_contact", "potential"],
                    "following": ["connected", "following", "opportunity_following"],
                    "lost": ["stopped", "lost"],
                }
                statuses = aliases.get(status, [status])
                cov_status = select(CrmSalesCoverage.id).where(
                    CrmSalesCoverage.customer_id == CrmCustomer.id,
                    _coverage_contact_in_status(statuses),
                )
                scope = self._coverage_owner_scope_clause(owner_ids)
                if scope is not None:
                    cov_status = cov_status.where(scope)
                clauses.append(cov_status.exists())
            industries = _split_filter_values(industry)
            if len(industries) == 1:
                clauses.append(CrmCustomer.industry_l1 == industries[0])
            elif industries:
                clauses.append(CrmCustomer.industry_l1.in_(industries))
            details = _split_filter_values(industry_l2)
            if len(details) == 1:
                clauses.append(CrmCustomer.industry_l2 == details[0])
            elif details:
                clauses.append(CrmCustomer.industry_l2.in_(details))
            if region and region != "all":
                clauses.append(CrmCustomer.region == region)
            credit = (credit_code or "").strip().upper()
            if credit:
                # 统一社会信用代码精确匹配（忽略大小写）
                clauses.append(func.upper(CrmCustomer.credit_code) == credit)
            if key_only:
                # 重点客户在对接池 is_key 列
                cov_key = select(CrmSalesCoverage.id).where(
                    CrmSalesCoverage.customer_id == CrmCustomer.id,
                    CrmSalesCoverage.is_key.is_(True),
                )
                scope = self._coverage_owner_scope_clause(owner_ids)
                if scope is not None:
                    cov_key = cov_key.where(scope)
                clauses.append(cov_key.exists())
            for column, from_day, to_day in (
                (CrmSalesCoverage.last_follow_at, last_follow_from, last_follow_to),
                (CrmSalesCoverage.next_follow_at, next_follow_from, next_follow_to),
            ):
                day_parts: list[Any] = []
                from_trim = (from_day or "").strip()[:10]
                if from_trim:
                    day_parts.append(column >= from_trim)
                to_trim = (to_day or "").strip()[:10]
                if to_trim:
                    day_parts.append(column <= to_trim)
                if day_parts:
                    cov_date = select(CrmSalesCoverage.id).where(
                        CrmSalesCoverage.customer_id == CrmCustomer.id,
                        *day_parts,
                    )
                    scope = self._coverage_owner_scope_clause(owner_ids)
                    if scope is not None:
                        cov_date = cov_date.where(scope)
                    clauses.append(cov_date.exists())
            if relation in ("opp", "contract", "none"):
                has_opp = select(CrmOpportunity.id).where(
                    CrmOpportunity.customer_id == CrmCustomer.id,
                    CrmOpportunity.stage != "lost",
                )
                has_contract = select(CrmContract.id).where(
                    CrmContract.customer_id == CrmCustomer.id
                )
                if owner_ids is not None:
                    if owner_ids:
                        has_opp = has_opp.where(CrmOpportunity.owner_user_id.in_(owner_ids))
                        has_contract = has_contract.where(
                            CrmContract.owner_user_id.in_(owner_ids)
                        )
                    else:
                        # 无任何可见负责人：可见商机/合同数为 0
                        has_opp = has_opp.where(False)
                        has_contract = has_contract.where(False)
                if relation == "opp":
                    clauses.append(has_opp.exists())
                elif relation == "contract":
                    clauses.append(has_contract.exists())
                else:
                    clauses.append(and_(~has_opp.exists(), ~has_contract.exists()))
            return clauses

    async def find_customer_by_credit_code(self, credit_code: str) -> CrmCustomer | None:
            """全库按信用代码精确查找（用于创建/更新唯一性校验）。"""
            credit = (credit_code or "").strip().upper()
            if not credit:
                return None
            stmt = (
                select(CrmCustomer)
                .where(func.upper(CrmCustomer.credit_code) == credit)
                .limit(1)
            )
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()

    async def find_customers_by_credit_code(
            self,
            credit_code: str,
            owner_ids: list[str] | None,
        ) -> Sequence[CrmCustomer]:
            credit = (credit_code or "").strip().upper()
            if not credit:
                return []
            stmt: Select[Any] = (
                select(CrmCustomer)
                .where(func.upper(CrmCustomer.credit_code) == credit)
                .order_by(CrmCustomer.updated_at.desc())
            )
            visibility = self._customer_visibility_clause(owner_ids)
            if visibility is not None:
                if owner_ids is not None and not owner_ids:
                    return []
                stmt = stmt.where(visibility)
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def count_customers_by_company_name_key(self, company_name: str) -> int:
            """全库同名客户数（忽略 RBAC），用于「有同名但不可见」提示。"""
            key = normalize_company_name_key(company_name)
            if not key:
                return 0
            stmt = select(func.count()).select_from(CrmCustomer).where(_customer_company_name_key_expr() == key)
            result = await self.db.execute(stmt)
            return int(result.scalar_one() or 0)

    async def find_customers_by_company_name_key(
            self,
            company_name: str,
            owner_ids: list[str] | None,
        ) -> Sequence[CrmCustomer]:
            """按归一化公司名精确匹配，并套客户可见性。"""
            key = normalize_company_name_key(company_name)
            if not key:
                return []
            stmt: Select[Any] = (
                select(CrmCustomer)
                .where(_customer_company_name_key_expr() == key)
                .order_by(CrmCustomer.updated_at.desc())
            )
            visibility = self._customer_visibility_clause(owner_ids)
            if visibility is not None:
                if owner_ids is not None and not owner_ids:
                    return []
                stmt = stmt.where(visibility)
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def find_customers_by_company_name_partial(
            self,
            company_name: str,
            owner_ids: list[str] | None,
            *,
            limit: int = 20,
        ) -> Sequence[CrmCustomer]:
            """按核心针 / 双向包含召回可能相关客户（不含精确相等），再由 service 用 match_kind 精筛。"""
            key = normalize_company_name_key(company_name)
            needles = company_name_partial_needles(company_name)
            if not needles:
                return []
            name_key = _customer_company_name_key_expr()
            like_clauses: list[Any] = []
            for needle in needles:
                esc = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                like_clauses.append(name_key.like(f"%{esc}%", escape="\\"))
            # customer 全名是 lead 全名的子串
            like_clauses.append(func.locate(name_key, key) > 0)

            stmt: Select[Any] = (
                select(CrmCustomer)
                .where(
                    func.char_length(name_key) >= PARTIAL_COMPANY_NAME_MIN_LEN,
                    name_key != key,
                    or_(*like_clauses),
                )
                .order_by(CrmCustomer.updated_at.desc())
                .limit(max(1, min(limit, 50)))
            )
            visibility = self._customer_visibility_clause(owner_ids)
            if visibility is not None:
                if owner_ids is not None and not owner_ids:
                    return []
                stmt = stmt.where(visibility)
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def list_customers(self, owner_ids: list[str] | None) -> Sequence[CrmCustomer]:
            """own/department：按负责人范围过滤；SDR 无客户经营入口。"""
            stmt: Select[Any] = select(CrmCustomer).where(
                CrmCustomer.in_public_pool.is_(False)
            ).order_by(CrmCustomer.updated_at.desc())
            visibility = self._customer_visibility_clause(owner_ids)
            if visibility is not None:
                if owner_ids is not None and not owner_ids:
                    return []
                stmt = stmt.where(visibility)
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def search_customers(
            self,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
            include_all_masters: bool = False,
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
            page: int = 1,
            page_size: int = 10,
        ) -> tuple[Sequence[CrmCustomer], int]:
            if (
                owner_ids is not None
                and not owner_ids
                and not include_unassigned
                and not include_all_masters
            ):
                return [], 0

            page = max(1, int(page or 1))
            page_size = min(100, max(1, int(page_size or 10)))
            offset = (page - 1) * page_size

            filters = self._customer_filter_clauses(
                company_name=company_name,
                brand_name=brand_name,
                owner=owner,
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
                owner_ids=owner_ids,
            )
            # 决策 12：默认「客户列表」展示全部公司主档；池内容仍按 owner_ids 隔离。
            # 仅「只看自己 / coverageScope=self」保留按可见对接池过滤。
            visibility = None
            if not include_all_masters:
                visibility = self._customer_visibility_clause(
                    owner_ids, include_unassigned=include_unassigned
                )
            where_parts = ([visibility] if visibility is not None else []) + filters

            count_stmt = select(func.count()).select_from(CrmCustomer)
            list_stmt: Select[Any] = select(CrmCustomer).order_by(CrmCustomer.updated_at.desc())
            if where_parts:
                count_stmt = count_stmt.where(and_(*where_parts))
                list_stmt = list_stmt.where(and_(*where_parts))
            list_stmt = list_stmt.offset(offset).limit(page_size)

            total = int((await self.db.execute(count_stmt)).scalar_one() or 0)
            rows = (await self.db.execute(list_stmt)).scalars().all()
            return rows, total

    async def aggregate_customer_stats(
            self,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
            count_all_masters: bool = False,
        ) -> dict[str, int]:
            if owner_ids is not None and not owner_ids and not include_unassigned:
                return dict(EMPTY_CUSTOMER_STATS)

            # 客户总数：默认统计全部公司主档（决策 12 客户可见）；
            # 「只看自己 / coverageScope=self」仍按可见对接池去重客户。
            if count_all_masters:
                total = int(
                    (
                        await self.db.execute(
                            select(func.count()).select_from(CrmCustomer).where(
                                CrmCustomer.in_public_pool.is_(False)
                            )
                        )
                    ).scalar_one()
                    or 0
                )
            else:
                total_cov = select(CrmSalesCoverage.customer_id).where(
                    CrmSalesCoverage.customer_id.in_(
                        select(CrmCustomer.id).where(CrmCustomer.in_public_pool.is_(False))
                    )
                ).distinct()
                if owner_ids is not None:
                    total_cov = total_cov.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
                total = int(
                    (
                        await self.db.execute(
                            select(func.count()).select_from(total_cov.subquery())
                        )
                    ).scalar_one()
                    or 0
                )

            def _status_count(statuses: list[str]) -> Any:
                # 联系人状态聚合（联系人为基本单位；旧联系人缺 status 按待建联计）
                cov = select(CrmSalesCoverage.customer_id).where(
                    _coverage_contact_in_status(statuses),
                    CrmSalesCoverage.customer_id.in_(
                        select(CrmCustomer.id).where(CrmCustomer.in_public_pool.is_(False))
                    ),
                )
                if owner_ids is not None:
                    cov = cov.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
                return select(func.count()).select_from(
                    cov.distinct().subquery()
                )

            key_cov = select(CrmSalesCoverage.customer_id).where(
                CrmSalesCoverage.is_key.is_(True),
                CrmSalesCoverage.customer_id.in_(
                    select(CrmCustomer.id).where(CrmCustomer.in_public_pool.is_(False))
                ),
            )
            if owner_ids is not None:
                key_cov = key_cov.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
            key_count = int(
                (
                    await self.db.execute(
                        select(func.count()).select_from(key_cov.distinct().subquery())
                    )
                ).scalar_one()
                or 0
            )

            awaiting = int((await self.db.execute(_status_count(["awaiting_contact", "potential"]))).scalar_one() or 0)
            connected = int((await self.db.execute(_status_count(["connected", "following"]))).scalar_one() or 0)
            opportunity_following = int(
                (await self.db.execute(_status_count(["opportunity_following"]))).scalar_one() or 0
            )
            stopped = int((await self.db.execute(_status_count(["stopped", "lost"]))).scalar_one() or 0)
            cooperating = int((await self.db.execute(_status_count(["cooperating"]))).scalar_one() or 0)

            return {
                "total": total,
                "cooperating": cooperating,
                "awaiting_contact": awaiting,
                "connected": connected,
                "opportunity_following": opportunity_following,
                "stopped": stopped,
                "following": connected + opportunity_following,
                "potential": awaiting,
                "lost": stopped,
                "key": key_count,
            }

    async def get_customer(self, customer_id: str) -> CrmCustomer | None:
            return await self.db.get(CrmCustomer, customer_id)

    async def create_customer(
            self,
            *,
            document: dict[str, Any],
            owner_user_id: str | None,
        ) -> CrmCustomer:
            customer_id = str(document.get("id") or new_id("c"))
            document = {**document, "id": customer_id}
            now = _now()
            row = CrmCustomer(
                id=customer_id,
                owner_user_id=owner_user_id,
                status=str(document.get("status") or "awaiting_contact"),
                company_name=str(document.get("companyName") or ""),
                company_uid=_doc_str(document, "companyUid"),
                credit_code=_doc_str(document, "creditCode"),
                region=_doc_str(document, "region"),
                brand_name=_doc_str(document, "brandName"),
                website=_doc_str(document, "website"),
                city=_doc_str(document, "city"),
                industry_l2=_doc_str(document, "industryL2"),
                founded_date=_doc_date(document, "foundedDate"),
                registered_capital=_doc_decimal(document, "registeredCapital"),
                annual_revenue=_doc_decimal(document, "annualRevenue"),
                scale=_doc_str(document, "scale"),
                nature=_doc_str(document, "nature"),
                sdr_user_id=_doc_str(document, "sdrUserId"),
                sdr_transfer_date=_doc_date(document, "sdrTransferDate"),
                source=_doc_str(document, "source"),
                source_detail=_doc_str(document, "sourceDetail"),
                migration_status=_doc_str(document, "migrationStatus"),
                source_lead_id=_doc_str(document, "sourceLeadId"),
                sdr=_doc_str(document, "sdr"),
                isolation_version=(
                    None
                    if document.get("isolationVersion") is None
                    else int(document.get("isolationVersion"))
                ),
                in_public_pool=False,
                created_day=_doc_date(document, "createdAt"),
                owner=_doc_str(document, "owner"),
                industry_l1=_doc_str(document, "industryL1"),
                created_by_user_id=_doc_str(document, "createdByUserId"),
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
            await self.db.flush()
            await self._sync_customer_subsidiaries(row, document)
            return row

    async def save_customer(
            self,
            row: CrmCustomer,
            document: dict[str, Any],
            *,
            owner_user_id: str | None = None,
        ) -> CrmCustomer:
            document = {**document, "id": row.id}
            row.status = str(document.get("status") or row.status)
            row.company_name = str(document.get("companyName") or row.company_name)
            row.company_uid = _doc_str(document, "companyUid")
            row.credit_code = _doc_str(document, "creditCode")
            row.region = _doc_str(document, "region")
            row.brand_name = _doc_str(document, "brandName")
            row.website = _doc_str(document, "website")
            row.city = _doc_str(document, "city")
            row.industry_l2 = _doc_str(document, "industryL2")
            row.founded_date = _doc_date(document, "foundedDate")
            row.registered_capital = _doc_decimal(document, "registeredCapital")
            row.annual_revenue = _doc_decimal(document, "annualRevenue")
            row.scale = _doc_str(document, "scale")
            row.nature = _doc_str(document, "nature")
            row.sdr_user_id = _doc_str(document, "sdrUserId")
            row.sdr_transfer_date = _doc_date(document, "sdrTransferDate")
            row.source = _doc_str(document, "source")
            row.source_detail = _doc_str(document, "sourceDetail")
            row.migration_status = _doc_str(document, "migrationStatus")
            row.source_lead_id = _doc_str(document, "sourceLeadId")
            row.sdr = _doc_str(document, "sdr")
            if document.get("isolationVersion") is not None:
                row.isolation_version = int(document.get("isolationVersion"))
            row.created_day = _doc_date(document, "createdAt")
            row.owner = _doc_str(document, "owner")
            row.industry_l1 = _doc_str(document, "industryL1")
            row.created_by_user_id = _doc_str(document, "createdByUserId")
            if owner_user_id is not None:
                row.owner_user_id = owner_user_id
            row.updated_at = _now()
            await self.db.flush()
            await self._sync_customer_subsidiaries(row, document)
            return row

    async def list_customer_subsidiaries(self, customer_id: str) -> list[dict[str, Any]]:
            """读取客户子公司列表（公司架构）。"""
            rows = (
                await self.db.execute(
                    select(CrmCustomerSubsidiary)
                    .where(CrmCustomerSubsidiary.customer_id == customer_id)
                    .order_by(CrmCustomerSubsidiary.sort_order, CrmCustomerSubsidiary.id)
                )
            ).scalars().all()
            out: list[dict[str, Any]] = []
            for item in rows:
                out.append(
                    {
                        "id": item.id,
                        "name": item.name or "",
                        "shortName": item.short_name or "",
                        "creditCode": item.credit_code or "",
                        "city": item.city or "",
                    }
                )
            return out

    async def _sync_customer_subsidiaries(
            self,
            customer: CrmCustomer,
            document: dict[str, Any] | None = None,
        ) -> None:
            """写穿 document.subsidiaries → crm_customer_subsidiaries（全量）。

            调用方必须在 compose+merge 后传入 subsidiaries 列表；缺键直接失败。
            """
            from app.core.exceptions import ValidationError

            if not isinstance(document, dict):
                raise ValidationError("客户保存缺少 document")
            if "subsidiaries" not in document or not isinstance(document.get("subsidiaries"), list):
                raise ValidationError("客户保存缺少 subsidiaries 集合，须先 compose+merge")
            items = document.get("subsidiaries") or []
            await self.db.execute(
                delete(CrmCustomerSubsidiary).where(CrmCustomerSubsidiary.customer_id == customer.id)
            )
            now = _now()
            seen: set[str] = set()
            for index, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                raw_id = str(item.get("id") or "").strip()
                sub_id = raw_id if raw_id and raw_id not in seen else new_id("sub")
                if sub_id in seen:
                    sub_id = new_id("sub")
                seen.add(sub_id)
                self.db.add(
                    CrmCustomerSubsidiary(
                        id=sub_id,
                        customer_id=customer.id,
                        name=name,
                        short_name=_doc_str(item, "shortName"),
                        credit_code=_doc_str(item, "creditCode"),
                        city=_doc_str(item, "city"),
                        sort_order=index,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await self.db.flush()
