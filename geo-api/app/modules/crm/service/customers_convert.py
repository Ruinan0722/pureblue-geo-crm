from __future__ import annotations

from datetime import date
from typing import Any

from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.time_utils import format_legacy_time
from app.modules.auth.schemas import AuthUser
from app.modules.crm.repository import (
    company_name_match_kind,
    new_id,
)
from app.modules.crm.service.base import (
    _MATCH_TYPE_RANK,
    _carry_lead_attachments_to_customer,
    _carry_lead_notes_to_customer,
    _carry_lead_requirement_to_customer,
    _carry_mark_materials_to_customer,
    _coverage_doc_with_children,
    _customer_match_summary,
    _doc,
    _lead_wechat_added,
    _merge_lead_into_existing_customer,
    _sort_match_items,
    _strip_customer_master_document,
)
from app.modules.crm.service.leads import _lead_response


class CustomerConvertMixin:
    async def _collect_convert_candidates(
            self,
            user: AuthUser,
            *,
            company_name: str,
            credit_code: str,
            include_partial: bool,
        ) -> tuple[list[dict[str, Any]], int]:
            """收集转客户候选（公司主档全局可见，决策 12；hidden 恒为 0）。"""
            # 主档查重不按对接池过滤
            owners = None
            ranked: dict[str, tuple[Any, str]] = {}

            def upsert(row, match_type: str) -> None:
                prev = ranked.get(row.id)
                if prev is None or _MATCH_TYPE_RANK.get(match_type, 9) < _MATCH_TYPE_RANK.get(prev[1], 9):
                    ranked[row.id] = (row, match_type)

            if credit_code:
                for r in await self.repo.find_customers_by_credit_code(credit_code, owners):
                    upsert(r, "credit")
            if company_name:
                for r in await self.repo.find_customers_by_company_name_key(company_name, owners):
                    upsert(r, "exact")
                if include_partial:
                    for r in await self.repo.find_customers_by_company_name_partial(company_name, owners):
                        kind = company_name_match_kind(
                            company_name,
                        str(_doc(r).get("companyName") or r.company_name or "")
                            or r.company_name
                            or "",
                        )
                        if kind == "partial":
                            upsert(r, "partial")

            items = [
                _customer_match_summary(row, match_type=match_type) for row, match_type in ranked.values()
            ]
            items = _sort_match_items(items, credit_code)
            # 决策 12：同名主档对销售可见，不再用 hidden 拦截
            return items, 0

    async def convert_lead_candidates(self, user: AuthUser, lead_id: str) -> dict[str, Any]:
            """打开生成客户弹窗：返回可见同名/同信用代码/部分重名候选，及不可见精确同名数量。"""
            self._assert_section(user, "leads")
            row = await self.repo.get_lead(lead_id)
            if not row:
                raise NotFoundError("线索不存在")
            await self._assert_row_access(
                user,
                row.owner_user_id,
                lead_pool=True,
                lead_sdr_name=getattr(row, "sdr", None),
            )
            lead = _lead_response(row, **(await self.repo.get_lead_children(row.id)))
            company_name = str(lead.get("companyName") or "").strip()
            credit_code = str(lead.get("creditCode") or "").strip()

            items, hidden = await self._collect_convert_candidates(
                user,
                company_name=company_name,
                credit_code=credit_code,
                include_partial=True,
            )

            return {
                "items": items,
                "hidden_match_count": hidden,
                "company_name": company_name,
                "credit_code": credit_code,
            }

    async def customer_create_candidates(
            self,
            user: AuthUser,
            *,
            company_name: str = "",
            credit_code: str = "",
        ) -> dict[str, Any]:
            """自拓建档查重：主档全局同名/同信用代码/部分重名候选，与「生成客户」检索一致。"""
            self._assert_section(user, "customers")
            self._assert_customer_write(user, "customers:create")
            company_name = str(company_name or "").strip()
            credit_code = str(credit_code or "").strip()
            items, hidden = await self._collect_convert_candidates(
                user,
                company_name=company_name,
                credit_code=credit_code,
                include_partial=True,
            )
            return {
                "items": items,
                "hidden_match_count": hidden,
                "company_name": company_name,
                "credit_code": credit_code,
            }

    async def convert_lead(
            self,
            user: AuthUser,
            lead_id: str,
            *,
            mode: str = "create",
            customer_id: str | None = None,
            sales: str | None = None,
        ) -> dict[str, dict[str, Any]]:
            self._assert_section(user, "leads")
            self._assert_lead_write(user, "leads:convert")
            # 转客户是线索流程的一部分，不额外要求 customers:write

            row = await self.repo.get_lead(lead_id)
            if not row:
                raise NotFoundError("线索不存在")
            await self._assert_row_access(
                user,
                row.owner_user_id,
                lead_pool=True,
                lead_sdr_name=getattr(row, "sdr", None),
            )

            if getattr(row, "lead_type", None) == "channel":
                raise ValidationError("渠道线索请通过「转渠道商」处理")
            lead_children = await self.repo.get_lead_children(row.id)
            lead = _lead_response(row, **lead_children)
            mark_files = []
            import_meta = lead.get("importMeta") if isinstance(lead.get("importMeta"), dict) else {}
            if import_meta.get("platform") == "mark":
                from app.modules.mark_integration.repository import MarkIntegrationRepository

                mark_files = await MarkIntegrationRepository(self.db).list_files_by_lead(row.id)
            lead["markMaterials"] = [
                {
                    "id": item.id,
                    "fileName": item.original_name,
                    "size": int(item.size or item.expected_size or 0),
                    "status": item.download_status,
                    "generatedAt": item.generated_at.isoformat() if item.generated_at else None,
                    "uploadedAt": item.uploaded_at.isoformat() if item.uploaded_at else None,
                }
                for item in mark_files
            ]
            if sales is not None:
                sales_val = str(sales).strip()
                if sales_val:
                    lead = {**lead, "sales": sales_val}

            if lead.get("convertedCustomerId"):
                customer_row = await self.repo.get_customer(str(lead["convertedCustomerId"]))
                if customer_row:
                    owners = await self._owner_filter(user)
                    coverages = await self.repo.list_coverages_for_customer(
                        customer_row.id, owner_ids=owners
                    )
                    return {
                        "lead": _lead_response(
                            row, **(await self.repo.get_lead_children(row.id))
                        ),
                        "customer": await self._compose_customer_view_async(
                            user, customer_row, coverages
                        ),
                    }

            mode_norm = (mode or "create").strip().lower()
            if mode_norm == "link":
                return await self._convert_lead_link(user, row, lead, lead_id, customer_id=customer_id)
            if mode_norm != "create":
                raise ValidationError("无效的转客户模式")
            return await self._convert_lead_create(user, row, lead, lead_id)

    async def _raise_if_company_conflict(self, user: AuthUser, lead: dict[str, Any]) -> None:
            """新建前再次查重；仅 credit/exact 拦截（主档全局），不含 partial。"""
            company_name = str(lead.get("companyName") or "").strip()
            credit_code = str(lead.get("creditCode") or "").strip()
            items, _hidden = await self._collect_convert_candidates(
                user,
                company_name=company_name,
                credit_code=credit_code,
                include_partial=False,
            )
            hard = [it for it in items if it.get("matchType") in ("credit", "exact")]
            if not hard:
                return
            raise ConflictError(
                "该公司已存在客户档案，请关联公司并建立我的对接，勿重复新建",
                payload={
                    "reason": "company_exists",
                    "candidates": hard,
                    "hiddenMatchCount": 0,
                },
            )

    async def _convert_lead_link(
            self,
            user: AuthUser,
            row,
            lead: dict[str, Any],
            lead_id: str,
            *,
            customer_id: str | None,
        ) -> dict[str, dict[str, Any]]:
            cid = str(customer_id or "").strip()
            if not cid:
                raise ValidationError("请选择要挂靠的已有客户")
            customer_row = await self.repo.get_customer(cid)
            if not customer_row:
                raise NotFoundError("客户不存在")
            # 决策 12：挂靠只要求可关联主档，不要求已有本人池；SDR 允许转客户关联
            await self._assert_customer_linkable_for_convert(user, customer_row)

            today = date.today().isoformat()
            sales_name = str(lead.get("sales") or "").strip()
            owner_name = sales_name if sales_name and sales_name not in ("未分配", "待分配") else user.name
            owner_user_id = await self._resolve_owner_user_id(user, owner_name)
            await self._assert_assignable_owner(user, owner_user_id)
            existing_owner_coverage = await self.repo.get_coverage_by_customer_owner(
                cid, owner_user_id
            )
            if existing_owner_coverage is None:
                await self._assert_sales_customer_capacity(owner_user_id)

            seed = {
                "contacts": [],
                "notes": [],
                "attachments": [],
                "status": "connected",
                "sourceLeadId": lead_id,
                "sdrName": str(lead.get("sdr") or user.name or ""),
                "sdrTransferDate": today,
                "ownerName": owner_name,
            }
            coverage, _created = await self._get_or_create_coverage(
                customer_id=cid,
                owner_user_id=owner_user_id,
                owner_name=owner_name,
                seed=seed,
                status="connected",
                ensure_leaders=False,
            )
            cov_children = await self.repo.list_coverage_children([coverage.id])
            cov_doc = _coverage_doc_with_children(
                _doc(coverage),
                cov_children.get(coverage.id) or {},
            )
            cov_doc = _merge_lead_into_existing_customer(cov_doc, lead=lead, lead_id=lead_id)
            if not cov_doc.get("sourceLeadId"):
                cov_doc["sourceLeadId"] = lead_id
            if not cov_doc.get("sdrTransferDate"):
                cov_doc["sdrTransferDate"] = today
            if not cov_doc.get("ownerName"):
                cov_doc["ownerName"] = owner_name
            coverage = await self.repo.save_coverage(coverage, cov_doc, status=str(cov_doc.get("status") or "connected"))

            # 主档仅补溯源，不合并联系人
            customer_doc = _strip_customer_master_document(_doc(customer_row))
            customer_doc["subsidiaries"] = await self.repo.list_customer_subsidiaries(customer_row.id)
            if not customer_doc.get("sourceLeadId"):
                customer_doc["sourceLeadId"] = lead_id
            if not customer_doc.get("sdrTransferDate"):
                customer_doc["sdrTransferDate"] = today
            if not customer_doc.get("sdr") and (lead.get("sdr") or user.name):
                customer_doc["sdr"] = lead.get("sdr") or user.name
            if not customer_doc.get("sdrUserId"):
                customer_doc["sdrUserId"] = row.owner_user_id
            if not customer_doc.get("createdByUserId"):
                customer_doc["createdByUserId"] = user.id
            customer_row = await self.repo.save_customer(customer_row, customer_doc)

            await self.repo.append_related_entity_to_audits(
                source_entity_id=lead_id,
                related_entity_id=cid,
            )
            lead = {
                **lead,
                "status": "converted",
                "followState": "converted",
                "transferDate": today,
                "convertedCustomerId": cid,
                "convertedCoverageId": coverage.id,
            }
            row = await self.repo.save_lead(row, lead)
            await self._commit_and_invalidate_crm(user.id, row.owner_user_id, owner_user_id)
            view = await self._compose_customer_view_async(
                user,
                customer_row,
                [] if self._is_sdr_role(user) else [coverage],
            )
            return {
                "lead": _lead_response(row, **(await self.repo.get_lead_children(row.id))),
                "customer": view,
            }

    async def _convert_lead_create(
            self,
            user: AuthUser,
            row,
            lead: dict[str, Any],
            lead_id: str,
        ) -> dict[str, dict[str, Any]]:
            await self._raise_if_company_conflict(user, lead)

            today = date.today().isoformat()
            customer_id = new_id("c")
            notes = lead.get("notes") or []
            carried_notes = _carry_lead_notes_to_customer(notes, lead_id=lead_id)
            requirement_note = _carry_lead_requirement_to_customer(lead, lead_id=lead_id)
            if requirement_note:
                carried_notes.insert(0, requirement_note)
            carried_attachments = _carry_lead_attachments_to_customer(lead.get("attachments") or [], lead_id=lead_id)
            carried_attachments.extend(
                _carry_mark_materials_to_customer(lead.get("markMaterials") or [], lead_id=lead_id)
            )
            last_follow_at = ""
            if carried_notes:
                last_follow_at = str(carried_notes[-1].get("date") or "")
            sales_name = str(lead.get("sales") or "").strip()
            owner_name = sales_name if sales_name and sales_name not in ("未分配", "待分配") else user.name
            owner_user_id = await self._resolve_owner_user_id(user, owner_name)
            await self._assert_assignable_owner(user, owner_user_id)
            await self._assert_sales_customer_capacity(owner_user_id)

            customer_doc: dict[str, Any] = {
                "id": customer_id,
                "companyUid": f"CUS-{date.today().year}-{customer_id[-4:].upper()}",
                "companyName": lead.get("companyName") or "",
                "brandName": str(lead.get("brandName") or "").strip() or str(lead.get("companyName") or ""),
                "region": lead.get("region") or "",
                "city": lead.get("city") or "",
                "industryL1": "",
                "industryL2": "",
                "foundedDate": "",
                "creditCode": str(lead.get("creditCode") or "").strip(),
                "registeredCapital": 0,
                "annualRevenue": 0,
                "scale": "",
                "nature": "",
                "sdr": lead.get("sdr") or user.name,
                "sdrUserId": row.owner_user_id,
                "createdByUserId": user.id,
                "sourceLeadId": lead_id,
                "sdrTransferDate": today,
                "source": lead.get("source") or "",
                "sourceDetail": lead.get("sourceDetail") or "",
                "website": lead.get("website") or "",
                "createdAt": today,
                "subsidiaries": [],
                "migrationStatus": "done",
                "isolationVersion": 1,
            }
            # 兼容列：保留 owner_user_id / status 作过渡 denorm
            customer_row = await self.repo.create_customer(
                document={**customer_doc, "status": "connected", "owner": owner_name},
                owner_user_id=owner_user_id,
            )
            coverage_seed = {
                "ownerName": owner_name,
                "status": "connected",
                "contacts": [
                    {
                        "id": new_id("ct"),
                        "name": lead.get("contactName") or "",
                        "title": lead.get("contactTitle") or "",
                        "phone": str(lead.get("contactPhone") or "").strip(),
                        "email": lead.get("email") or "",
                        "wechat": str(lead.get("contactWechat") or "").strip(),
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": _lead_wechat_added(lead, notes),
                        "createdAt": format_legacy_time(),
                        "status": "awaiting_contact",
                        "source": str(lead.get("source") or "").strip(),
                        "sourceDetail": str(lead.get("sourceDetail") or "").strip(),
                        "sourceLeadId": lead_id,
                    }
                ],
                "notes": carried_notes,
                "attachments": carried_attachments,
                "lastFollowAt": last_follow_at,
                "sourceLeadId": lead_id,
                "sdrName": str(lead.get("sdr") or user.name or ""),
                "sdrTransferDate": today,
            }
            coverage, _ = await self._get_or_create_coverage(
                customer_id=customer_id,
                owner_user_id=owner_user_id,
                owner_name=owner_name,
                seed=coverage_seed,
                status="connected",
                ensure_leaders=False,
            )
            await self.repo.append_related_entity_to_audits(
                source_entity_id=lead_id,
                related_entity_id=customer_id,
            )
            lead = {
                **lead,
                "status": "converted",
                "followState": "converted",
                "transferDate": today,
                "convertedCustomerId": customer_id,
                "convertedCoverageId": coverage.id,
            }
            row = await self.repo.save_lead(row, lead)
            await self._commit_and_invalidate_crm(user.id, row.owner_user_id, owner_user_id)
            view = await self._compose_customer_view_async(
                user,
                customer_row,
                [] if self._is_sdr_role(user) else [coverage],
            )
            return {
                "lead": _lead_response(row, **(await self.repo.get_lead_children(row.id))),
                "customer": view,
            }
