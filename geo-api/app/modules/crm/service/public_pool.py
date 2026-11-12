from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.core.deps import user_data_scope, user_has_permission
from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.feishu import feishu_post, is_feishu_configured
from app.core.time_utils import china_now, format_legacy_time
from app.models.crm import (
    CrmFollowUp,
    CrmPublicPoolClaim,
    CrmPublicPoolEntry,
    CrmSalesCoverage,
)
from app.models.user import EMPLOYMENT_ACTIVE, User
from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository.base import new_id
from app.modules.users.repository import UsersRepository


logger = logging.getLogger(__name__)

PUBLIC_POOL_REGIONS = ("华北区", "华东区", "华南区")
PUBLIC_POOL_LIMIT = 60
PUBLIC_POOL_ACTIVE_STATUSES = ("available", "pending_review")


def _normalize_pool_region(value: str | None) -> str:
    raw = str(value or "").strip()
    aliases = {
        "华北": "华北区",
        "华东": "华东区",
        "华南": "华南区",
    }
    return aliases.get(raw, raw)


def _regions_from_names(names: list[str]) -> set[str]:
    out: set[str] = set()
    for name in names:
        text = str(name or "")
        for short, region in (("华北", "华北区"), ("华东", "华东区"), ("华南", "华南区")):
            if short in text:
                out.add(region)
    return out


class PublicPoolMixin:
    def _assert_public_pool_permission(self, user: AuthUser, code: str) -> None:
        if not user_has_permission(user, "section:public_pool"):
            raise PermissionDeniedError("无权访问公海池")
        if not user_has_permission(user, code):
            raise PermissionDeniedError()

    async def _public_pool_regions(self, user: AuthUser) -> list[str] | None:
        """None 表示全部区域；空数组表示区域未配置，安全地不返回任何客户。"""
        if user_data_scope(user) == "all" and user_has_permission(user, "public_pool:review"):
            return None
        names = [*(user.department_names or [])]
        if user.manual_department_name:
            names.append(user.manual_department_name)
        regions = _regions_from_names(names)
        if regions:
            return sorted(regions)
        if user_data_scope(user) == "department":
            managed_ids = await UsersRepository(self.db).get_managed_scope_user_ids(user.id)
            for uid in managed_ids:
                row = await UsersRepository(self.db).get_by_id(uid)
                if not row:
                    continue
                dept_names = UsersRepository._parse_user_departments(
                    row.department_names,
                    row.manual_department_name,
                )
                regions.update(_regions_from_names(dept_names))
        return sorted(regions)

    async def _assert_pool_region_visible(self, user: AuthUser, region: str) -> None:
        allowed = await self._public_pool_regions(user)
        if allowed is not None and region not in allowed:
            if not allowed:
                raise PermissionDeniedError("当前账号尚未配置华北/华东/华南销售区域，请联系管理员")
            raise PermissionDeniedError("该客户不在你的负责区域")

    async def _assert_sales_customer_capacity(self, owner_user_id: str) -> None:
        target = await UsersRepository(self.db).get_by_id(owner_user_id)
        if not target or (target.role or "").strip() not in {"sales", "leader"}:
            return
        # 并发建档/转客/认领时串行化同一销售的容量校验，防止同时穿透 60 条上限。
        await self.db.execute(select(User.id).where(User.id == owner_user_id).with_for_update())
        current = await self.repo.count_maintained_customers(owner_user_id)
        if current >= PUBLIC_POOL_LIMIT:
            raise ValidationError(
                f"当前可维护客户已达 {PUBLIC_POOL_LIMIT} 个，请先释放至少 1 个客户至公海后再继续。"
            )

    @staticmethod
    def _claim_doc(claim: CrmPublicPoolClaim | None) -> dict[str, Any] | None:
        if not claim:
            return None
        return {
            "id": claim.id,
            "applicantUserId": claim.applicant_user_id,
            "applicantName": claim.applicant_name,
            "status": claim.status,
            "reviewReason": claim.review_reason or "",
            "reviewerName": claim.reviewer_name or "",
            "appliedAt": format_legacy_time(claim.applied_at),
            "reviewedAt": format_legacy_time(claim.reviewed_at) if claim.reviewed_at else "",
        }

    def _public_pool_item(
        self,
        user: AuthUser,
        entry: CrmPublicPoolEntry,
        customer,
        claims: list[CrmPublicPoolClaim],
    ) -> dict[str, Any]:
        latest = claims[0] if claims else None
        mine = next((item for item in claims if item.applicant_user_id == user.id), None)
        pending = next((item for item in claims if item.status == "pending_review"), None)
        display_status = entry.status
        if entry.status == "available" and mine and mine.status == "rejected":
            display_status = "rejected"
        return {
            "id": entry.id,
            "customerId": customer.id,
            "companyName": customer.company_name or "",
            "brandName": customer.brand_name or "",
            "region": entry.region,
            "city": customer.city or "",
            "industryL1": customer.industry_l1 or "",
            "industryL2": customer.industry_l2 or "",
            "foundedDate": customer.founded_date.isoformat() if customer.founded_date else "",
            "creditCode": customer.credit_code or "",
            "registeredCapital": float(customer.registered_capital or 0),
            "annualRevenue": float(customer.annual_revenue or 0),
            "scale": customer.scale or "",
            "nature": customer.nature or "",
            "source": customer.source or "",
            "sourceDetail": customer.source_detail or "",
            "status": display_status,
            "releasedAt": format_legacy_time(entry.released_at),
            "releaseReason": entry.release_reason,
            "contactHint": "认领成功后可见",
            "latestApplication": self._claim_doc(latest),
            "myApplication": self._claim_doc(mine),
            "pendingApplication": self._claim_doc(pending),
            "canClaim": bool(
                entry.status == "available"
                and user_has_permission(user, "public_pool:claim")
            ),
            "canReview": bool(
                entry.status == "pending_review"
                and user_has_permission(user, "public_pool:review")
            ),
        }

    async def list_public_pool(
        self,
        user: AuthUser,
        *,
        company_name: str | None = None,
        industry: str | None = None,
        region: str | None = None,
        source: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        self._assert_section(user, "public_pool")
        allowed = await self._public_pool_regions(user)
        requested_region = _normalize_pool_region(region)
        if requested_region and requested_region != "all":
            if requested_region not in PUBLIC_POOL_REGIONS:
                raise ValidationError("公海池区域无效")
            await self._assert_pool_region_visible(user, requested_region)
        rows, total = await self.repo.list_public_pool_rows(
            allowed_regions=allowed,
            company_name=company_name,
            industry=industry,
            region=requested_region,
            source=source,
            status=status,
            page=page,
            page_size=page_size,
        )
        entry_ids = [entry.id for entry, _customer in rows]
        claim_rows = await self.repo.list_public_pool_claims(entry_ids)
        claim_map: dict[str, list[CrmPublicPoolClaim]] = {entry_id: [] for entry_id in entry_ids}
        for claim in claim_rows:
            claim_map.setdefault(claim.entry_id, []).append(claim)
        return {
            "items": [
                self._public_pool_item(user, entry, customer, claim_map.get(entry.id, []))
                for entry, customer in rows
            ],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "allowedRegions": allowed if allowed is not None else list(PUBLIC_POOL_REGIONS),
            "regionConfigured": allowed is None or bool(allowed),
        }

    async def get_public_pool_stats(self, user: AuthUser) -> dict[str, int]:
        self._assert_section(user, "public_pool")
        allowed = await self._public_pool_regions(user)
        now = china_now()
        month_start = datetime(now.year, now.month, 1)
        return await self.repo.public_pool_stats(
            allowed_regions=allowed,
            month_start=month_start,
        )

    async def get_public_pool_detail(self, user: AuthUser, entry_id: str) -> dict[str, Any]:
        """返回单条公海客户的脱敏详情，认领前不走客户主档详情权限。"""
        self._assert_section(user, "public_pool")
        entry = await self.repo.get_public_pool_entry(entry_id)
        if not entry or entry.status not in PUBLIC_POOL_ACTIVE_STATUSES:
            raise NotFoundError("公海客户不存在或已不在公海池")
        await self._assert_pool_region_visible(user, entry.region)
        customer = await self.repo.get_customer(entry.customer_id)
        if not customer or not customer.in_public_pool:
            raise NotFoundError("公海客户状态已变化，请刷新后重试")
        claims = list(await self.repo.list_public_pool_claims([entry.id]))
        return self._public_pool_item(user, entry, customer, claims)

    async def _create_public_pool_audit(
        self,
        *,
        user: AuthUser,
        customer_id: str,
        company_name: str,
        action: str,
        changes: list[dict[str, str]],
    ) -> None:
        await self.repo.create_audit_record(
            record_id=f"audit-pp-{new_id()}"[:64],
            module="公海池",
            entity_type="客户",
            entity_id=customer_id,
            related_entity_ids=None,
            entity_name=company_name[:255],
            action=action[:128],
            actor=(user.name or "系统")[:128],
            actor_user_id=user.id,
            timestamp_at=china_now(),
            changes=changes,
        )

    async def _append_pool_follow_up(
        self,
        *,
        coverage: CrmSalesCoverage,
        author: str,
        content: str,
    ) -> None:
        now = china_now()
        self.db.add(
            CrmFollowUp(
                id=new_id("fu"),
                coverage_id=coverage.id,
                customer_id=coverage.customer_id,
                author=author,
                content=content,
                follow_type=None,
                contact_id=None,
                contact_name=None,
                wechat_added=False,
                mentions=None,
                next_follow_at=None,
                origin="public_pool",
                source_lead_id=None,
                source_lead_note_id=None,
                created_at=now,
                updated_at=now,
            )
        )
        coverage.last_follow_at = now.date()
        coverage.updated_at = now

    async def release_customer_to_public_pool(
        self,
        user: AuthUser,
        customer_id: str,
        *,
        reason: str,
        coverage_id: str | None = None,
    ) -> dict[str, Any]:
        self._assert_public_pool_permission(user, "public_pool:release")
        release_reason = (reason or "").strip()
        if not release_reason:
            raise ValidationError("请填写释放原因")
        customer = await self.repo.get_customer(customer_id)
        if not customer:
            raise NotFoundError("客户不存在")
        if customer.in_public_pool:
            raise ConflictError("该客户已经在公海池中")

        coverage: CrmSalesCoverage | None = None
        if coverage_id:
            coverage = await self.repo.get_coverage(coverage_id)
            if not coverage or coverage.customer_id != customer_id:
                raise NotFoundError("客户经营池不存在")
        else:
            coverage = await self.repo.get_coverage_by_customer_owner(customer_id, user.id)
        if not coverage:
            raise PermissionDeniedError("你不是该客户当前负责人，无法释放")
        await self._assert_coverage_access(user, coverage, write=True)
        old_owner_user_id = coverage.owner_user_id
        old_owner_name = coverage.owner_name or user.name
        if old_owner_user_id != user.id and user_data_scope(user) != "all":
            raise PermissionDeniedError("只能释放自己负责的客户")
        if await self.repo.get_active_public_pool_entry_by_coverage(coverage.id):
            raise ConflictError("该客户已经在公海池中")
        if await self.repo.coverage_has_active_opportunity(
            customer_id=customer_id,
            owner_user_id=old_owner_user_id,
        ):
            raise ValidationError("该客户已有正式商机，不允许直接释放至公海")
        if await self.repo.coverage_is_cooperating(coverage):
            raise ValidationError("合作中的客户不允许释放至公海")

        region = _normalize_pool_region(customer.region)
        if region not in PUBLIC_POOL_REGIONS:
            raise ValidationError("客户区域必须是华北区、华东区或华南区，才能释放至公海")
        now = china_now()
        entry_id = new_id("pp")
        entry = CrmPublicPoolEntry(
            id=entry_id,
            customer_id=customer_id,
            coverage_id=coverage.id,
            region=region,
            status="available",
            release_reason=release_reason,
            released_by_user_id=old_owner_user_id,
            released_by=old_owner_name,
            released_at=now,
            claimed_by_user_id=None,
            claimed_by=None,
            claimed_at=None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(entry)
        await self._append_pool_follow_up(
            coverage=coverage,
            author=user.name,
            content=f"客户由 {old_owner_name} 释放至公海。释放原因：{release_reason}",
        )
        coverage.owner_user_id = f"pool-{entry_id}"[:36]
        coverage.owner_name = None
        customer.in_public_pool = True
        if customer.owner_user_id == old_owner_user_id:
            customer.owner_user_id = None
            customer.owner = None
        customer.updated_at = now
        await self._create_public_pool_audit(
            user=user,
            customer_id=customer_id,
            company_name=customer.company_name,
            action="释放至公海",
            changes=[
                {"field": "owner", "label": "销售负责人", "before": old_owner_name, "after": "公海池"},
                {"field": "releaseReason", "label": "释放原因", "before": "—", "after": release_reason},
            ],
        )
        await self._commit_and_invalidate_crm(old_owner_user_id)
        return {"id": entry.id, "customerId": customer_id, "status": entry.status}

    async def _reviewer_users(self) -> list[User]:
        reviewer_name = os.getenv("PUBLIC_POOL_REVIEWER_NAME", "海婧").strip() or "海婧"
        reviewer = await UsersRepository(self.db).get_by_name(reviewer_name, active_only=True)
        if reviewer:
            return [reviewer]
        rows = (
            await self.db.execute(
                select(User).where(
                    User.role == "ops",
                    User.employment_status == EMPLOYMENT_ACTIVE,
                )
            )
        ).scalars().all()
        return list(rows)

    async def _create_system_notification(
        self,
        *,
        target: User,
        actor: AuthUser,
        message: str,
        href: str,
    ) -> tuple[str, str]:
        await self.repo.create_notification(
            record_id=f"ntf-pp-{new_id()}"[:64],
            target_name=target.name[:128],
            target_user_id=target.id,
            actor=actor.name[:128],
            actor_user_id=actor.id,
            message=message[:512],
            href=href[:512],
        )
        return target.id, target.name

    async def _send_feishu_text(self, target: User, text: str) -> None:
        if not is_feishu_configured() or not (target.feishu_open_id or "").startswith("ou_"):
            return
        try:
            await feishu_post(
                "/im/v1/messages?receive_id_type=open_id",
                {
                    "receive_id": target.feishu_open_id,
                    "msg_type": "text",
                    "content": json.dumps({"text": text}, ensure_ascii=False),
                },
            )
        except Exception:  # noqa: BLE001 - 飞书失败不回滚已经落库的业务与站内通知
            logger.exception("public pool feishu notification failed target=%s", target.id)

    @staticmethod
    def _public_pool_review_link(href: str) -> str:
        base = (
            os.getenv("PUBLIC_APP_URL")
            or os.getenv("NEXT_PUBLIC_APP_URL")
            or "http://localhost:47821"
        ).strip().rstrip("/")
        return f"{base}{href}"

    async def apply_public_pool_claim(
        self, user: AuthUser, entry_id: str
    ) -> dict[str, Any]:
        self._assert_public_pool_permission(user, "public_pool:claim")
        entry = await self.repo.get_public_pool_entry(entry_id, for_update=True)
        if not entry or entry.status not in PUBLIC_POOL_ACTIVE_STATUSES:
            raise NotFoundError("公海客户不存在或已被认领")
        await self._assert_pool_region_visible(user, entry.region)
        if entry.status == "pending_review":
            raise ConflictError("该客户已有待审核的认领申请")
        await self._assert_sales_customer_capacity(user.id)
        if await self.repo.get_coverage_by_customer_owner(entry.customer_id, user.id):
            raise ConflictError("该客户已在你的客户管理中")
        customer = await self.repo.get_customer(entry.customer_id)
        coverage = await self.repo.get_coverage(entry.coverage_id)
        if not customer or not coverage or not customer.in_public_pool:
            raise ConflictError("公海客户状态已变化，请刷新后重试")

        now = china_now()
        claim = CrmPublicPoolClaim(
            id=new_id("pc"),
            entry_id=entry.id,
            applicant_user_id=user.id,
            applicant_name=user.name,
            status="pending_review",
            review_reason=None,
            reviewer_user_id=None,
            reviewer_name=None,
            applied_at=now,
            reviewed_at=None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(claim)
        entry.status = "pending_review"
        entry.updated_at = now
        reviewers = await self._reviewer_users()
        pushes: list[tuple[str, str]] = []
        message = f"{user.name} 申请认领客户「{customer.company_name}」（{entry.region}），请审核"
        href = f"/public-pool?review={claim.id}"
        for reviewer in reviewers:
            pushes.append(
                await self._create_system_notification(
                    target=reviewer,
                    actor=user,
                    message=message,
                    href=href,
                )
            )
        await self._create_public_pool_audit(
            user=user,
            customer_id=customer.id,
            company_name=customer.company_name,
            action="申请认领",
            changes=[
                {"field": "claimStatus", "label": "认领状态", "before": "可认领", "after": "待审核"},
                {"field": "applicant", "label": "申请销售", "before": "—", "after": user.name},
            ],
        )
        await self.db.commit()
        await self._push_unread_snapshots(pushes)
        for reviewer in reviewers:
            await self._send_feishu_text(
                reviewer,
                f"{message}\n申请时间：{format_legacy_time(now)}\nCRM审核链接：{self._public_pool_review_link(href)}",
            )
        return self._claim_doc(claim) or {}

    async def review_public_pool_claim(
        self,
        user: AuthUser,
        claim_id: str,
        *,
        approved: bool,
        reason: str = "",
    ) -> dict[str, Any]:
        self._assert_public_pool_permission(user, "public_pool:review")
        review_reason = (reason or "").strip()
        if not approved and not review_reason:
            raise ValidationError("审核不通过时必须填写原因")
        claim = await self.repo.get_public_pool_claim(claim_id, for_update=True)
        if not claim:
            raise NotFoundError("认领申请不存在")
        if claim.status != "pending_review":
            raise ConflictError("该认领申请已经审核")
        entry = await self.repo.get_public_pool_entry(claim.entry_id, for_update=True)
        if not entry or entry.status != "pending_review":
            raise ConflictError("公海客户状态已变化，请刷新后重试")
        customer = await self.repo.get_customer(entry.customer_id)
        coverage = await self.repo.get_coverage(entry.coverage_id)
        applicant = await UsersRepository(self.db).get_by_id(claim.applicant_user_id)
        if not customer or not coverage or not applicant or applicant.employment_status != EMPLOYMENT_ACTIVE:
            raise ConflictError("申请销售或客户状态无效，无法完成审核")

        now = china_now()
        pushes: list[tuple[str, str]] = []
        if approved:
            await self._assert_sales_customer_capacity(applicant.id)
            existing = await self.repo.get_coverage_by_customer_owner(customer.id, applicant.id)
            if existing and existing.id != coverage.id:
                raise ConflictError("该客户已经在申请销售的客户管理中")
            coverage.owner_user_id = applicant.id
            coverage.owner_name = applicant.name
            coverage.updated_at = now
            await self._append_pool_follow_up(
                coverage=coverage,
                author=user.name,
                content=f"公海认领审核通过，客户由公海回流至 {applicant.name}。",
            )
            customer.in_public_pool = False
            customer.owner_user_id = applicant.id
            customer.owner = applicant.name
            customer.updated_at = now
            entry.status = "claimed"
            entry.claimed_by_user_id = applicant.id
            entry.claimed_by = applicant.name
            entry.claimed_at = now
            result_message = f"{customer.company_name} 客户认领成功，已进入你的客户管理。"
            action = "认领审核通过"
            after_status = "认领通过"
        else:
            entry.status = "available"
            result_message = (
                f"{customer.company_name} 客户认领未通过。原因：{review_reason}。可重新发起认领。"
            )
            action = "认领审核不通过"
            after_status = "认领未通过"
        entry.updated_at = now
        claim.status = "approved" if approved else "rejected"
        claim.review_reason = review_reason or None
        claim.reviewer_user_id = user.id
        claim.reviewer_name = user.name
        claim.reviewed_at = now
        claim.updated_at = now
        pushes.append(
            await self._create_system_notification(
                target=applicant,
                actor=user,
                message=result_message,
                href=f"/customers/{customer.id}" if approved else "/public-pool",
            )
        )
        await self._create_public_pool_audit(
            user=user,
            customer_id=customer.id,
            company_name=customer.company_name,
            action=action,
            changes=[
                {"field": "claimStatus", "label": "认领状态", "before": "待审核", "after": after_status},
                *(
                    [{"field": "reviewReason", "label": "不通过原因", "before": "—", "after": review_reason}]
                    if not approved
                    else []
                ),
            ],
        )
        await self.db.commit()
        await self._invalidate_crm_read_caches(entry.released_by_user_id, applicant.id)
        await self._push_unread_snapshots(pushes)
        await self._send_feishu_text(applicant, result_message)
        return self._claim_doc(claim) or {}
