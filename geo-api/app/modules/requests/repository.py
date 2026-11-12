from __future__ import annotations

import json
import random
import uuid
from datetime import datetime
from typing import Any

from babel import Locale
from sqlalchemy import and_, case, delete, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import format_legacy_time, utc_now
from app.models import Request, User
from app.models.crm import CrmAttachment
from app.models.request import (
    RequestFeishuLink,
    RequestGoal,
    RequestImportMeta,
    RequestIntentItem,
    RequestListItem,
    RequestNote,
    RequestProduct,
    RequestRegion,
)
from app.modules.crm.repository.base import sync_attachments
from app.modules.requests.repository_helpers import (
    _LIST_KIND_KEYS,
    DUPLICATE_WINDOW_MS,
    EMPTY_REQUEST_STATS,
    LIST_VISIBLE_STATUSES,
    _assemble_request_data,
    _empty_request_children,
    _form_column_values,
    _form_str,
    _parse_dt,
    _row_to_record,
    derive_geo_source,
)
from app.modules.requests.schemas import (
    RequestRecord,
    RequestStatus,
)

_ZH_TERRITORIES = Locale.parse("zh_Hans_CN").territories


def _region_match_values(raw: str) -> list[str]:
    """区域筛选候选值：兼容国家 code（表单提交，如 US）与中文名（飞书导入，如 美国）。"""
    values = [raw]
    label = _ZH_TERRITORIES.get(raw.upper())
    if label and label not in values:
        values.append(label)
    return values


class RequestRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_all(self) -> list[Request]:
        result = await self.db.execute(select(Request).order_by(desc(Request.updated_at)))
        return list(result.scalars().all())

    async def list_by_staff(self, staff_user_id: str) -> list[Request]:
        result = await self.db.execute(
            select(Request)
            .where(Request.staff_user_id == staff_user_id)
            .order_by(desc(Request.updated_at))
        )
        return list(result.scalars().all())

    async def list_by_staff_ids(self, staff_user_ids: list[str]) -> list[Request]:
        if not staff_user_ids:
            return []
        result = await self.db.execute(
            select(Request)
            .where(Request.staff_user_id.in_(staff_user_ids))
            .order_by(desc(Request.updated_at))
        )
        return list(result.scalars().all())

    async def list_unassigned(self) -> list[Request]:
        result = await self.db.execute(
            select(Request)
            .where(Request.staff_user_id.is_(None))
            .order_by(desc(Request.updated_at))
        )
        return list(result.scalars().all())

    def _scope_clause(
        self,
        *,
        staff_ids: list[str] | None,
        include_unassigned: bool,
    ):
        """
        staff_ids is None → 全量；
        空列表且不含未分配 → 无结果；
        否则按负责人过滤，可选并入未分配。
        """
        if staff_ids is None:
            return None
        parts = []
        if staff_ids:
            parts.append(Request.staff_user_id.in_(staff_ids))
        if include_unassigned:
            parts.append(Request.staff_user_id.is_(None))
        if not parts:
            return and_(False)
        return or_(*parts) if len(parts) > 1 else parts[0]

    def _list_filter_clauses(
        self,
        *,
        keyword: str | None = None,
        status: str | None = None,
        opportunity_id: str | None = None,
        geo_source: str | None = None,
        region: str | None = None,
        goal: str | None = None,
        submitted_from: str | None = None,
        submitted_to: str | None = None,
    ) -> list[Any]:
        clauses: list[Any] = []
        if status and status != "all":
            clauses.append(Request.status == status)
        else:
            clauses.append(Request.status.in_(LIST_VISIBLE_STATUSES))

        oid = (opportunity_id or "").strip()
        if oid:
            clauses.append(Request.opportunity_id == oid)

        source_key = (geo_source or "").strip().lower()
        if source_key and source_key != "all":
            if source_key == "mest":
                source_key = "mestbo"
            clauses.append(Request.geo_source == source_key)

        kw = (keyword or "").strip()
        if kw:
            like = f"%{kw}%"
            clauses.append(
                or_(
                    Request.code.like(like),
                    Request.owner.like(like),
                    func.coalesce(Request.company_name, "").like(like),
                    func.coalesce(Request.brand_name, "").like(like),
                )
            )
        region_kw = (region or "").strip()
        if region_kw:
            # 目标国家：request_regions 精确匹配，兼容 code 与中文名
            clauses.append(
                select(RequestRegion.id)
                .where(
                    RequestRegion.request_id == Request.id,
                    RequestRegion.country.in_(_region_match_values(region_kw)),
                )
                .exists()
            )
        goal_kw = (goal or "").strip()
        if goal_kw:
            # 海外单选 goal 列 / 国内多选 request_goals 表都命中
            clauses.append(
                or_(
                    Request.goal == goal_kw,
                    select(RequestGoal.id)
                    .where(
                        RequestGoal.request_id == Request.id,
                        RequestGoal.goal == goal_kw,
                    )
                    .exists(),
                )
            )
        from_day = (submitted_from or "").strip()[:10]
        if from_day:
            clauses.append(func.date(Request.submitted_at) >= from_day)
        to_day = (submitted_to or "").strip()[:10]
        if to_day:
            clauses.append(func.date(Request.submitted_at) <= to_day)
        return clauses

    async def search_requests(
        self,
        *,
        staff_ids: list[str] | None,
        include_unassigned: bool = False,
        keyword: str | None = None,
        status: str | None = None,
        opportunity_id: str | None = None,
        geo_source: str | None = None,
        region: str | None = None,
        goal: str | None = None,
        submitted_from: str | None = None,
        submitted_to: str | None = None,
        page: int = 1,
        page_size: int = 10,
    ) -> tuple[list[Request], int]:
        if staff_ids is not None and not staff_ids and not include_unassigned:
            return [], 0

        page = max(1, int(page or 1))
        page_size = min(100, max(1, int(page_size or 10)))
        offset = (page - 1) * page_size

        where_parts = self._list_filter_clauses(
            keyword=keyword,
            status=status,
            opportunity_id=opportunity_id,
            geo_source=geo_source,
            region=region,
            goal=goal,
            submitted_from=submitted_from,
            submitted_to=submitted_to,
        )
        scope = self._scope_clause(staff_ids=staff_ids, include_unassigned=include_unassigned)
        if scope is not None:
            where_parts.append(scope)

        count_stmt = select(func.count()).select_from(Request)
        list_stmt = select(Request).order_by(desc(Request.updated_at))
        if where_parts:
            count_stmt = count_stmt.where(and_(*where_parts))
            list_stmt = list_stmt.where(and_(*where_parts))
        list_stmt = list_stmt.offset(offset).limit(page_size)

        total = int((await self.db.execute(count_stmt)).scalar_one() or 0)
        rows = list((await self.db.execute(list_stmt)).scalars().all())
        return rows, total

    async def aggregate_request_stats(
        self,
        *,
        staff_ids: list[str] | None,
        include_unassigned: bool = False,
        geo_source: str | None = None,
    ) -> dict[str, int]:
        if staff_ids is not None and not staff_ids and not include_unassigned:
            return dict(EMPTY_REQUEST_STATS)

        stmt = select(
            func.count().label("total"),
            func.coalesce(func.sum(case((Request.status == "submitted", 1), else_=0)), 0).label("submitted"),
            func.coalesce(func.sum(case((Request.status == "pending_review", 1), else_=0)), 0).label("pending"),
            func.coalesce(func.sum(case((Request.status == "confirmed", 1), else_=0)), 0).label("confirmed"),
            func.coalesce(func.sum(case((Request.status == "in_project", 1), else_=0)), 0).label("in_project"),
            func.coalesce(func.sum(case((Request.status == "supplement", 1), else_=0)), 0).label("supplement"),
        ).where(Request.status.in_([*LIST_VISIBLE_STATUSES, "supplement"]))

        scope = self._scope_clause(staff_ids=staff_ids, include_unassigned=include_unassigned)
        if scope is not None:
            stmt = stmt.where(scope)

        source_key = (geo_source or "").strip().lower()
        if source_key and source_key != "all":
            if source_key == "mest":
                source_key = "mestbo"
            stmt = stmt.where(Request.geo_source == source_key)

        row = (await self.db.execute(stmt)).one()
        # total：内部列表可见状态（不含 supplement）
        visible_total = int(row.submitted or 0) + int(row.pending or 0) + int(row.confirmed or 0) + int(row.in_project or 0)
        return {
            "total": visible_total,
            "submitted": int(row.submitted or 0),
            "pending": int(row.pending or 0),
            "confirmed": int(row.confirmed or 0),
            "in_project": int(row.in_project or 0),
            "supplement": int(row.supplement or 0),
        }

    async def get_by_id(self, request_id: str) -> Request | None:
        result = await self.db.execute(select(Request).where(Request.id == request_id))
        return result.scalar_one_or_none()

    async def _record_with_children(self, row: Request) -> RequestRecord:
        children = await self.get_request_children(row.id)
        return _row_to_record(row, children)

    async def get_by_ids_for_export(
        self,
        ids: list[str],
        *,
        staff_ids: list[str] | None,
        include_unassigned: bool,
        geo_source: str | None = None,
    ) -> list[Request]:
        """批量导出专用：按 ids 拉取并叠加数据范围与国内/海外来源过滤。"""
        if not ids:
            return []
        stmt = select(Request).where(Request.id.in_(ids))
        scope = self._scope_clause(staff_ids=staff_ids, include_unassigned=include_unassigned)
        if scope is not None:
            stmt = stmt.where(scope)

        source_key = (geo_source or "").strip().lower()
        if source_key and source_key != "all":
            stmt = stmt.where(Request.geo_source == source_key)

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def find_recent_duplicate(
        self,
        *,
        staff_user_id: str,
        invite_id: str | None,
        status: RequestStatus,
        data: dict[str, Any],
    ) -> RequestRecord | None:
        result = await self.db.execute(
            select(Request)
            .where(
                Request.staff_user_id == staff_user_id,
                func.coalesce(Request.invite_id, "") == (invite_id or ""),
            )
            .order_by(desc(Request.updated_at))
            .limit(5)
        )
        serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        now = utc_now()
        candidates = list(result.scalars().all())
        children_map = await self.list_request_children([row.id for row in candidates])
        for row in candidates:
            if row.status != status:
                continue
            row_data = _assemble_request_data(row, children_map.get(row.id, _empty_request_children()))
            if json.dumps(row_data, ensure_ascii=False, separators=(",", ":"), sort_keys=True) != serialized:
                continue
            ref = row.updated_at
            if ref and (now - ref).total_seconds() * 1000 <= DUPLICATE_WINDOW_MS:
                return _row_to_record(row, children_map.get(row.id))
        return None

    async def insert(
        self,
        *,
        staff_user_id: str,
        invite_id: str | None,
        owner_name: str,
        data: dict[str, Any],
        status: RequestStatus,
    ) -> RequestRecord:
        duplicate = await self.find_recent_duplicate(
            staff_user_id=staff_user_id,
            invite_id=invite_id,
            status=status,
            data=data,
        )
        if duplicate:
            return duplicate.model_copy(update={"reused": True})

        now = utc_now()
        submitted = None if status == "draft" else now
        row: Request | None = None
        for attempt in range(5):
            code = self._generate_code(data)
            candidate = Request(
                id=str(uuid.uuid4()),
                code=code,
                status=status,
                geo_source=derive_geo_source(code, data),
                company_name=_form_str(data, "companyName"),
                brand_name=_form_str(data, "brandName"),
                goal=_form_str(data, "goal"),
                **_form_column_values(data),
                submitted_at=submitted,
                updated_at=now,
                owner=owner_name,
                staff_user_id=staff_user_id,
                invite_id=invite_id,
            )
            savepoint = await self.db.begin_nested()
            try:
                self.db.add(candidate)
                await self.db.flush()
                await savepoint.commit()
                row = candidate
                break
            except IntegrityError:
                await savepoint.rollback()
                if attempt == 4:
                    raise
        assert row is not None
        await self._sync_form_rows(row.id, data, notes=[], attachments=[])
        return await self._record_with_children(row)

    async def update_data(self, request_id: str, data: dict[str, Any]) -> RequestRecord | None:
        now = utc_now()
        row = await self.get_by_id(request_id)
        if row is None:
            return None
        children = await self.get_request_children(request_id)
        prev_data = _assemble_request_data(row, children)
        patch = data if isinstance(data, dict) else {}
        # compose+merge：缺集合键保留 prev，禁止 _sync_form_rows 用 or [] 抹库
        merged = {**prev_data, **patch}
        for key in (
            "regions",
            "goals",
            "products",
            "intentQuestions",
            "intentRoughItems",
            "platforms",
            "brandAliases",
            "brandCompetitors",
            "feishuLinks",
            "importMeta",
        ):
            if key not in patch and key in prev_data:
                merged[key] = prev_data.get(key)
        await self.db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(
                geo_source=derive_geo_source(row.code, merged),
                company_name=_form_str(merged, "companyName"),
                brand_name=_form_str(merged, "brandName"),
                goal=_form_str(merged, "goal"),
                updated_at=now,
                **_form_column_values(merged),
            )
        )
        await self._sync_form_rows(
            request_id,
            merged,
            notes=children.get("notes") or [],
            attachments=children.get("attachments") or [],
        )
        row = await self.get_by_id(request_id)
        return await self._record_with_children(row) if row else None

    async def update_status(self, request_id: str, status: RequestStatus) -> RequestRecord | None:
        now = utc_now()
        await self.db.execute(
            update(Request).where(Request.id == request_id).values(status=status, updated_at=now)
        )
        row = await self.get_by_id(request_id)
        return await self._record_with_children(row) if row else None


    async def list_by_ids(self, request_ids: list[str]) -> list[Request]:
        ids = [rid for rid in request_ids if rid]
        if not ids:
            return []
        result = await self.db.execute(select(Request).where(Request.id.in_(ids)))
        return list(result.scalars().all())

    async def get_request_children(self, request_id: str) -> dict[str, Any]:
        """需求子表数据（表单数组 + importMeta），供 data 组装。"""
        return (await self.list_request_children([request_id])).get(
            request_id,
            _empty_request_children(),
        )

    async def list_request_children(
        self, request_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """批量读取需求表单子表（避免列表 N+1）。"""
        ids = [str(x) for x in request_ids if str(x)]
        out: dict[str, dict[str, Any]] = {
            rid: _empty_request_children() for rid in ids
        }
        if not ids:
            return out

        regions = (
            await self.db.execute(
                select(RequestRegion)
                .where(RequestRegion.request_id.in_(ids))
                .order_by(RequestRegion.request_id, RequestRegion.country)
            )
        ).scalars().all()
        for item in regions:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            bucket["regions"].append(
                {
                    "platform": getattr(item, "platform", None) or "",
                    "country": item.country,
                    "language": item.language,
                }
            )
        goals = (
            await self.db.execute(
                select(RequestGoal)
                .where(RequestGoal.request_id.in_(ids))
                .order_by(RequestGoal.request_id, RequestGoal.goal)
            )
        ).scalars().all()
        for item in goals:
            out.setdefault(item.request_id, _empty_request_children())["goals"].append(
                item.goal
            )
        products = (
            await self.db.execute(
                select(RequestProduct)
                .where(RequestProduct.request_id.in_(ids))
                .order_by(RequestProduct.request_id, RequestProduct.sort_order)
            )
        ).scalars().all()
        for item in products:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            product: dict[str, Any] = {
                "id": item.item_id or item.id,
                "name": item.name,
                "fn": item.fn or "",
                "users": item.users or "",
                "scenario": item.scenario or "",
                "competitors": item.competitors or "",
            }
            bucket["products"].append(product)
        intents = (
            await self.db.execute(
                select(RequestIntentItem)
                .where(RequestIntentItem.request_id.in_(ids))
                .order_by(
                    RequestIntentItem.request_id,
                    RequestIntentItem.kind,
                    RequestIntentItem.sort_order,
                )
            )
        ).scalars().all()
        for item in intents:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            entry = {
                "id": item.item_id or item.id,
                "productId": item.product_id or "",
                "text": item.text,
            }
            bucket[
                "intentQuestions" if item.kind == "questions" else "intentRoughItems"
            ].append(entry)
        list_items = (
            await self.db.execute(
                select(RequestListItem)
                .where(RequestListItem.request_id.in_(ids))
                .order_by(
                    RequestListItem.request_id,
                    RequestListItem.kind,
                    RequestListItem.sort_order,
                )
            )
        ).scalars().all()
        for item in list_items:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            key = _LIST_KIND_KEYS.get(item.kind)
            if key is not None:
                bucket[key].append(item.value)
        feishu_links = (
            await self.db.execute(
                select(RequestFeishuLink)
                .where(RequestFeishuLink.request_id.in_(ids))
                .order_by(RequestFeishuLink.request_id, RequestFeishuLink.sort_order)
            )
        ).scalars().all()
        for item in feishu_links:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            link: dict[str, Any] = {}
            if item.url is not None:
                link["url"] = item.url
            if item.text is not None:
                link["text"] = item.text
            if item.field is not None:
                link["field"] = item.field
            bucket["feishuLinks"].append(link)
        metas = (
            await self.db.execute(
                select(RequestImportMeta).where(RequestImportMeta.request_id.in_(ids))
            )
        ).scalars().all()
        for item in metas:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            meta: dict[str, Any] = {}
            if item.source is not None:
                meta["source"] = item.source
            if item.feishu_record_id is not None:
                meta["feishuRecordId"] = item.feishu_record_id
            if item.imported_at is not None:
                meta["importedAt"] = item.imported_at.strftime("%Y-%m-%d %H:%M:%S")
            bucket["importMeta"] = meta or None
        notes = (
            await self.db.execute(
                select(RequestNote)
                .where(RequestNote.request_id.in_(ids))
                .order_by(RequestNote.request_id, RequestNote.sort_order)
            )
        ).scalars().all()
        for item in notes:
            bucket = out.setdefault(item.request_id, _empty_request_children())
            bucket["notes"].append(
                {
                    "id": item.id,
                    "author": item.author,
                    "content": item.content,
                    "created_at": (
                        item.created_at.strftime("%Y-%m-%d %H:%M:%S")
                        if item.created_at
                        else ""
                    ),
                }
            )
        attachments = (
            await self.db.execute(
                select(CrmAttachment).where(
                    CrmAttachment.entity_type == "request",
                    CrmAttachment.entity_id.in_(ids),
                )
            )
        ).scalars().all()
        for item in attachments:
            bucket = out.setdefault(item.entity_id, _empty_request_children())
            bucket["attachments"].append(
                {
                    "id": item.id,
                    "name": item.name,
                    "size": item.size,
                    "uploaded_at": (
                        item.uploaded_at.strftime("%Y-%m-%d %H:%M:%S")
                        if item.uploaded_at
                        else ""
                    ),
                    "uploaded_by": item.uploaded_by or "",
                    "url": item.url,
                    "content_type": item.content_type,
                    "storage_path": item.storage_path,
                    "description": item.description,
                }
            )
        return out

    async def list_by_opportunity(self, opportunity_id: str) -> list[Request]:
        oid = (opportunity_id or "").strip()
        if not oid:
            return []
        result = await self.db.execute(
            select(Request)
            .where(Request.opportunity_id == oid)
            .order_by(desc(Request.updated_at))
        )
        return list(result.scalars().all())

    async def update_owner(self, request_id: str, owner: str, staff_user_id: str | None) -> RequestRecord | None:
        now = utc_now()
        await self.db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(owner=owner, staff_user_id=staff_user_id, updated_at=now)
        )
        row = await self.get_by_id(request_id)
        return await self._record_with_children(row) if row else None

    async def append_note(self, request_id: str, content: str, author: str) -> RequestRecord | None:
        row = await self.get_by_id(request_id)
        if not row:
            return None
        children = await self.get_request_children(request_id)
        notes = list(children.get("notes") or [])
        notes.append(
            {
                "id": f"n{int(datetime.utcnow().timestamp() * 1000)}",
                "author": author,
                "content": content,
                "createdAt": format_legacy_time(),
            }
        )
        now = utc_now()
        await self.db.execute(
            update(Request).where(Request.id == request_id).values(updated_at=now)
        )
        data = _assemble_request_data(row, children)
        await self._sync_form_rows(
            request_id,
            data,
            notes=notes,
            attachments=children.get("attachments") or [],
        )
        row = await self.get_by_id(request_id)
        return await self._record_with_children(row) if row else None

    async def replace_attachments(
        self, request_id: str, attachments: list[dict[str, Any]]
    ) -> RequestRecord | None:
        row = await self.get_by_id(request_id)
        if not row:
            return None
        now = utc_now()
        await self.db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(updated_at=now)
        )
        await sync_attachments(self.db, "request", request_id, attachments)
        row = await self.get_by_id(request_id)
        return await self._record_with_children(row) if row else None

    async def _sync_form_rows(
        self,
        request_id: str,
        data: dict[str, Any] | None,
        *,
        notes: list[Any] | None,
        attachments: list[Any] | None,
    ) -> None:
        """data.regions / data.goals / notes 落子表（写穿式，幂等）。"""
        data = data if isinstance(data, dict) else {}
        await self.db.execute(delete(RequestRegion).where(RequestRegion.request_id == request_id))
        await self.db.execute(delete(RequestGoal).where(RequestGoal.request_id == request_id))
        await self.db.execute(delete(RequestNote).where(RequestNote.request_id == request_id))
        await self.db.execute(delete(RequestProduct).where(RequestProduct.request_id == request_id))
        await self.db.execute(delete(RequestIntentItem).where(RequestIntentItem.request_id == request_id))
        await self.db.execute(delete(RequestListItem).where(RequestListItem.request_id == request_id))
        await self.db.execute(delete(RequestImportMeta).where(RequestImportMeta.request_id == request_id))
        await self.db.execute(delete(RequestFeishuLink).where(RequestFeishuLink.request_id == request_id))
        for index, region in enumerate(data.get("regions") or []):
            if not isinstance(region, dict):
                continue
            country = str(region.get("country") or "").strip()
            if not country:
                continue
            self.db.add(
                RequestRegion(
                    id=f"{request_id}-rg-{index}",
                    request_id=request_id,
                    platform=_form_str(region, "platform"),
                    country=country,
                    language=_form_str(region, "language"),
                )
            )
        for index, goal in enumerate(data.get("goals") or []):
            value = str(goal or "").strip()
            if not value:
                continue
            self.db.add(
                RequestGoal(
                    id=f"{request_id}-gl-{index}",
                    request_id=request_id,
                    goal=value,
                )
            )
        for index, product in enumerate(data.get("products") or []):
            if not isinstance(product, dict):
                continue
            name = str(product.get("name") or "").strip()
            if not name:
                continue
            self.db.add(
                RequestProduct(
                    id=f"{request_id}-pr-{index}",
                    request_id=request_id,
                    item_id=_form_str(product, "id"),
                    name=name,
                    fn=_form_str(product, "fn"),
                    users=_form_str(product, "users"),
                    scenario=_form_str(product, "scenario"),
                    competitors=_form_str(product, "competitors"),
                    sort_order=index,
                )
            )
        for kind, key in (("questions", "intentQuestions"), ("rough", "intentRoughItems")):
            for index, item in enumerate(data.get(key) or []):
                if isinstance(item, str):
                    text = item.strip()
                    item_id = None
                    product_id = None
                elif isinstance(item, dict):
                    text = str(item.get("text") or "").strip()
                    item_id = _form_str(item, "id")
                    product_id = _form_str(item, "productId")
                else:
                    continue
                if not text:
                    continue
                self.db.add(
                    RequestIntentItem(
                        id=f"{request_id}-it-{kind}-{index}",
                        request_id=request_id,
                        kind=kind,
                        item_id=item_id,
                        product_id=product_id,
                        text=text,
                        sort_order=index,
                    )
                )
        for kind, key in (
            ("platforms", "platforms"),
            ("brand_aliases", "brandAliases"),
            ("brand_competitors", "brandCompetitors"),
        ):
            for index, value in enumerate(data.get(key) or []):
                value = str(value or "").strip()
                if not value:
                    continue
                self.db.add(
                    RequestListItem(
                        id=f"{request_id}-li-{kind}-{index}",
                        request_id=request_id,
                        kind=kind,
                        value=value[:512],
                        sort_order=index,
                    )
                )
        for index, link in enumerate(data.get("feishuLinks") or []):
            if isinstance(link, dict):
                self.db.add(
                    RequestFeishuLink(
                        id=f"{request_id}-fl-{index}",
                        request_id=request_id,
                        url=_form_str(link, "url"),
                        text=_form_str(link, "text"),
                        field=_form_str(link, "field"),
                        sort_order=index,
                    )
                )
            elif isinstance(link, str) and str(link).strip():
                self.db.add(
                    RequestFeishuLink(
                        id=f"{request_id}-fl-{index}",
                        request_id=request_id,
                        url=str(link).strip(),
                        text=None,
                        field=None,
                        sort_order=index,
                    )
                )
        meta = data.get("importMeta")
        if isinstance(meta, dict) and meta:
            self.db.add(
                RequestImportMeta(
                    request_id=request_id,
                    source=_form_str(meta, "source"),
                    feishu_record_id=_form_str(meta, "feishuRecordId"),
                    imported_at=_parse_dt(meta.get("importedAt")),
                )
            )
        for index, note in enumerate(notes or []):
            if not isinstance(note, dict):
                continue
            content = str(note.get("content") or "").strip()
            if not content:
                continue
            self.db.add(
                RequestNote(
                    id=f"{request_id}-rn-{index}",
                    request_id=request_id,
                    author=str(note.get("author") or ""),
                    content=content,
                    created_at=_parse_dt(note.get("createdAt")),
                    sort_order=index,
                )
            )
        if attachments is not None:
            await sync_attachments(self.db, "request", request_id, attachments)

    @staticmethod
    def _generate_code(data: dict[str, Any] | None = None) -> str:
        date = utc_now().strftime("%Y%m%d")
        suffix = random.randint(1000, 9999)
        prefix = "GEO"
        if isinstance(data, dict):
            meta = data.get("importMeta")
            source = ""
            if isinstance(meta, dict):
                source = str(meta.get("source") or "")
            variant = str(data.get("geoVariant") or "")
            if source == "国内GEO需求" or variant == "domestic":
                prefix = "GEO-CN"
            elif source == "海外GEO需求" or variant == "overseas":
                prefix = "GEO-OV"
            elif source == "麦思博GEO需求" or variant == "mestbo":
                prefix = "GEO-MS"
        return f"{prefix}-{date}-{suffix}"

    async def get_staff_name(self, user_id: str) -> str | None:
        result = await self.db.execute(select(User.name).where(User.id == user_id))
        return result.scalar_one_or_none()
