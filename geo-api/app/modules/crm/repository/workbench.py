from __future__ import annotations

from app.models.crm import CrmLead, CrmSalesCoverage
from app.modules.crm.repository.base import (
    Any,
    CrmContract,
    CrmOpportunity,
    and_,
    case,
    func,
    select,
)


class WorkbenchRepositoryMixin:
    async def aggregate_lead_workbench(
            self,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
            sdr_pool_names: list[str] | None = None,
        ) -> dict[str, Any]:
            """工作台线索指标：SQL 聚合，避免全量拉 document。"""
            if owner_ids is not None and not owner_ids and not include_unassigned:
                return {
                    "leads_total": 0,
                    "leads_need": 0,
                    "leads_untouched": 0,
                    "leads_to_transfer": 0,
                    "leads_converted": 0,
                    "leads_invalid": 0,
                    "lead_rate": 0,
                }

            follow_state = CrmLead.follow_state
            level = func.coalesce(CrmLead.level, "")
            stmt = select(
                func.count().label("total"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    CrmLead.status.notin_(["converted", "invalid"]),
                                    follow_state == "need",
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("need"),
                func.coalesce(func.sum(case((CrmLead.status == "untouched", 1), else_=0)), 0).label("untouched"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(CrmLead.status == "touched", level != "D"),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("to_transfer"),
                func.coalesce(func.sum(case((CrmLead.status == "converted", 1), else_=0)), 0).label("converted"),
                func.coalesce(func.sum(case((CrmLead.status == "invalid", 1), else_=0)), 0).label("invalid"),
            )
            owner_clause = self._lead_owner_clause(
                owner_ids, include_unassigned=include_unassigned
            )
            owner_clause = self._lead_pool_clause(owner_clause, sdr_pool_names)
            if owner_clause is not None:
                stmt = stmt.where(owner_clause)

            row = (await self.db.execute(stmt)).one()
            total = int(row.total or 0)
            converted = int(row.converted or 0)
            return {
                "leads_total": total,
                "leads_need": int(row.need or 0),
                "leads_untouched": int(row.untouched or 0),
                "leads_to_transfer": int(row.to_transfer or 0),
                "leads_converted": converted,
                "leads_invalid": int(row.invalid or 0),
                "lead_rate": round((converted / total) * 100) if total else 0,
            }

    async def aggregate_customer_workbench(
            self,
            owner_ids: list[str] | None,
            *,
            today: str,
        ) -> dict[str, Any]:
            """工作台客户指标：今日待跟进 / 超14天未跟进 / 合作中。

            023 迁移后经营字段（nextFollowAt/lastFollowAt/status）只存在于对接池
            （crm_sales_coverages），主档已清空——此处按 coverage 聚合（设计 §4.6）：
            total = 可见池的去重客户数；active/stale/cooperating = 任一可见池命中。
            """
            if owner_ids is not None and not owner_ids:
                return {
                    "customers_total": 0,
                    "customers_active": 0,
                    "customers_stale": 0,
                    "customers_cooperating": 0,
                }

            day = (today or "").strip()[:10]
            next_follow = func.left(CrmSalesCoverage.next_follow_at, 10)
            last_follow = func.left(CrmSalesCoverage.last_follow_at, 10)
            not_lost = CrmSalesCoverage.status.notin_(["stopped", "lost"])
            # 任一池命中即算该客户命中（max）；按客户去重（group_by customer_id）
            sub_query = select(
                CrmSalesCoverage.customer_id.label("customer_id"),
                func.max(
                    case(
                        (
                            and_(
                                not_lost,
                                next_follow.isnot(None),
                                next_follow <= day,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("active"),
                func.max(
                    case(
                        (
                            and_(
                                not_lost,
                                last_follow.isnot(None),
                                func.datediff(day, last_follow) > 14,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("stale"),
                func.max(
                    case((CrmSalesCoverage.status == "cooperating", 1), else_=0)
                ).label("cooperating"),
            ).group_by(CrmSalesCoverage.customer_id)
            if owner_ids is not None:
                sub_query = sub_query.where(CrmSalesCoverage.owner_user_id.in_(owner_ids))
            sub = sub_query.subquery()

            stmt = select(
                func.count().label("total"),
                func.coalesce(func.sum(sub.c.active), 0).label("active"),
                func.coalesce(func.sum(sub.c.stale), 0).label("stale"),
                func.coalesce(func.sum(sub.c.cooperating), 0).label("cooperating"),
            ).select_from(sub)

            row = (await self.db.execute(stmt)).one()
            return {
                "customers_total": int(row.total or 0),
                "customers_active": int(row.active or 0),
                "customers_stale": int(row.stale or 0),
                "customers_cooperating": int(row.cooperating or 0),
            }

    async def aggregate_opportunity_workbench(
            self,
            owner_ids: list[str] | None,
            *,
            today: str,
        ) -> dict[str, Any]:
            """工作台商机指标：SQL 聚合。"""
            if owner_ids is not None and not owner_ids:
                return {
                    "opps_total": 0,
                    "opps_active": 0,
                    "opps_follow_due": 0,
                    "opps_stale": 0,
                    "opps_lost_no_reason": 0,
                    "opps_signing": 0,
                    "opps_won": 0,
                    "opps_lost": 0,
                    "month_expected": 0.0,
                    "won_amount": 0.0,
                }

            day = (today or "").strip()[:10]
            last_follow = func.left(CrmOpportunity.last_follow_at, 10)
            next_follow = func.left(CrmOpportunity.next_follow_at, 10)
            lost_reason = CrmOpportunity.lost_reason
            amount = CrmOpportunity.amount
            active_stage = CrmOpportunity.stage.notin_(["won", "lost"])
            stmt = select(
                func.count().label("total"),
                func.coalesce(func.sum(case((active_stage, 1), else_=0)), 0).label("active"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    active_stage,
                                    next_follow.isnot(None),
                                    next_follow <= day,
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("follow_due"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    active_stage,
                                    last_follow.isnot(None),
                                    func.datediff(day, last_follow) > 7,
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("stale"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    CrmOpportunity.stage == "lost",
                                    lost_reason.is_(None),
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("lost_no_reason"),
                func.coalesce(func.sum(case((CrmOpportunity.stage == "signing", 1), else_=0)), 0).label("signing"),
                func.coalesce(func.sum(case((CrmOpportunity.stage == "won", 1), else_=0)), 0).label("won"),
                func.coalesce(func.sum(case((CrmOpportunity.stage == "lost", 1), else_=0)), 0).label("lost"),
                func.coalesce(
                    func.sum(case((CrmOpportunity.stage == "signing", amount), else_=0)),
                    0,
                ).label("month_expected"),
                func.coalesce(
                    func.sum(case((CrmOpportunity.stage == "won", amount), else_=0)),
                    0,
                ).label("won_amount"),
            )
            if owner_ids is not None:
                stmt = stmt.where(CrmOpportunity.owner_user_id.in_(owner_ids))

            row = (await self.db.execute(stmt)).one()
            return {
                "opps_total": int(row.total or 0),
                "opps_active": int(row.active or 0),
                "opps_follow_due": int(row.follow_due or 0),
                "opps_stale": int(row.stale or 0),
                "opps_lost_no_reason": int(row.lost_no_reason or 0),
                "opps_signing": int(row.signing or 0),
                "opps_won": int(row.won or 0),
                "opps_lost": int(row.lost or 0),
                "month_expected": float(row.month_expected or 0),
                "won_amount": float(row.won_amount or 0),
            }

    async def aggregate_contract_workbench(self, owner_ids: list[str] | None) -> dict[str, Any]:
            """工作台合同指标：SQL 聚合。"""
            if owner_ids is not None and not owner_ids:
                return {
                    "signing_contracts": 0,
                    "signed_contracts": 0,
                    "contracts_total": 0,
                    "contracts_pending": 0,
                    "contract_amount": 0.0,
                }

            amount = CrmContract.amount
            doc_status = CrmContract.status
            stmt = select(
                func.count().label("total"),
                func.coalesce(
                    func.sum(case((doc_status.in_(["signing", "pending"]), 1), else_=0)),
                    0,
                ).label("signing"),
                func.coalesce(func.sum(case((doc_status == "signed", 1), else_=0)), 0).label("signed"),
                func.coalesce(func.sum(case((doc_status == "pending", 1), else_=0)), 0).label("pending"),
                func.coalesce(
                    func.sum(case((doc_status == "signed", amount), else_=0)),
                    0,
                ).label("contract_amount"),
            )
            if owner_ids is not None:
                stmt = stmt.where(CrmContract.owner_user_id.in_(owner_ids))

            row = (await self.db.execute(stmt)).one()
            return {
                "signing_contracts": int(row.signing or 0),
                "signed_contracts": int(row.signed or 0),
                "contracts_total": int(row.total or 0),
                "contracts_pending": int(row.pending or 0),
                "contract_amount": float(row.contract_amount or 0),
            }
