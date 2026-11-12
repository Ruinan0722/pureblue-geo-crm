from __future__ import annotations

from uuid import uuid4

from app.core.exceptions import PermissionDeniedError
from app.modules.crm.service.base import (
    MEETING_PRIMARY_SOURCES,
    Any,
    AuthUser,
    LeadSourceOption,
    NotFoundError,
    ValidationError,
    _china_today_iso,
    _created_at_iso,
    _doc,
    china_now,
    date,
    select,
)
from app.modules.users.repository import UsersRepository


def _assert_lead_status_convertible_guard(payload: dict[str, Any]) -> None:
    """「已转客户」只能由转客户/生成客户流程写入（repo.save_lead），
    手动的创建/编辑接口一律拒绝，避免绕过查重/匹配与转客户审计。"""
    if str(payload.get("status") or "").strip() == "converted":
        raise ValidationError("已转客户状态只能通过「生成客户」流程写入，不能手动设置")


def _lead_response(
    row,
    *,
    importMeta: dict[str, Any] | None = None,
    notes: list[dict[str, Any]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """线索响应组装：已列化字段以列为权威源，其余从 document 过渡读取。"""
    doc = _doc(row)
    for column, key in (
        ("contact_title", "contactTitle"),
        ("contact_department", "contactDepartment"),
        ("contact_phone", "contactPhone"),
        ("contact_wechat", "contactWechat"),
        ("email", "email"),
        ("website", "website"),
        ("requirements", "requirements"),
        ("city", "city"),
        ("invalid_reason", "invalidReason"),
        ("wechat_added", "wechatAdded"),
    ):
        value = getattr(row, column, None)
        if value is not None:
            doc[key] = value
    for column, key in (
        ("converted_customer_id", "convertedCustomerId"),
        ("converted_coverage_id", "convertedCoverageId"),
        ("source_customer_id", "sourceCustomerId"),
    ):
        value = getattr(row, column, None)
        if value is not None:
            doc[key] = value
    # 优先 created_at（分钟精度，如飞书录入日期），回退 created_day 纯日期
    created_day = getattr(row, "created_day", None)
    created_at = getattr(row, "created_at", None)
    if created_at is not None:
        doc["createdAt"] = created_at.strftime("%Y-%m-%d %H:%M")
    elif created_day is not None:
        doc["createdAt"] = created_day.strftime("%Y-%m-%d")
    if importMeta is not None:
        doc["importMeta"] = importMeta
    if notes is not None:
        doc["notes"] = notes
    if attachments is not None:
        doc["attachments"] = attachments
    return doc


class LeadMixin:
    async def list_leads(
            self,
            user: AuthUser,
            *,
            name: str | None = None,
            contact_name: str | None = None,
            sdr: str | None = None,
            sales: str | None = None,
            status: str | None = None,
            source: str | None = None,
            source_detail: str | None = None,
            level: str | None = None,
            region: str | None = None,
            first_contact_from: str | None = None,
            first_contact_to: str | None = None,
            transfer_from: str | None = None,
            transfer_to: str | None = None,
            created_from: str | None = None,
            created_to: str | None = None,
            page: int = 1,
            page_size: int = 10,
        ) -> dict[str, Any]:
            self._assert_section(user, "leads")
            owners = await self._owner_filter(user, lead_pool=True)
            sdr_pool_names = await self._sdr_pool_names(user)
            inc = self._include_unassigned(user, lead_pool=True)
            page = max(1, int(page or 1))
            page_size = min(100, max(1, int(page_size or 10)))
            rows, total = await self.repo.search_leads(
                owners,
                include_unassigned=inc,
                sdr_pool_names=sdr_pool_names,
                name=name,
                contact_name=contact_name,
                sdr=sdr,
                sales=sales,
                status=status,
                source=source,
                source_detail=source_detail,
                level=level,
                region=region,
                first_contact_from=first_contact_from,
                first_contact_to=first_contact_to,
                transfer_from=transfer_from,
                transfer_to=transfer_to,
                created_from=created_from,
                created_to=created_to,
                page=page,
                page_size=page_size,
            )
            children_map = await self.repo.list_lead_children([r.id for r in rows])
            return {
                "items": [
                    _lead_response(
                        r,
                        **children_map.get(r.id, {"importMeta": None, "notes": None}),
                    )
                    for r in rows
                ],
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    async def get_lead(self, user: AuthUser, lead_id: str) -> dict[str, Any]:
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
            children = await self.repo.get_lead_children(lead_id)
            result = _lead_response(row, **children)
            from app.modules.mark_integration.repository import MarkIntegrationRepository

            mark_files = await MarkIntegrationRepository(self.db).list_files_by_lead(lead_id)
            result["markMaterials"] = [
                {
                    "id": item.id,
                    "fileId": item.external_file_id,
                    "fileName": item.original_name,
                    "materialVersion": item.file_version,
                    "contentType": item.content_type,
                    "size": int(item.size or item.expected_size or 0),
                    "checksum": item.checksum or item.expected_checksum,
                    "status": item.download_status,
                    "failureReason": item.failure_reason,
                    "downloadAttempts": int(item.download_attempts or 0),
                    "isCurrent": bool(item.is_current),
                    "generatedAt": item.generated_at.isoformat() if item.generated_at else None,
                    "uploadedAt": item.uploaded_at.isoformat() if item.uploaded_at else None,
                    "url": (
                        f"/api/crm/mark-materials/{item.id}"
                        if item.download_status == "downloaded" and item.storage_path
                        else None
                    ),
                }
                for item in mark_files
            ]
            return result

    async def assert_lead_access(self, user: AuthUser, lead_id: str) -> None:
            await self.get_lead(user, lead_id)

    async def assert_mark_material_access(self, user: AuthUser, lead_id: str) -> None:
            """线索原可见人或转化后的销售对接池可看材料，不扩大到其他销售池。"""
            row = await self.repo.get_lead(lead_id)
            if not row:
                raise NotFoundError("关联线索不存在")
            try:
                self._assert_section(user, "leads")
                await self._assert_row_access(
                    user,
                    row.owner_user_id,
                    lead_pool=True,
                    lead_sdr_name=getattr(row, "sdr", None),
                )
                return
            except PermissionDeniedError:
                pass
            coverage_id = getattr(row, "converted_coverage_id", None)
            if coverage_id:
                self._assert_section(user, "customers")
                coverage = await self.repo.get_coverage(str(coverage_id))
                if not coverage:
                    raise NotFoundError("关联销售对接不存在")
                await self._assert_coverage_access(user, coverage)
                return
            raise PermissionDeniedError()

    async def retry_mark_material(self, user: AuthUser, file_id: str) -> dict[str, Any]:
            self._assert_section(user, "leads")
            self._assert_lead_write(user, "leads:edit")
            from app.modules.mark_integration.repository import MarkIntegrationRepository

            repo = MarkIntegrationRepository(self.db)
            row = await repo.get_file_by_id(file_id)
            if not row:
                raise NotFoundError("Mark 材料不存在")
            lead = await self.repo.get_lead(row.crm_lead_id)
            if not lead:
                raise NotFoundError("关联线索不存在")
            await self._assert_row_access(
                user,
                lead.owner_user_id,
                lead_pool=True,
                lead_sdr_name=getattr(lead, "sdr", None),
            )
            if row.download_status == "downloaded":
                return {"fileId": row.id, "status": "downloaded"}
            if not str(row.source_url or "").strip():
                raise ValidationError("S3 下载地址已清除，无法重试")
            if row.url_expires_at and row.url_expires_at <= china_now():
                row.download_status = "expired"
                row.failure_reason = "PDF fileUrl 已过期，请 Mark 提供新版本地址"
                await self.db.commit()
                raise ValidationError(row.failure_reason)
            row.download_status = "pending_download"
            row.download_attempts = 0
            row.failure_reason = None
            row.next_attempt_at = None
            await self.db.commit()
            return {"fileId": row.id, "status": "pendingDownload"}

    async def get_lead_stats(self, user: AuthUser) -> dict[str, int]:
            self._assert_section(user, "leads")
            owners = await self._owner_filter(user, lead_pool=True)
            sdr_pool_names = await self._sdr_pool_names(user)
            return await self.repo.aggregate_lead_stats(
                owners,
                today=_china_today_iso(),
                include_unassigned=self._include_unassigned(user, lead_pool=True),
                sdr_pool_names=sdr_pool_names,
            )

    async def create_lead(self, user: AuthUser, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "leads")
            self._assert_lead_write(user, "leads:create")
            if not document.get("companyName"):
                raise ValidationError("公司名称不能为空")
            payload = dict(document or {})
            _assert_lead_status_convertible_guard(payload)
            await self._validate_lead_source_option(payload)
            if not str(payload.get("createdAt") or "").strip():
                payload["createdAt"] = _china_today_iso()
            sales = str(payload.get("sales") or "").strip()
            # 「未分配」仅表示尚未指定销售跟进人；行级 owner 仍归创建人，
            # 否则 data_scope=own（含 SDR）列表看不见自己刚建的线索。
            # 飞书历史空 owner 仍仅 Leader/admin 可见（include_unassigned）。
            if sales in ("", "未分配", "待分配", "—", "-"):
                payload["sales"] = "未分配"
            if self._is_sdr_role(user) and not str(payload.get("sdr") or "").strip():
                payload["sdr"] = user.name
            if "notes" not in payload or not isinstance(payload.get("notes"), list):
                payload["notes"] = []
            if "attachments" not in payload or not isinstance(payload.get("attachments"), list):
                payload["attachments"] = []
            owner_user_id = user.id
            row = await self.repo.create_lead(document=payload, owner_user_id=owner_user_id)
            await self._commit_and_invalidate_crm(user.id)
            children = await self.repo.get_lead_children(row.id)
            return _lead_response(row, **children)

    async def update_lead(self, user: AuthUser, lead_id: str, document: dict[str, Any]) -> dict[str, Any]:
            self._assert_section(user, "leads")
            payload = dict(document or {})
            _assert_lead_status_convertible_guard(payload)
            # 标记无效走独立细码；其余编辑/跟进走 leads:edit
            if str(payload.get("status") or "").strip() == "invalid":
                self._assert_lead_write(user, "leads:invalid")
            else:
                self._assert_lead_write(user, "leads:edit")
            row = await self.repo.get_lead(lead_id)
            if not row:
                raise NotFoundError("线索不存在")
            await self._assert_row_access(
                user,
                row.owner_user_id,
                lead_pool=True,
                lead_sdr_name=getattr(row, "sdr", None),
            )
            if str(getattr(row, "status", "") or "").strip() == "invalid":
                # 与「已转客户」对齐：无效线索关闭后不允许二次修改（含跟进/附件）
                raise ValidationError("无效线索已关闭，不支持二次修改")
            if getattr(row, "lead_type", None) == "channel":
                if row.status == "converted":
                    raise ValidationError("已转渠道商的线索不能再次编辑")
                if payload.get("source", row.source) != row.source:
                    raise ValidationError("渠道资料单来源不可修改")
                if "sales" in payload and payload["sales"] != row.sales:
                    raise ValidationError("请通过渠道线索的分配销售入口操作")
            await self._validate_lead_source_option(payload)
            prev_children = await self.repo.get_lead_children(lead_id)
            prev = _lead_response(row, **prev_children)
            payload = {
                **prev,
                **payload,
                "notes": payload["notes"] if "notes" in payload else prev.get("notes") or [],
                "attachments": (
                    payload["attachments"]
                    if "attachments" in payload
                    else prev.get("attachments") or []
                ),
                "importMeta": (
                    payload["importMeta"]
                    if "importMeta" in payload
                    else prev.get("importMeta")
                ),
            }
            if not str(payload.get("createdAt") or "").strip():
                payload["createdAt"] = _created_at_iso(row.created_at) or date.today().isoformat()
            prev_owner = row.owner_user_id
            # 归属 SDR 绑定：sdr 归属字段是权威来源。
            # - sdr 变化：按在职 SDR 成员解析并同步负责人（显式改派/认领）；
            # - sdr 未变化但命中在职 SDR：负责人不一致（历史导入/无负责人）时归一为归属 SDR；
            # - sdr 为空：保持当前归属，避免误清（无负责人数据不自动开放）。
            prev_sdr = str(prev.get("sdr") or "").strip()
            new_sdr = str(payload.get("sdr") or "").strip()
            if new_sdr and new_sdr != prev_sdr:
                target_owner_id = await self._resolve_sdr_owner_user_id(user, new_sdr)
                payload["sdr"] = new_sdr
                row.owner_user_id = target_owner_id
            elif new_sdr:
                payload["sdr"] = new_sdr
                bound_owner_id = await self._try_resolve_active_sdr_id(new_sdr)
                if bound_owner_id and row.owner_user_id != bound_owner_id:
                    row.owner_user_id = bound_owner_id
            else:
                payload["sdr"] = prev_sdr
            row = await self.repo.save_lead(row, payload)
            if row.owner_user_id != prev_owner:
                if new_sdr != prev_sdr:
                    before_sdr = prev_sdr
                else:
                    # 绑定修复：归属字段未变，记录「原负责人 → 归属 SDR」便于追溯
                    before_sdr = "无负责人"
                    if prev_owner:
                        prev_owner_row = await UsersRepository(self.db).get_by_id(
                            prev_owner
                        )
                        if prev_owner_row and prev_owner_row.name:
                            before_sdr = prev_owner_row.name
                await self._write_lead_sdr_audit(
                    user=user,
                    lead_id=lead_id,
                    company_name=str(prev.get("companyName") or ""),
                    before_sdr=before_sdr,
                    after_sdr=str(payload.get("sdr") or ""),
                )
            await self._commit_and_invalidate_crm(user.id, prev_owner, row.owner_user_id)
            children = await self.repo.get_lead_children(row.id)
            return _lead_response(row, **children)

    async def _write_lead_sdr_audit(
        self,
        *,
        user: AuthUser,
        lead_id: str,
        company_name: str,
        before_sdr: str,
        after_sdr: str,
    ) -> None:
        """归属 SDR 变化必须保留审计（负责人变更），由服务端写入。"""
        await self.repo.create_audit_record(
            record_id=f"audit-{int(china_now().timestamp() * 1000)}-{uuid4().hex[:4]}"[:64],
            module="线索管理",
            entity_type="lead",
            entity_id=lead_id[:64],
            related_entity_ids=None,
            entity_name=(company_name or "")[:255],
            action="变更归属 SDR",
            actor=user.name[:128],
            actor_user_id=user.id,
            timestamp_at=china_now().replace(microsecond=0),
            changes=[
                {
                    "field": "sdr",
                    "label": "归属 SDR",
                    "before": before_sdr,
                    "after": after_sdr,
                }
            ],
        )

    async def _validate_lead_source_option(self, payload: dict[str, Any]) -> None:
        primary = str(payload.get("source") or "").strip()
        if primary not in MEETING_PRIMARY_SOURCES and primary != "机构引荐":
            return
        detail = str(payload.get("sourceDetail") or "").strip()
        if not detail:
            label = "会议名称" if primary in MEETING_PRIMARY_SOURCES else "机构"
            raise ValidationError(f"请选择具体{label}")
        options = (
            await self.db.execute(
                select(LeadSourceOption).where(
                        LeadSourceOption.primary_source == primary,
                        LeadSourceOption.enabled.is_(True),
                        LeadSourceOption.deleted_at.is_(None),
                    )
            )
        ).scalars().all()
        if not any(option.display_name == detail for option in options):
            label = "会议名称" if primary in MEETING_PRIMARY_SOURCES else "机构"
            raise ValidationError(f"{label}不在可选列表中，请刷新后重新选择")
