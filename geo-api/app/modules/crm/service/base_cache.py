from __future__ import annotations


class BaseCacheMixin:
    async def _invalidate_crm_read_caches(self, *user_ids: str | None) -> None:
                from app.modules.crm.crm_list_cache import invalidate_crm_caches_for_users

                await invalidate_crm_caches_for_users([uid for uid in user_ids if uid])

    async def _commit_and_invalidate_crm(self, *user_ids: str | None) -> None:
                """MySQL commit 成功后再失效 CRM 读缓存（Cache-Aside 铁律）。"""
                await self.db.commit()
                await self._invalidate_crm_read_caches(*user_ids)
