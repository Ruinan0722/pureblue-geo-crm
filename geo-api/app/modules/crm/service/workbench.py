from __future__ import annotations

from app.modules.crm.service.base import (
    EMPTY_CUSTOMER_STATS,
    EMPTY_LEAD_STATS,
    EMPTY_WORKBENCH_STATS,
    Any,
    AuthUser,
    PermissionDeniedError,
    _aggregate_contract_workbench,
    _aggregate_opportunity_workbench,
    _china_today_iso,
    forced_geo_source,
    user_has_permission,
)


class WorkbenchMixin:
    async def bootstrap(self, user: AuthUser) -> dict[str, Any]:
            from app.modules.crm.crm_list_cache import cached_crm_read

            async def _load() -> dict[str, Any]:
                return await self._bootstrap_uncached(user)

            return await cached_crm_read("boot", user, _load)

    async def _bootstrap_uncached(self, user: AuthUser) -> dict[str, Any]:
            # 仅统计；线索/客户分页按需；商机/合同由前端进入对应板块再拉
            owners = await self._owner_filter(user)
            lead_owners = (
                await self._owner_filter(user, lead_pool=True)
                if user_has_permission(user, "section:leads")
                else owners
            )
            inc = self._include_unassigned(user)
            lead_inc = (
                self._include_unassigned(user, lead_pool=True)
                if user_has_permission(user, "section:leads")
                else inc
            )
            lead_sdr_names = (
                await self._sdr_pool_names(user)
                if user_has_permission(user, "section:leads")
                else []
            )
            lead_stats: dict[str, int] = dict(EMPTY_LEAD_STATS)
            customer_stats: dict[str, int] = dict(EMPTY_CUSTOMER_STATS)

            if user_has_permission(user, "section:leads"):
                lead_stats = await self.repo.aggregate_lead_stats(
                    lead_owners,
                    today=_china_today_iso(),
                    include_unassigned=lead_inc,
                    sdr_pool_names=lead_sdr_names,
                )
            if user_has_permission(user, "section:customers"):
                customer_stats = await self.repo.aggregate_customer_stats(
                    owners, include_unassigned=inc, count_all_masters=True
                )

            return {
                "leads": [],
                "customers": [],
                "opportunities": [],
                "contracts": [],
                "lead_stats": lead_stats,
                "customer_stats": customer_stats,
            }

    async def get_workbench(self, user: AuthUser) -> dict[str, Any]:
            """首页工作台指标：按权限加载可见数据后在服务端聚合，前端只展示。"""
            if not user_has_permission(user, "section:home"):
                raise PermissionDeniedError()

            from app.modules.crm.crm_list_cache import cached_crm_read

            async def _load() -> dict[str, Any]:
                return await self._get_workbench_uncached(user)

            return await cached_crm_read("wb", user, _load)

    async def _get_workbench_uncached(self, user: AuthUser) -> dict[str, Any]:
            owners = await self._owner_filter(user)
            lead_owners = (
                await self._owner_filter(user, lead_pool=True)
                if user_has_permission(user, "section:leads")
                else owners
            )
            inc = self._include_unassigned(user)
            lead_inc = (
                self._include_unassigned(user, lead_pool=True)
                if user_has_permission(user, "section:leads")
                else inc
            )
            lead_sdr_names = (
                await self._sdr_pool_names(user)
                if user_has_permission(user, "section:leads")
                else []
            )
            stats = dict(EMPTY_WORKBENCH_STATS)

            if user_has_permission(user, "section:leads"):
                stats.update(
                    await self.repo.aggregate_lead_workbench(
                        lead_owners,
                        include_unassigned=lead_inc,
                        sdr_pool_names=lead_sdr_names,
                    )
                )

            if user_has_permission(user, "section:customers"):
                stats.update(
                    await self.repo.aggregate_customer_workbench(
                        owners,
                        today=_china_today_iso(),
                    )
                )

            if user_has_permission(user, "section:opportunities"):
                forced = forced_geo_source(user)
                if forced:
                    opps = await self.list_opportunities(user)
                    stats.update(
                        _aggregate_opportunity_workbench(opps, today=_china_today_iso())
                    )
                else:
                    stats.update(
                        await self.repo.aggregate_opportunity_workbench(
                            owners,
                            today=_china_today_iso(),
                        )
                    )

            if user_has_permission(user, "section:contracts"):
                forced = forced_geo_source(user)
                if forced:
                    contracts = await self.list_contracts(user)
                    stats.update(_aggregate_contract_workbench(contracts))
                else:
                    stats.update(await self.repo.aggregate_contract_workbench(owners))

            if user_has_permission(user, "request:view"):
                try:
                    from app.modules.requests.service import RequestService

                    req_stats = await RequestService(self.db).get_stats(user)
                    stats.update(
                        {
                            "req_pending": int(req_stats.get("submitted") or 0)
                            + int(req_stats.get("pending") or 0),
                            "req_supplement": int(req_stats.get("supplement") or 0),
                            "req_confirmed": int(req_stats.get("confirmed") or 0)
                            + int(req_stats.get("in_project") or 0),
                        }
                    )
                except PermissionDeniedError:
                    pass

            if user_has_permission(user, "section:projects"):
                try:
                    from app.modules.projects.service import ProjectsService

                    proj_stats = await ProjectsService(self.db).stats(user, view="active")
                    stats.update(
                        {
                            "projects_total": proj_stats.active
                            + proj_stats.delayed
                            + proj_stats.completed,
                            "projects_active": proj_stats.active,
                            "projects_delayed": proj_stats.delayed,
                            "projects_renewal_warning": proj_stats.renewal_warning,
                            "projects_unhealthy": proj_stats.unhealthy,
                            "projects_completed": proj_stats.completed,
                        }
                    )
                except PermissionDeniedError:
                    pass

            return stats
