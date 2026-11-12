from __future__ import annotations

from uuid import uuid4
from app.modules.channel_management.unified_opportunities import (
    stamp_partner_opportunity, ensure_partner_contract, record_partner_opportunity_event,
)

from app.core.exceptions import ConflictError
from app.modules.crm.service.base import (
    MSG_OPP_NO_ROLLBACK_TO_CONTACT,
    OPP_STAGE_LABELS,
    Any,
    AuthUser,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
    _doc,
    _normalize_opportunity_document,
    _opp_flow_index,
    _opportunity_response,
    date,
    forced_geo_source,
    format_legacy_time,
    new_id,
    normalize_opp_stage,
    user_has_permission,
)


class OpportunityMixin:
    _PROJECT_MANAGER_LEADERS = frozenset({"演示成员18", "演示成员20", "演示成员19"})

    async def _compose_opportunity(self, row) -> dict[str, Any]:
            """唯一商机 compose：标量以列/_response 为准，集合一律来自子表。"""
            children = await self.repo.get_opportunity_children(row.id)
            return _opportunity_response(row, **children)

    async def list_opportunities(self, user: AuthUser) -> list[dict[str, Any]]:
            self._assert_section(user, "opportunities")
            owners = await self._owner_filter(user)
            rows = await self.repo.list_opportunities(
                owners, include_unassigned=self._include_unassigned(user)
            )
            children_map = await self.repo.list_opportunity_children([r.id for r in rows])
            docs = [
                _opportunity_response(
                    r,
                    **children_map.get(
                        r.id,
                        {
                            "stageHistory": None,
                            "attachments": None,
                            "projectTypes": None,
                            "requestIds": None,
                            "notes": None,
                            "advisorNotes": None,
                        },
                    ),
                )
                for r in rows
            ]
            forced = forced_geo_source(user)
            if forced:
                return await self._filter_opportunity_docs_by_geo(docs, forced)
            return docs

    async def get_opportunity(self, user: AuthUser, opportunity_id: str) -> dict[str, Any]:
            self._assert_section(user, "opportunities")
            row = await self.repo.get_opportunity(opportunity_id)
            if not row:
                raise NotFoundError("商机不存在")
            doc = await self._compose_opportunity(row)
            request = doc.get("projectManagerRequest") if isinstance(doc.get("projectManagerRequest"), dict) else {}
            leader_handling_request = (
                ((user.name or "").strip() in self._PROJECT_MANAGER_LEADERS or user.role in {"admin", "super_admin"})
                and str(request.get("status") or "") == "pending"
            )
            if not leader_handling_request:
                await self._assert_row_access(user, row.owner_user_id)
            geo = await self._resolve_opportunity_geo(doc)
            if not leader_handling_request:
                self._assert_geo_access(user, geo)
            return {**doc, "geoSource": geo}

    async def create_opportunity(self, user: AuthUser, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "opportunities")
            self._assert_opportunity_write(user, "opportunities:create")
            if not document.get("customerId") and not document.get("partnerId"):
                raise ValidationError("缺少客户或合作伙伴 ID")
            if document.get("stage") not in {None, "", "contact"}:
                raise ValidationError("新商机必须从初步接触开始")
            # Ignore caller-supplied IDs; legacy IDs are copied only by the migration.
            document = {key: value for key, value in document.items() if key != "id"}
            document, owner_user_id = await stamp_partner_opportunity(self.db, user, document)
            document["geoSource"] = forced_geo_source(user) or "manual"
            if document.get("requestIds"):
                raise ValidationError("需求与商机绑定功能已取消")
            seeded = {
                **document,
                "requestIds": self.normalize_request_ids(document.get("requestIds")),
            }
            for key in ("projectTypes", "notes", "advisorNotes", "attachments", "stageHistory"):
                if key not in seeded or not isinstance(seeded.get(key), list):
                    seeded[key] = []
            document = _normalize_opportunity_document(seeded)
            document = await self._stamp_opportunity_geo(document, user)
            # 统一命名查重：同一客户下已存在同名（未输单）商机时禁止重复创建，
            # 避免同一客户下出现无法区分的同名商机。
            if document.get("partnerId"):
                dup = await self.repo.find_active_opportunity_by_partner_name(str(document["partnerId"]), str(document.get("name") or "").strip())
            else:
                dup = await self.repo.find_active_opportunity_by_customer_name(
                    str(document.get("customerId") or "").strip(),
                    str(document.get("name") or "").strip(),
                )
            if dup is not None:
                raise ConflictError(
                    f"已存在同名商机「{document.get('name') or ''}」，请按命名规范修改商机名称后重试"
                )
            row = await self.repo.create_opportunity(document=document, owner_user_id=owner_user_id)
            await record_partner_opportunity_event(self, user, row, document, "opportunity_created")
            await self._commit_and_invalidate_crm(user.id)
            refreshed = await self.repo.get_opportunity(row.id) or row
            return await self._compose_opportunity(refreshed)

    async def update_opportunity(self, user: AuthUser, opportunity_id: str, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "opportunities")
            if document.get("requestIds"):
                raise ValidationError("需求与商机绑定功能已取消")
            incoming_manager_request = document.get("projectManagerRequest") if isinstance(document.get("projectManagerRequest"), dict) else None
            # 售前顾问可写顾问反馈；普通写权限覆盖全量字段
            can_write = user_has_permission(user, "opportunities:write") or any(
                user_has_permission(user, c)
                for c in ("opportunities:create", "opportunities:stage")
            )
            can_advise = user_has_permission(user, "opportunities:advisor")
            can_assign_advisor = user_has_permission(user, "opportunities:assign_advisor")
            can_assign_project_manager = (
                (user.name or "").strip() in self._PROJECT_MANAGER_LEADERS
                or user.role in {"admin", "super_admin"}
            )
            if not can_write and not can_advise and not can_assign_advisor and not can_assign_project_manager:
                raise PermissionDeniedError()
            if can_write:
                # 推进/输单/编辑走细码 opportunities:stage（或遗留 opportunities:write）
                self._assert_opportunity_write(user, "opportunities:stage")
            row = await self.repo.get_opportunity_for_update(opportunity_id)
            if not row:
                raise NotFoundError("商机不存在")
            prev_doc_early = await self._compose_opportunity(row)
            for key in ("businessType", "partnerId", "partnerName", "customerId"):
                if key in document and document[key] != prev_doc_early.get(key):
                    raise ValidationError("商机来源和关联主体不能通过编辑接口更换")
            if "geoSource" in document and document["geoSource"] != prev_doc_early.get("geoSource"):
                raise ValidationError("商机业务归属不能通过编辑接口更换")
            previous_manager_request = prev_doc_early.get("projectManagerRequest") if isinstance(prev_doc_early.get("projectManagerRequest"), dict) else {}
            leader_handling_request = (
                ((user.name or "").strip() in self._PROJECT_MANAGER_LEADERS or user.role in {"admin", "super_admin"})
                and str(previous_manager_request.get("status") or "") == "pending"
            )
            if not leader_handling_request:
                await self._assert_row_access(user, row.owner_user_id)
                self._assert_geo_access(user, await self._resolve_opportunity_geo(prev_doc_early))
            manager_request_action = None
            assigned_manager_user = None
            if incoming_manager_request is not None:
                requested_status = str(incoming_manager_request.get("status") or "")
                current_stage = normalize_opp_stage(str(prev_doc_early.get("stage") or row.stage or "contact"))
                if requested_status == "pending" and str(previous_manager_request.get("status") or "") != "pending":
                    if not can_write:
                        raise PermissionDeniedError("仅商机负责人可申请项目经理介入")
                    if _opp_flow_index(current_stage) < _opp_flow_index("bidding") or current_stage == "lost":
                        raise ValidationError("商机进入招投标阶段后才可申请项目经理介入")
                    if str(previous_manager_request.get("status") or "") == "assigned":
                        raise ValidationError("该商机已经分配项目经理")
                    manager_request_action = "pending"
                elif requested_status == "assigned" and str(previous_manager_request.get("status") or "") != "assigned":
                    if (user.name or "").strip() not in self._PROJECT_MANAGER_LEADERS and user.role not in {"admin", "super_admin"}:
                        raise PermissionDeniedError("仅项目经理 Leader 或管理员可分配项目经理")
                    if str(previous_manager_request.get("status") or "") != "pending":
                        raise ValidationError("当前没有待分配申请")
                    manager_name = str(incoming_manager_request.get("projectManager") or "").strip()
                    if not manager_name:
                        raise ValidationError("请选择项目经理")
                    from app.modules.users.repository import UsersRepository

                    users_repo = UsersRepository(self.db)
                    assigned_manager_user = await users_repo.get_by_name(manager_name, active_only=True)
                    if not assigned_manager_user:
                        raise ValidationError("所选项目经理不在当前在职通讯录中")
                    if (user.name or "").strip() in self._PROJECT_MANAGER_LEADERS:
                        managed_ids = set(await users_repo.get_managed_scope_user_ids(user.id))
                        managed_ids.discard(user.id)
                        if assigned_manager_user.id not in managed_ids:
                            raise PermissionDeniedError("只能分配当前 Leader 管辖范围内的下属")
                    manager_request_action = "assigned"
                elif requested_status != str(previous_manager_request.get("status") or ""):
                    raise ValidationError("不支持的项目经理申请状态")

            if not can_write:
                # 顾问仅允许更新顾问相关字段；分配人仅允许更新售前顾问字段
                prev = prev_doc_early
                allowed: set[str] = set()
                if can_advise:
                    allowed.update(("advisorNotes", "attachments"))
                if can_assign_advisor:
                    allowed.add("advisor")
                if can_assign_project_manager and incoming_manager_request and str(incoming_manager_request.get("status") or "") == "assigned":
                    allowed.add("projectManagerRequest")
                document = {
                    **prev,
                    **{key: document.get(key, prev.get(key)) for key in allowed},
                }
                if can_assign_advisor:
                    target = str(document.get("advisor") or "").strip()
                    if not target:
                        raise ValidationError("请选择要分配的售前顾问")
                    await self._assert_assignable_advisor(target)

            # 以 document.stage 为准（与列表/看板一致）；row.stage 列可能历史不同步
            prev_doc = prev_doc_early
            prev_stage = normalize_opp_stage(str(prev_doc.get("stage") or row.stage or "contact"))
            new_stage = normalize_opp_stage(str(document.get("stage") or prev_stage))
            # 先与已 compose 的完整文档合并，再规范化：集合字段始终完整
            document = _normalize_opportunity_document(
                {
                    **prev_doc,
                    **document,
                    "stage": new_stage,
                    "requestIds": [],
                }
            )
            document = await self._stamp_opportunity_geo(document, user)
            if can_assign_advisor and str(document.get("advisor") or "").strip():
                if await self._resolve_opportunity_geo(prev_doc_early) == "domestic":
                    if not str(document.get("solutionLink") or "").strip():
                        raise ValidationError("国内商机分配售前顾问前，请填写方案链接")
                    if not str(document.get("expectedSolutionDate") or "").strip():
                        raise ValidationError("国内商机分配售前顾问前，请填写预计出方案时间")
            if new_stage != prev_stage and can_write:
                await self._assert_opportunity_stage_gate(
                    opportunity_id=opportunity_id,
                    prev_stage=prev_stage,
                    new_stage=new_stage,
                    document=document,
                )
            stage_changed = new_stage != prev_stage
            row = await self.repo.save_opportunity(row, document)
            if manager_request_action == "pending":
                for leader_name in self._PROJECT_MANAGER_LEADERS:
                    await self.repo.create_notification(
                        record_id=f"ntf-pm-request-{uuid4().hex}",
                        target_name=leader_name,
                        target_user_id=None,
                        actor=user.name or user.id,
                        actor_user_id=user.id,
                        message=f"{user.name or '销售'}申请项目经理提前介入商机「{document.get('name') or opportunity_id}」，请分配",
                        href=f"/opportunities/{opportunity_id}",
                    )
            elif manager_request_action == "assigned":
                applicant = str((document.get("projectManagerRequest") or {}).get("applicant") or "").strip()
                if applicant:
                    await self.repo.create_notification(
                        record_id=f"ntf-pm-assigned-{uuid4().hex}",
                        target_name=applicant,
                        target_user_id=str((document.get("projectManagerRequest") or {}).get("applicantUserId") or "") or None,
                        actor=user.name or user.id,
                        actor_user_id=user.id,
                        message=f"商机「{document.get('name') or opportunity_id}」已分配项目经理：{(document.get('projectManagerRequest') or {}).get('projectManager') or '—'}",
                        href=f"/opportunities/{opportunity_id}",
                    )
            if stage_changed:
                await record_partner_opportunity_event(self, user, row, await self._compose_opportunity(row), "opportunity_stage")
            created_contract: dict[str, Any] | None = None
            if new_stage == "signing" and prev_stage != "signing":
                created_contract = await self._ensure_contract_for_opportunity(
                    user, await self._compose_opportunity(row)
                )
            await self._commit_and_invalidate_crm(
                user.id,
                row.owner_user_id,
            )
            refreshed = await self.repo.get_opportunity(opportunity_id) or row
            result = await self._compose_opportunity(refreshed)
            if stage_changed and str(result.get("stage") or "") != new_stage and refreshed is not None:
                # 极端情况：副作用仍覆盖了阶段，提交后再强制写回目标阶段（完整 compose 文档）
                fixed = _normalize_opportunity_document(
                    {
                        **result,
                        "stage": new_stage,
                        "stageHistory": document.get("stageHistory", result.get("stageHistory")),
                        "lastFollowAt": document.get("lastFollowAt", result.get("lastFollowAt")),
                        "requestIds": [],
                    }
                )
                await self.repo.save_opportunity(refreshed, fixed)
                await self._commit_and_invalidate_crm(user.id, refreshed.owner_user_id)
                result = await self._compose_opportunity(refreshed)
            if created_contract:
                result = {**result, "_createdContract": created_contract}
            return result




    async def _assert_opportunity_stage_gate(
            self,
            *,
            opportunity_id: str,
            prev_stage: str,
            new_stage: str,
            document: dict[str, Any],
        ) -> None:
            """需求单独立流转；只保留商机自身的阶段回退规则。"""
            if normalize_opp_stage(new_stage) == "contact" and normalize_opp_stage(prev_stage) != "contact":
                raise ValidationError(MSG_OPP_NO_ROLLBACK_TO_CONTACT)

    async def _assert_assignable_advisor(self, name: str) -> None:
        """分配售前顾问：目标必须是解决方案部在职成员（服务端强制，不信任前端）。"""
        from app.modules.users.service import UsersService

        directory = await UsersService(self.db).list_directory(department_names=["解决方案部"])
        if not any(str(m.name or "") == name for m in directory.members):
            raise PermissionDeniedError("只能将商机分配给解决方案部成员")


    @staticmethod
    def normalize_request_ids(raw) -> list[str]:
        return []


    async def _ensure_contract_for_opportunity(self, user: AuthUser, opp: dict[str, Any]) -> dict[str, Any] | None:
            if not user_has_permission(user, "section:contracts"):
                return None
            if opp.get("partnerId"):
                await ensure_partner_contract(self, user, opp)
                return None
            existing = await self.repo.find_contract_by_opportunity(str(opp["id"]))
            if existing:
                return None
            customer = await self.repo.get_customer(str(opp.get("customerId") or ""))
            cust_doc = _doc(customer) if customer else {}
            today = date.today().isoformat()
            contract_doc: dict[str, Any] = {
                "id": new_id("ct-"),
                "code": await self.repo.next_contract_code(),
                "name": f"{opp.get('name') or '商机'} 服务合同",
                "customerId": opp.get("customerId") or "",
                "company": cust_doc.get("companyName") or "",
                "region": opp.get("region") or "",
                "city": cust_doc.get("city") or "",
                "type": "新签",
                "signType": "线上电子签",
                "source": "",
                "status": "pending",
                "projectStatus": "not_started",
                "signSubject": "",
                "ourSignSubject": "北京 GEO 智营科技有限公司",
                "customerSignSubject": "",
                "signer": "",
                "owner": opp.get("owner") or user.name,
                "owners": [opp.get("owner") or user.name],
                "signerManager": "",
                "dept": (user.department_names[0] if user.department_names else ""),
                "amount": 0,
                "effectiveDate": "",
                "dualSignDate": "",
                "validMonths": 0,
                "endDate": "",
                "attachments": [],
                "opportunityId": opp.get("id"),
                "projectManagerRequest": opp.get("projectManagerRequest") or None,
                "createdAt": today,
            }
            contract_doc = await self._stamp_contract_geo(contract_doc, user)
            row = await self.repo.create_contract(document=contract_doc, owner_user_id=user.id)
            from app.modules.crm.service.contracts import _contract_response

            owners = (await self.repo.list_contract_owners([row.id])).get(row.id) or []
            attachments = await self.repo.get_contract_attachments(row.id)
            return _contract_response(row, owners=owners, attachments=attachments)
