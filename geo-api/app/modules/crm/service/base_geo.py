from __future__ import annotations

from typing import Any

from app.core.exceptions import (
    PermissionDeniedError,
)
from app.core.geo_scope import (
    forced_geo_source,
    matches_forced_geo,
    normalize_geo_source,
    prefer_linked_geo,
    resolve_document_geo_source,
)
from app.modules.auth.schemas import AuthUser

from .helpers_opportunities import (
    _opportunity_response,
)

_EMPTY_OPP_CHILDREN: dict[str, Any] = {
    "stageHistory": None,
    "attachments": None,
    "projectTypes": None,
    "requestIds": None,
    "notes": None,
    "advisorNotes": None,
}


class BaseGeoMixin:
    def _assert_geo_access(self, user: AuthUser, entity_geo: str | None) -> None:
                forced = forced_geo_source(user)
                if forced and not matches_forced_geo(forced, entity_geo):
                    raise PermissionDeniedError("无权查看非海外归属的数据")

    async def _opportunity_doc_for_geo(self, row: Any) -> dict[str, Any]:
                """geo 旁路专用：使用完整商机文档中的持久化归属。"""
                children = await self.repo.get_opportunity_children(row.id)
                return _opportunity_response(row, **children)


    async def _resolve_opportunity_geo(self, doc: dict[str, Any]) -> str:
                """商机使用自身已保存的 GEO 归属，不再读取需求关系。"""
                return prefer_linked_geo(linked=None, stamped=resolve_document_geo_source(doc))

    async def _stamp_opportunity_geo(self, document: dict[str, Any], user: AuthUser | None = None) -> dict[str, Any]:
                doc = dict(document or {})
                doc["geoSource"] = normalize_geo_source(doc.get("geoSource")) or "manual"
                forced = forced_geo_source(user) if user is not None else None
                if forced:
                    if doc["geoSource"] == "manual": doc["geoSource"] = forced
                    if doc["geoSource"] != forced:
                        raise PermissionDeniedError("海外运营仅可操作海外归属的商机")
                return doc

    async def _resolve_contract_geo(self, doc: dict[str, Any]) -> str:
                """合同归属：关联商机优先；无商机才用 stamp。"""
                oid = str(doc.get("opportunityId") or "").strip()
                if oid:
                    opp = await self.repo.get_opportunity(oid)
                    if opp:
                        return await self._resolve_opportunity_geo(
                            await self._opportunity_doc_for_geo(opp)
                        )
                return prefer_linked_geo(linked=None, stamped=resolve_document_geo_source(doc))

    async def _stamp_contract_geo(
                self, document: dict[str, Any], user: AuthUser | None = None
            ) -> dict[str, Any]:
                """归属优先取关联商机；禁止客户端 stamp 覆盖冲突归属。"""
                doc = dict(document or {})
                oid = str(doc.get("opportunityId") or "").strip()
                if oid:
                    opp = await self.repo.get_opportunity(oid)
                    if opp:
                        doc["geoSource"] = await self._resolve_opportunity_geo(
                            await self._opportunity_doc_for_geo(opp)
                        )
                    else:
                        client = normalize_geo_source(doc.get("geoSource"))
                        doc["geoSource"] = client or "manual"
                else:
                    client = normalize_geo_source(doc.get("geoSource"))
                    doc["geoSource"] = client or "manual"
                    if doc["geoSource"] == "manual" and user is not None:
                        forced = forced_geo_source(user)
                        if forced:
                            doc["geoSource"] = forced
                forced = forced_geo_source(user) if user is not None else None
                if forced and doc["geoSource"] != forced:
                    raise PermissionDeniedError("海外运营仅可操作海外归属的合同")
                return doc

    async def _filter_opportunity_docs_by_geo(
                self, docs: list[dict[str, Any]], forced: str
            ) -> list[dict[str, Any]]:
                if not docs:
                    return []
                out: list[dict[str, Any]] = []
                for doc in docs:
                    entity_geo = await self._resolve_opportunity_geo(doc)
                    if matches_forced_geo(forced, entity_geo):
                        out.append({**doc, "geoSource": entity_geo})
                return out

    async def _filter_contract_docs_by_geo(
                self, docs: list[dict[str, Any]], forced: str
            ) -> list[dict[str, Any]]:
                if not docs:
                    return []
                opp_ids = [
                    str(d.get("opportunityId") or "").strip()
                    for d in docs
                    if str(d.get("opportunityId") or "").strip()
                ]
                opp_rows = await self.repo.list_opportunities_by_ids(list(dict.fromkeys(opp_ids)))
                children_map = await self.repo.list_opportunity_children([r.id for r in opp_rows])
                opp_docs = {
                    row.id: _opportunity_response(
                        row, **(children_map.get(row.id) or _EMPTY_OPP_CHILDREN)
                    )
                    for row in opp_rows
                }
                out: list[dict[str, Any]] = []
                for doc in docs:
                    oid = str(doc.get("opportunityId") or "").strip()
                    if oid and oid in opp_docs:
                        entity_geo = await self._resolve_opportunity_geo(opp_docs[oid])
                    else:
                        entity_geo = prefer_linked_geo(
                            linked=None,
                            stamped=resolve_document_geo_source(doc),
                        )
                    if matches_forced_geo(forced, entity_geo):
                        out.append({**doc, "geoSource": entity_geo})
                return out
