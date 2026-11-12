from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence

from sqlalchemy import and_, exists, func, or_, select

from app.models.crm import (
    CrmContact,
    CrmCustomer,
    CrmOpportunity,
    CrmPublicPoolClaim,
    CrmPublicPoolEntry,
    CrmSalesCoverage,
)


ACTIVE_POOL_STATUSES = ("available", "pending_review")


class PublicPoolRepositoryMixin:
    async def get_public_pool_entry(
        self, entry_id: str, *, for_update: bool = False
    ) -> CrmPublicPoolEntry | None:
        stmt = select(CrmPublicPoolEntry).where(CrmPublicPoolEntry.id == entry_id)
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_active_public_pool_entry_by_coverage(
        self, coverage_id: str
    ) -> CrmPublicPoolEntry | None:
        return (
            await self.db.execute(
                select(CrmPublicPoolEntry)
                .where(
                    CrmPublicPoolEntry.coverage_id == coverage_id,
                    CrmPublicPoolEntry.status.in_(ACTIVE_POOL_STATUSES),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    async def list_public_pool_rows(
        self,
        *,
        allowed_regions: list[str] | None,
        company_name: str | None = None,
        industry: str | None = None,
        region: str | None = None,
        source: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[Sequence[tuple[CrmPublicPoolEntry, CrmCustomer]], int]:
        if allowed_regions == []:
            return [], 0
        clauses: list[Any] = []
        if allowed_regions is not None:
            clauses.append(CrmPublicPoolEntry.region.in_(allowed_regions))
        status_key = (status or "active").strip()
        if status_key == "active":
            clauses.append(CrmPublicPoolEntry.status.in_(ACTIVE_POOL_STATUSES))
        elif status_key != "all":
            clauses.append(CrmPublicPoolEntry.status == status_key)
        company_kw = (company_name or "").strip()
        if company_kw:
            clauses.append(CrmCustomer.company_name.like(f"%{company_kw}%"))
        industry_kw = (industry or "").strip()
        if industry_kw:
            clauses.append(
                or_(
                    CrmCustomer.industry_l1 == industry_kw,
                    CrmCustomer.industry_l2 == industry_kw,
                )
            )
        region_key = (region or "").strip()
        if region_key and region_key != "all":
            clauses.append(CrmPublicPoolEntry.region == region_key)
        source_key = (source or "").strip()
        if source_key and source_key != "all":
            clauses.append(CrmCustomer.source == source_key)

        base = (
            select(CrmPublicPoolEntry, CrmCustomer)
            .join(CrmCustomer, CrmCustomer.id == CrmPublicPoolEntry.customer_id)
            .where(and_(*clauses) if clauses else True)
        )
        total = int(
            (
                await self.db.execute(
                    select(func.count()).select_from(base.subquery())
                )
            ).scalar_one()
            or 0
        )
        offset = (max(1, page) - 1) * max(1, page_size)
        rows = (
            await self.db.execute(
                base.order_by(CrmPublicPoolEntry.released_at.desc())
                .offset(offset)
                .limit(max(1, min(page_size, 100)))
            )
        ).all()
        return rows, total

    async def list_public_pool_claims(
        self, entry_ids: list[str]
    ) -> Sequence[CrmPublicPoolClaim]:
        if not entry_ids:
            return []
        return (
            await self.db.execute(
                select(CrmPublicPoolClaim)
                .where(CrmPublicPoolClaim.entry_id.in_(entry_ids))
                .order_by(CrmPublicPoolClaim.applied_at.desc())
            )
        ).scalars().all()

    async def get_public_pool_claim(
        self, claim_id: str, *, for_update: bool = False
    ) -> CrmPublicPoolClaim | None:
        stmt = select(CrmPublicPoolClaim).where(CrmPublicPoolClaim.id == claim_id)
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def public_pool_stats(
        self, *, allowed_regions: list[str] | None, month_start: datetime
    ) -> dict[str, int]:
        if allowed_regions == []:
            return {"total": 0, "pending_review": 0, "claimed_this_month": 0}
        region_clause = (
            CrmPublicPoolEntry.region.in_(allowed_regions)
            if allowed_regions is not None
            else True
        )

        async def count(*clauses: Any) -> int:
            return int(
                (
                    await self.db.execute(
                        select(func.count())
                        .select_from(CrmPublicPoolEntry)
                        .where(region_clause, *clauses)
                    )
                ).scalar_one()
                or 0
            )

        return {
            "total": await count(CrmPublicPoolEntry.status.in_(ACTIVE_POOL_STATUSES)),
            "pending_review": await count(CrmPublicPoolEntry.status == "pending_review"),
            "claimed_this_month": await count(
                CrmPublicPoolEntry.status == "claimed",
                CrmPublicPoolEntry.claimed_at >= month_start,
            ),
        }

    async def count_maintained_customers(self, owner_user_id: str) -> int:
        has_opportunity = exists(
            select(CrmOpportunity.id).where(
                CrmOpportunity.customer_id == CrmSalesCoverage.customer_id
            )
        )
        has_cooperating_contact = exists(
            select(CrmContact.id).where(
                CrmContact.coverage_id == CrmSalesCoverage.id,
                CrmContact.active.is_(True),
                CrmContact.status == "cooperating",
            )
        )
        stmt = select(func.count(func.distinct(CrmSalesCoverage.customer_id))).where(
            CrmSalesCoverage.owner_user_id == owner_user_id,
            CrmSalesCoverage.status != "cooperating",
            ~has_opportunity,
            ~has_cooperating_contact,
        )
        return int((await self.db.execute(stmt)).scalar_one() or 0)

    async def coverage_has_active_opportunity(
        self, *, customer_id: str, owner_user_id: str
    ) -> bool:
        stmt = select(CrmOpportunity.id).where(
            CrmOpportunity.customer_id == customer_id,
            CrmOpportunity.owner_user_id == owner_user_id,
        ).limit(1)
        return (await self.db.execute(stmt)).first() is not None

    async def coverage_is_cooperating(self, coverage: CrmSalesCoverage) -> bool:
        if coverage.status == "cooperating":
            return True
        stmt = select(CrmContact.id).where(
            CrmContact.coverage_id == coverage.id,
            CrmContact.active.is_(True),
            CrmContact.status == "cooperating",
        ).limit(1)
        return (await self.db.execute(stmt)).first() is not None
