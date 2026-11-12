from __future__ import annotations

import json
from uuid import uuid4

from app.modules.crm.service.base import (
    MSG_CONTRACT_SIGN_NEEDS_FILE,
    MSG_CONTRACT_TERMINAL_READONLY,
    OPP_STAGE_LABELS,
    Any,
    AuthUser,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
    _doc,
    _ensure_contract_code,
    _has_contract_file_attachment,
    _normalize_contract_document,
    _normalize_contract_status,
    _normalize_opportunity_document,
    _opp_flow_index,
    forced_geo_source,
    format_legacy_time,
    normalize_opp_stage,
    user_has_permission,
)
from app.modules.users.repository import UsersRepository


PROJECT_MANAGER_LEADERS = frozenset({"演示成员18", "演示成员20", "演示成员19"})


def _can_assign_project_manager(user: AuthUser) -> bool:
    return (user.name or "").strip() in PROJECT_MANAGER_LEADERS or user.role in {
        "admin",
        "super_admin",
    }


def _json_attachment(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, ValueError):
        return None


def _payment_status(planned_amount: float, actual_amount: float, planned_date) -> str:
    from app.core.time_utils import china_now

    if planned_amount > 0 and actual_amount >= planned_amount:
        return "paid"
    if planned_date and planned_date < china_now().date():
        return "overdue"
    if actual_amount > 0:
        return "partial"
    return "pending"


def _payment_plan_response(row, contract: dict[str, Any] | None = None) -> dict[str, Any]:
    planned = float(row.planned_amount or 0)
    actual = float(row.actual_amount or 0)
    doc: dict[str, Any] = {
        "id": row.id,
        "contractId": row.contract_id,
        "periodIndex": row.period_index,
        "periodName": row.period_name,
        "plannedAmount": planned,
        "plannedDate": row.planned_date.isoformat() if row.planned_date else "",
        "invoiceStatus": row.invoice_status or "uninvoiced",
        "invoiceDate": row.invoice_date.isoformat() if row.invoice_date else "",
        "invoiceAmount": float(row.invoice_amount) if row.invoice_amount is not None else None,
        "invoiceAttachment": _json_attachment(row.invoice_attachment),
        "actualPaymentDate": row.actual_payment_date.isoformat() if row.actual_payment_date else "",
        "actualAmount": actual,
        "receiptAttachment": _json_attachment(row.receipt_attachment),
        "paymentStatus": _payment_status(planned, actual, row.planned_date),
        "outstandingAmount": max(planned - actual, 0),
        "createdBy": row.created_by or "",
        "updatedBy": row.updated_by or "",
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "updatedAt": row.updated_at.isoformat() if row.updated_at else "",
    }
    if contract:
        doc.update(
            {
                "contractCode": contract.get("code") or "",
                "contractName": contract.get("name") or "",
                "company": contract.get("company") or "",
                "salesOwner": ", ".join(contract.get("owners") or []) or contract.get("owner") or "",
                "contractAmount": float(contract.get("amount") or 0),
            }
        )
    return doc


_PAYMENT_PLAN_FIELDS = frozenset({"periodIndex", "periodName", "plannedAmount", "plannedDate"})
_PAYMENT_FINANCE_FIELDS = frozenset({
    "invoiceStatus", "invoiceDate", "invoiceAmount", "invoiceAttachment",
    "actualPaymentDate", "actualAmount", "receiptAttachment",
})
_PAYMENT_PERIOD_NAMES = (
    "一期", "二期", "三期", "四期", "五期", "六期",
    "七期", "八期", "九期", "十期", "十一期", "十二期",
)


def _normalize_payment_period_name(value: Any) -> str:
    raw = str(value or "").strip()
    if raw in _PAYMENT_PERIOD_NAMES:
        return raw
    for index, name in enumerate(_PAYMENT_PERIOD_NAMES, start=1):
        if raw in {str(index), f"{index}期", f"第{index}期", f"第 {index} 期"}:
            return name
    raise ValidationError("收款周期请选择一期至十二期")


def _validate_payment_period(data: dict[str, Any], *, default_index: int | None = None) -> int:
    period_name = _normalize_payment_period_name(data.get("periodName"))
    period_index = int(data.get("periodIndex") or default_index or 0)
    if not 1 <= period_index <= len(_PAYMENT_PERIOD_NAMES):
        raise ValidationError("收款周期最多支持十二期")
    expected_index = _PAYMENT_PERIOD_NAMES.index(period_name) + 1
    if period_index != expected_index:
        raise ValidationError("收款周期与期次不一致，请重新选择")
    data["periodName"] = period_name
    data["periodIndex"] = period_index
    return period_index


def _contract_response(
    row,
    *,
    owners: list[str] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """合同响应组装：已列化字段以列为权威源，owners/attachments 读子表，其余从 document 过渡。"""
    doc = _doc(row)
    doc.pop("projectManagerRequestJson", None)
    parsed_manager_request = _contract_manager_request(row)
    if parsed_manager_request:
        doc["projectManagerRequest"] = parsed_manager_request
    for column, key in (
        ("code", "code"),
        ("name", "name"),
        ("company", "company"),
        ("region", "region"),
        ("city", "city"),
        ("geo_source", "geoSource"),
        ("type", "type"),
        ("sign_type", "signType"),
        ("source", "source"),
        ("status_reason", "statusReason"),
        ("project_status", "projectStatus"),
        ("signer", "signer"),
        ("sign_subject", "signSubject"),
        ("our_sign_subject", "ourSignSubject"),
        ("customer_sign_subject", "customerSignSubject"),
        ("signer_manager", "signerManager"),
        ("dept", "dept"),
        ("opportunity_id", "opportunityId"),
        ("owner", "owner"),
    ):
        value = getattr(row, column, None)
        if value is not None:
            doc[key] = value
    amount = getattr(row, "amount", None)
    if amount is not None:
        doc["amount"] = float(amount)
    else:
        # 历史/未填写合同 amount 可能为空：契约统一返回数字，避免前端求和出现 NaN
        try:
            doc["amount"] = float(doc.get("amount") or 0)
        except (TypeError, ValueError):
            doc["amount"] = 0.0
    if getattr(row, "valid_months", None) is not None:
        doc["validMonths"] = int(row.valid_months)
    for column, key in (
        ("effective_date", "effectiveDate"),
        ("dual_sign_date", "dualSignDate"),
        ("end_date", "endDate"),
        ("created_day", "createdAt"),
    ):
        value = getattr(row, column, None)
        if value is not None:
            doc[key] = value.strftime("%Y-%m-%d")
    if getattr(row, "status", None) is not None:
        doc["status"] = row.status
    if owners is not None:
        doc["owners"] = owners
    if attachments is not None:
        doc["attachments"] = attachments
    return doc


def _contract_manager_request(row) -> dict[str, Any]:
    raw_manager_request = getattr(row, "project_manager_request_json", None)
    if not raw_manager_request:
        return {}
    try:
        parsed = json.loads(raw_manager_request)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


class ContractMixin:
    def _assert_payment_view(self, user: AuthUser) -> None:
            if not (
                user_has_permission(user, "payments:view")
                or user_has_permission(user, "section:contracts")
            ):
                raise PermissionDeniedError("无权查看回款计划")

    def _assert_payment_write(self, user: AuthUser, permission: str) -> None:
            allowed = user_has_permission(user, permission)
            if permission == "payments:plan_manage":
                allowed = allowed or user_has_permission(user, "contracts:write") or user_has_permission(user, "contracts:sign")
            elif permission == "payments:finance_edit":
                # 当前未内置财务角色：财务通过权限矩阵获得细码；管理员以设置权限兜底。
                allowed = allowed or user_has_permission(user, "section:settings")
            if not allowed:
                raise PermissionDeniedError("无权维护回款计划")

    async def list_payment_plans(self, user: AuthUser) -> list[dict[str, Any]]:
            self._assert_section(user, "contracts")
            self._assert_payment_view(user)
            contracts = await self.list_contracts(user)
            contract_map = {str(item.get("id") or ""): item for item in contracts}
            rows = await self.repo.list_payment_plans(list(contract_map))
            return [_payment_plan_response(row, contract_map.get(row.contract_id)) for row in rows]

    async def list_contract_payment_plans(
        self, user: AuthUser, contract_id: str
    ) -> list[dict[str, Any]]:
            self._assert_payment_view(user)
            contract = await self.get_contract(user, contract_id)
            rows = await self.repo.list_payment_plans([contract_id])
            return [_payment_plan_response(row, contract) for row in rows]

    async def create_payment_plan(
        self, user: AuthUser, contract_id: str, document: dict[str, Any]
    ) -> dict[str, Any]:
            self._assert_payment_write(user, "payments:plan_manage")
            contract = await self.get_contract(user, contract_id)
            data = dict(document or {})
            if float(data.get("plannedAmount") or 0) <= 0:
                raise ValidationError("计划收款金额必须大于 0")
            if not data.get("plannedDate"):
                raise ValidationError("请选择计划收款时间")
            existing = await self.repo.list_payment_plans([contract_id])
            period_index = int(data.get("periodIndex") or len(existing) + 1)
            _validate_payment_period(data, default_index=period_index)
            if any(item.period_index == period_index for item in existing):
                raise ValidationError("该收款期次已存在")
            data["periodIndex"] = period_index
            if any(data.get(key) not in (None, "", 0, "uninvoiced") for key in _PAYMENT_FINANCE_FIELDS):
                self._assert_payment_write(user, "payments:finance_edit")
            row = await self.repo.create_payment_plan(
                contract_id=contract_id,
                document=data,
                actor_user_id=user.id,
                actor_name=user.name or user.id,
            )
            await self.db.commit()
            return _payment_plan_response(row, contract)

    async def update_payment_plan(
        self, user: AuthUser, payment_plan_id: str, document: dict[str, Any]
    ) -> dict[str, Any]:
            self._assert_payment_view(user)
            row = await self.repo.get_payment_plan(payment_plan_id)
            if not row:
                raise NotFoundError("回款计划不存在")
            contract = await self.get_contract(user, row.contract_id)
            incoming = dict(document or {})
            if _PAYMENT_PLAN_FIELDS.intersection(incoming):
                self._assert_payment_write(user, "payments:plan_manage")
            if _PAYMENT_FINANCE_FIELDS.intersection(incoming):
                self._assert_payment_write(user, "payments:finance_edit")
            if "periodName" in incoming:
                _validate_payment_period(incoming, default_index=row.period_index)
            elif "periodIndex" in incoming:
                period_index = int(incoming.get("periodIndex") or 0)
                if not 1 <= period_index <= len(_PAYMENT_PERIOD_NAMES):
                    raise ValidationError("收款周期最多支持十二期")
                if period_index != row.period_index:
                    raise ValidationError("收款周期与期次不一致，请重新选择")
            if "plannedAmount" in incoming and float(incoming.get("plannedAmount") or 0) <= 0:
                raise ValidationError("计划收款金额必须大于 0")
            if "plannedDate" in incoming and not incoming.get("plannedDate"):
                raise ValidationError("请选择计划收款时间")
            row = await self.repo.save_payment_plan(row, incoming, actor_name=user.name or user.id)
            await self.db.commit()
            return _payment_plan_response(row, contract)

    async def delete_payment_plan(self, user: AuthUser, payment_plan_id: str) -> None:
            self._assert_payment_write(user, "payments:plan_manage")
            row = await self.repo.get_payment_plan(payment_plan_id)
            if not row:
                raise NotFoundError("回款计划不存在")
            await self.get_contract(user, row.contract_id)
            await self.repo.delete_payment_plan(row)
            await self.db.commit()

    async def list_contracts(self, user: AuthUser) -> list[dict[str, Any]]:
            self._assert_section(user, "contracts")
            owners = await self._owner_filter(user)
            rows = await self.repo.list_contracts(
                owners, include_unassigned=self._include_unassigned(user)
            )
            # 客户成功 Leader 需要在合同管理中看到待分配申请，即使合同归属于销售团队。
            if owners is not None and _can_assign_project_manager(user):
                visible_ids = {row.id for row in rows}
                all_rows = await self.repo.list_contracts(None, include_unassigned=True)
                rows.extend(
                    row
                    for row in all_rows
                    if row.id not in visible_ids
                    and str(
                        _contract_manager_request(row).get("status")
                        or ""
                    )
                    == "pending"
                )
            # 列表只做响应规范化，不在 GET 路径回写 MySQL（否则千级合同会拖慢首屏）
            result: list[dict[str, Any]] = []
            owners_map = await self.repo.list_contract_owners([r.id for r in rows])
            attachments_map = await self.repo.list_contract_attachments([r.id for r in rows])
            for row in rows:
                doc = _contract_response(
                    row,
                    owners=owners_map.get(row.id),
                    attachments=attachments_map.get(row.id),
                )
                status = _normalize_contract_status(doc.get("status"))
                if status != str(doc.get("status") or ""):
                    doc = {**doc, "status": status}
                result.append(doc)
            forced = forced_geo_source(user)
            if forced:
                return await self._filter_contract_docs_by_geo(result, forced)
            return result

    async def get_contract(self, user: AuthUser, contract_id: str) -> dict[str, Any]:
            self._assert_section(user, "contracts")
            row = await self.repo.get_contract(contract_id)
            if not row:
                raise NotFoundError("合同不存在")
            leader_handling_request = (
                _can_assign_project_manager(user)
                and str(_contract_manager_request(row).get("status") or "") == "pending"
            )
            if not leader_handling_request:
                await self._assert_row_access(user, row.owner_user_id)
            owners_map = await self.repo.list_contract_owners([contract_id])
            attachments = await self.repo.get_contract_attachments(contract_id)
            doc = _contract_response(
                row,
                owners=owners_map.get(contract_id),
                attachments=attachments,
            )
            status = _normalize_contract_status(doc.get("status"))
            if status != str(doc.get("status") or ""):
                doc = {**doc, "status": status}
            entity_geo = await self._resolve_contract_geo(doc)
            if not leader_handling_request:
                self._assert_geo_access(user, entity_geo)
            return {**doc, "geoSource": entity_geo}

    async def create_contract(self, user: AuthUser, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "contracts")
            self._assert_contract_write(user, "contracts:create")
            from app.modules.projects.service import ProjectsService, should_ensure_project

            document = _normalize_contract_document(_ensure_contract_code(dict(document or {})))
            if "attachments" not in document or not isinstance(document.get("attachments"), list):
                document["attachments"] = []
            if "owners" not in document or not isinstance(document.get("owners"), list):
                owner = str(document.get("owner") or user.name or "").strip()
                document["owners"] = [owner] if owner else []
            document = await self._stamp_contract_geo(document, user)
            if _normalize_contract_status(document.get("status")) == "signed" and not _has_contract_file_attachment(
                document.get("attachments")
            ):
                raise ValidationError(MSG_CONTRACT_SIGN_NEEDS_FILE)
            row = await self.repo.create_contract(document=document, owner_user_id=user.id)
            doc = _contract_response(
                row,
                owners=(await self.repo.list_contract_owners([row.id])).get(row.id),
                attachments=await self.repo.get_contract_attachments(row.id),
            )
            updated_opp, opp_owner = (None, None)
            if _normalize_contract_status(doc.get("status")) == "signed":
                updated_opp, opp_owner = await self._advance_opportunity_won_for_signed_contract(doc)
            if should_ensure_project(None, doc, is_create=True):
                await ProjectsService(self.db).ensure_from_contract_document(
                    doc, actor=user.name or user.id, commit=False
                )
            await self._commit_and_invalidate_crm(user.id, opp_owner)
            owners_map = await self.repo.list_contract_owners([row.id])
            attachments = await self.repo.get_contract_attachments(row.id)
            result = _contract_response(
                row,
                owners=owners_map.get(row.id),
                attachments=attachments,
            )
            if updated_opp:
                result = {**result, "_updatedOpportunity": updated_opp}
            return result

    async def update_contract(self, user: AuthUser, contract_id: str, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "contracts")
            from app.modules.projects.service import ProjectsService, should_ensure_project

            row = await self.repo.get_contract(contract_id)
            if not row:
                raise NotFoundError("合同不存在")
            incoming = dict(document or {})
            incoming_manager_request = incoming.get("projectManagerRequest")
            leader_assignment_only = (
                set(incoming) == {"projectManagerRequest"}
                and isinstance(incoming_manager_request, dict)
                and str(incoming_manager_request.get("status") or "") == "assigned"
                and _can_assign_project_manager(user)
            )
            if not leader_assignment_only:
                self._assert_contract_write(user, "contracts:sign")
                await self._assert_row_access(user, row.owner_user_id)
            prev_attachments = await self.repo.get_contract_attachments(contract_id)
            prev_owners = (await self.repo.list_contract_owners([contract_id])).get(contract_id)
            prev = _contract_response(row, owners=prev_owners, attachments=prev_attachments)
            prev_geo = await self._resolve_contract_geo(prev)
            if not leader_assignment_only:
                self._assert_geo_access(user, prev_geo)
            document = _normalize_contract_document({**prev, **incoming})
            if not leader_assignment_only:
                document = await self._stamp_contract_geo(document, user)
            prev_status = _normalize_contract_status(prev.get("status"))
            new_status = _normalize_contract_status(document.get("status"))
            if prev_status in ("void", "terminated") and any(
                key != "attachments" for key in incoming
            ):
                raise ValidationError(MSG_CONTRACT_TERMINAL_READONLY)
            becoming_signed = new_status == "signed" and prev_status != "signed"
            if becoming_signed:
                attachments = document.get("attachments")
                if attachments is None:
                    attachments = prev.get("attachments")
                if not _has_contract_file_attachment(attachments):
                    raise ValidationError(MSG_CONTRACT_SIGN_NEEDS_FILE)
            previous_request = prev.get("projectManagerRequest") if isinstance(prev.get("projectManagerRequest"), dict) else {}
            current_request = document.get("projectManagerRequest") if isinstance(document.get("projectManagerRequest"), dict) else {}
            previous_request_status = str(previous_request.get("status") or "")
            current_request_status = str(current_request.get("status") or "")
            assigned_manager_user = None
            if current_request_status == "assigned" and previous_request_status != "assigned":
                if not _can_assign_project_manager(user):
                    raise PermissionDeniedError("仅演示成员18、演示成员20、演示成员19或管理员可分配项目经理")
                if previous_request_status != "pending":
                    raise ValidationError("请先由销售提交项目经理申请，再进行分配")
                manager_name = str(current_request.get("projectManager") or "").strip()
                if not manager_name:
                    raise ValidationError("请选择项目经理")
                users_repo = UsersRepository(self.db)
                assigned_manager_user = await users_repo.get_by_name(manager_name, active_only=True)
                if not assigned_manager_user:
                    raise ValidationError("所选项目经理不在当前在职通讯录中")
                if (user.name or "").strip() in PROJECT_MANAGER_LEADERS:
                    managed_ids = set(await users_repo.get_managed_scope_user_ids(user.id))
                    managed_ids.discard(user.id)
                    if assigned_manager_user.id not in managed_ids:
                        raise PermissionDeniedError("只能分配当前 Leader 管辖范围内的下属")
            row = await self.repo.save_contract(row, document)
            doc = _contract_response(
                row,
                owners=(await self.repo.list_contract_owners([row.id])).get(row.id),
                attachments=await self.repo.get_contract_attachments(row.id),
            )
            updated_opp, opp_owner = (None, None)
            if becoming_signed:
                updated_opp, opp_owner = await self._advance_opportunity_won_for_signed_contract(doc)
            if should_ensure_project(prev, doc, is_create=False):
                await ProjectsService(self.db).ensure_from_contract_document(
                    doc, actor=user.name or user.id, commit=False
                )
            if current_request_status == "pending" and previous_request_status != "pending":
                for leader_name in ("演示成员18", "演示成员20", "演示成员19"):
                    await self.repo.create_notification(
                        record_id=f"ntf-pm-request-{uuid4().hex}",
                        target_name=leader_name,
                        target_user_id=None,
                        actor=user.name or user.id,
                        actor_user_id=user.id,
                        message=f"{current_request.get('applicant') or user.name}申请项目经理提前介入合同「{doc.get('name') or contract_id}」，请分配",
                        href=f"/contracts/{contract_id}",
                    )
            if current_request_status == "assigned" and previous_request_status != "assigned":
                project = await ProjectsService(self.db).ensure_from_contract_document(
                    doc, actor=user.name or user.id, commit=False
                )
                if project:
                    project.project_manager = str(current_request.get("projectManager") or "").strip()
                    project.project_manager_user_id = assigned_manager_user.id if assigned_manager_user else None
                    project.planned_start_date = ProjectsService._parse_date(current_request.get("requestedStartDate")) or project.planned_start_date
                    project.updated_by = user.name or user.id
                applicant = str(current_request.get("applicant") or "").strip()
                if applicant:
                    await self.repo.create_notification(
                        record_id=f"ntf-pm-assigned-{uuid4().hex}",
                        target_name=applicant,
                        target_user_id=None,
                        actor=user.name or user.id,
                        actor_user_id=user.id,
                        message=f"合同「{doc.get('name') or contract_id}」已分配项目经理：{current_request.get('projectManager') or '—'}，待启动项目已创建",
                        href=f"/projects/{project.id}" if project else f"/contracts/{contract_id}",
                    )
            await self._commit_and_invalidate_crm(user.id, row.owner_user_id, opp_owner)
            result = _contract_response(
                row,
                owners=(await self.repo.list_contract_owners([row.id])).get(row.id),
                attachments=await self.repo.get_contract_attachments(row.id),
            )
            if updated_opp:
                result = {**result, "_updatedOpportunity": updated_opp}
            return result

    async def _advance_opportunity_won_for_signed_contract(
            self, contract: dict[str, Any]
        ) -> tuple[dict[str, Any] | None, str | None]:
            """合同首次变为已签订时，将关联商机自动推进至「已签订」。"""
            opp_id = str(contract.get("opportunityId") or "").strip()
            if not opp_id:
                return None, None
            row = await self.repo.get_opportunity(opp_id)
            if not row:
                return None, None
            doc = await self._compose_opportunity(row)
            prev_stage = normalize_opp_stage(str(doc.get("stage") or row.stage or "contact"))
            if prev_stage in ("won", "lost"):
                return None, None

            changed_at = format_legacy_time()
            history = list(doc.get("stageHistory") or [])
            if history and isinstance(history[-1], dict) and not history[-1].get("leftAt"):
                history[-1] = {**history[-1], "leftAt": changed_at}

            code = str(contract.get("code") or "").strip()
            name = str(contract.get("name") or "").strip()
            label = code or name
            code_part = f"「{label}」" if label else ""
            reason = (
                f"关联合同{code_part}已完成签署，"
                f"系统自动推进至「{OPP_STAGE_LABELS.get('won', '已签订')}」"
            )

            prev_idx = _opp_flow_index(prev_stage)
            signing_idx = _opp_flow_index("signing")
            if prev_idx >= 0 and prev_idx < signing_idx:
                history.append(
                    {
                        "stage": "signing",
                        "enteredAt": changed_at,
                        "leftAt": changed_at,
                        "reason": (
                            f"关联合同{code_part}已完成签署，"
                            f"「{OPP_STAGE_LABELS.get('signing', '签署中')}」随签订一并完成"
                        ),
                        "changeType": "advance",
                    }
                )

            history.append(
                {
                    "stage": "won",
                    "enteredAt": changed_at,
                    "reason": reason,
                    "changeType": "advance",
                }
            )
            doc = _normalize_opportunity_document(
                {
                    **doc,
                    "stage": "won",
                    "lastFollowAt": changed_at,
                    "stageHistory": history,
                    "requestIds": self.normalize_request_ids(doc.get("requestIds")),
                }
            )
            row = await self.repo.save_opportunity(row, doc)
            return await self._compose_opportunity(row), (row.owner_user_id or None)
