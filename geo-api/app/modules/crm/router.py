from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketException,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal, get_db_session
from app.core.deps import require_user
from app.core.exceptions import AppError, ConflictError, UnauthorizedError
from app.core.jwt import create_ws_ticket, decode_access_token, decode_ws_ticket
from app.core.time_utils import china_now
from app.models.crm import (
    CrmCustomer,
    CrmFollowUpComment,
    CrmOpportunity,
    CrmTeamActivity,
    CrmTeamMember,
    LeadSourceOption,
)
from app.models.user import EMPLOYMENT_ACTIVE, User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import AuthUser
from app.modules.contracts.status_catalog import MEETING_PRIMARY_SOURCES as _MEETING_PRIMARY_SOURCES
from app.modules.crm.attachment_store import (
    build_attachment_records,
    delete_attachment,
    load_attachment,
    save_upload_files,
)
from app.modules.crm.notification_hub import run_notification_socket
from app.modules.crm.schemas import (
    AssignableContactOwnersResponse,
    AuditListResponse,
    AuditRecordCreateBody,
    AuditRecordResponse,
    BatchAssignCustomerOwnerBody,
    BatchAssignCustomerOwnerResponse,
    ConvertCandidatesResponse,
    ConvertLeadBody,
    ConvertLeadResponse,
    CrmAttachment,
    CrmAttachmentUploadResponse,
    CrmBootstrapResponse,
    CrmDocumentBody,
    FollowUpCommentCreateBody,
    FollowUpCommentListResponse,
    FollowUpCommentResponse,
    CustomerListResponse,
    CustomerStatsResponse,
    LeadListResponse,
    LeadSourceOptionCreateBody,
    LeadSourceOptionDeleteBody,
    LeadSourceOptionUpdateBody,
    LeadStatsResponse,
    NotificationCreateBody,
    NotificationListResponse,
    NotificationResponse,
    PaymentPlanBody,
    PublicPoolReleaseBody,
    PublicPoolReviewBody,
    TeamMemberPermissionBody,
    TeamMembersAddBody,
    TransferContactOwnerBody,
    WorkbenchStatsResponse,
)
from app.modules.crm.service import CrmService
from app.modules.mark_integration.repository import MarkIntegrationRepository
from app.modules.mark_integration.storage import load_mark_pdf

router = APIRouter(tags=["crm"])

MEETING_PRIMARY_SOURCES = frozenset(_MEETING_PRIMARY_SOURCES)
MAINTAINABLE_PRIMARY_SOURCES = frozenset([*_MEETING_PRIMARY_SOURCES, "机构引荐"])


def _source_option_dict(row: LeadSourceOption) -> dict[str, Any]:
    return {
        "id": row.id,
        "primarySource": row.primary_source,
        "startDate": row.start_date.isoformat() if row.start_date else None,
        "name": row.name,
        "organizer": row.organizer,
        "displayName": row.display_name,
        "enabled": row.enabled,
        "sortOrder": row.sort_order,
        "updatedAt": row.updated_at.isoformat(),
    }


def _assert_source_option_manager(user: AuthUser) -> None:
    if "lead_source_options:manage" not in set(user.permissions or []):
        from app.core.exceptions import PermissionDeniedError

        raise PermissionDeniedError("无权维护线索二级来源")


def _assert_source_option_reader(user: AuthUser) -> None:
    """线索表单或客户联系人转线索表单均可读取启用中的来源。"""
    permissions = set(user.permissions or [])
    customer_write_codes = {
        "customers:create",
        "customers:master_edit",
        "customers:contact_add",
        "customers:contact_edit",
        "customers:follow_add",
        "customers:attachment_upload",
        "customers:status_change",
    }
    has_customer_write = bool(permissions & customer_write_codes) or (
        "customers:write" in permissions
    )
    if "section:leads" not in permissions and not (
        "section:customers" in permissions and has_customer_write
    ):
        from app.core.exceptions import PermissionDeniedError

        raise PermissionDeniedError("无权访问线索来源")


def _assert_valid_source_option_input(
    primary: str,
    start_date: date | None,
    organizer: str | None,
) -> None:
    """二级来源新增校验：会议必须带日期与主办方；机构引荐仅需名称。"""
    if primary not in MAINTAINABLE_PRIMARY_SOURCES:
        from app.core.exceptions import ValidationError

        raise ValidationError("仅支持维护会议类或机构引荐二级来源")
    if primary in MEETING_PRIMARY_SOURCES:
        if start_date is None:
            from app.core.exceptions import ValidationError

            raise ValidationError("会议开始日期不能为空")
        if not (organizer or "").strip():
            from app.core.exceptions import ValidationError

            raise ValidationError("会议主办方不能为空")


def _http_error(exc: AppError):
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
        "conflict": 409,
    }
    status_code = code_map.get(exc.code, 400)
    if isinstance(exc, ConflictError) and exc.payload:
        raise HTTPException(
            status_code=status_code,
            detail={"message": exc.message, "code": exc.code, **exc.payload},
        )
    raise HTTPException(status_code=status_code, detail=exc.message)


TEAM_ENTITY_TYPES = {"customer", "opportunity"}
TEAM_ROLES = {"销售", "解决方案", "客户成功", "管理者", "其他协作"}


async def _team_entity(db: AsyncSession, entity_type: str, entity_id: str):
    kind = (entity_type or "").strip().lower()
    if kind not in TEAM_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="协作对象仅支持 customer 或 opportunity")
    model = CrmCustomer if kind == "customer" else CrmOpportunity
    row = (await db.execute(select(model).where(model.id == entity_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="客户或商机不存在")
    return kind, row


def _assert_team_reader(user: AuthUser, entity_type: str) -> None:
    section = "customers" if entity_type == "customer" else "opportunities"
    if f"section:{section}" not in set(user.permissions or []):
        raise HTTPException(status_code=403, detail="无权查看该协作团队")


def _assert_team_manager(user: AuthUser, row) -> None:
    elevated_roles = {"admin", "super_admin", "sales_ops", "sales_leader"}
    if user.role in elevated_roles or user.id == row.owner_user_id or user.name == (row.owner or ""):
        return
    raise HTTPException(status_code=403, detail="仅负责人、销售运营或管理员可管理团队成员")


def _team_member_dict(row: CrmTeamMember) -> dict[str, Any]:
    return {
        "id": row.id,
        "userId": row.user_id,
        "name": row.member_name,
        "department": row.department,
        "role": row.team_role,
        "permission": row.permission,
        "addedAt": row.created_at.isoformat(sep=" ", timespec="seconds"),
        "addedBy": row.added_by_name,
    }


def _team_activity_dict(row: CrmTeamActivity) -> dict[str, Any]:
    return {
        "id": row.id,
        "action": row.action,
        "operator": row.operator_name,
        "memberName": row.member_name,
        "detail": row.detail,
        "createdAt": row.created_at.isoformat(sep=" ", timespec="seconds"),
    }


async def _team_payload(db: AsyncSession, entity_type: str, entity_id: str) -> dict[str, Any]:
    members = (await db.execute(
        select(CrmTeamMember)
        .where(CrmTeamMember.entity_type == entity_type, CrmTeamMember.entity_id == entity_id)
        .order_by(CrmTeamMember.created_at.asc())
    )).scalars().all()
    activities = (await db.execute(
        select(CrmTeamActivity)
        .where(CrmTeamActivity.entity_type == entity_type, CrmTeamActivity.entity_id == entity_id)
        .order_by(CrmTeamActivity.created_at.desc())
        .limit(50)
    )).scalars().all()
    return {
        "members": [_team_member_dict(row) for row in members],
        "activities": [_team_activity_dict(row) for row in activities],
    }


@router.get("/crm/team-collaboration/{entity_type}/{entity_id}")
async def get_team_collaboration(
    entity_type: str,
    entity_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    kind, _row = await _team_entity(db, entity_type, entity_id)
    _assert_team_reader(user, kind)
    return await _team_payload(db, kind, entity_id)


@router.post("/crm/team-collaboration/{entity_type}/{entity_id}/members", status_code=status.HTTP_201_CREATED)
async def add_team_members(
    entity_type: str,
    entity_id: str,
    body: TeamMembersAddBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    kind, entity = await _team_entity(db, entity_type, entity_id)
    _assert_team_reader(user, kind)
    _assert_team_manager(user, entity)
    target_ids = list(dict.fromkeys(item.user_id for item in body.members))
    users = (await db.execute(
        select(User).where(User.id.in_(target_ids), User.employment_status == EMPLOYMENT_ACTIVE)
    )).scalars().all()
    users_by_id = {row.id: row for row in users}
    missing = [uid for uid in target_ids if uid not in users_by_id]
    if missing:
        raise HTTPException(status_code=400, detail="所选成员不存在或已离职")
    existing_ids = set((await db.execute(
        select(CrmTeamMember.user_id).where(
            CrmTeamMember.entity_type == kind,
            CrmTeamMember.entity_id == entity_id,
            CrmTeamMember.user_id.in_(target_ids),
        )
    )).scalars().all())
    now = datetime.now().replace(microsecond=0)
    for item in body.members:
        if item.user_id in existing_ids:
            continue
        if item.role not in TEAM_ROLES:
            raise HTTPException(status_code=400, detail=f"不支持的团队角色：{item.role}")
        target = users_by_id[item.user_id]
        if target.id == entity.owner_user_id:
            continue
        department = " / ".join(target.department_names or []) or "未标注部门"
        member = CrmTeamMember(
            id=f"team-{uuid4().hex[:24]}",
            entity_type=kind,
            entity_id=entity_id,
            user_id=target.id,
            member_name=target.name,
            department=department,
            team_role=item.role,
            permission=item.permission,
            added_by_user_id=user.id,
            added_by_name=user.name,
            created_at=now,
            updated_at=now,
        )
        db.add(member)
        db.add(CrmTeamActivity(
            id=f"team-log-{uuid4().hex[:20]}",
            entity_type=kind,
            entity_id=entity_id,
            action="add",
            operator_user_id=user.id,
            operator_name=user.name,
            member_user_id=target.id,
            member_name=target.name,
            detail=f"加入团队，角色为{item.role}，权限为{'可编辑' if item.permission == 'edit' else '只读'}",
            created_at=now,
        ))
    await db.commit()
    return await _team_payload(db, kind, entity_id)


@router.patch("/crm/team-collaboration/{entity_type}/{entity_id}/members/{member_id}")
async def update_team_member_permission(
    entity_type: str,
    entity_id: str,
    member_id: str,
    body: TeamMemberPermissionBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    kind, entity = await _team_entity(db, entity_type, entity_id)
    _assert_team_reader(user, kind)
    _assert_team_manager(user, entity)
    member = (await db.execute(select(CrmTeamMember).where(
        CrmTeamMember.id == member_id,
        CrmTeamMember.entity_type == kind,
        CrmTeamMember.entity_id == entity_id,
    ))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="协作成员不存在")
    if member.permission != body.permission:
        member.permission = body.permission
        member.updated_at = datetime.now().replace(microsecond=0)
        db.add(CrmTeamActivity(
            id=f"team-log-{uuid4().hex[:20]}",
            entity_type=kind,
            entity_id=entity_id,
            action="permission",
            operator_user_id=user.id,
            operator_name=user.name,
            member_user_id=member.user_id,
            member_name=member.member_name,
            detail=f"权限调整为{'可编辑' if body.permission == 'edit' else '只读'}",
            created_at=member.updated_at,
        ))
        await db.commit()
    return await _team_payload(db, kind, entity_id)


@router.delete("/crm/team-collaboration/{entity_type}/{entity_id}/members/{member_id}")
async def remove_team_member(
    entity_type: str,
    entity_id: str,
    member_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    kind, entity = await _team_entity(db, entity_type, entity_id)
    _assert_team_reader(user, kind)
    _assert_team_manager(user, entity)
    member = (await db.execute(select(CrmTeamMember).where(
        CrmTeamMember.id == member_id,
        CrmTeamMember.entity_type == kind,
        CrmTeamMember.entity_id == entity_id,
    ))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="协作成员不存在")
    now = datetime.now().replace(microsecond=0)
    db.add(CrmTeamActivity(
        id=f"team-log-{uuid4().hex[:20]}",
        entity_type=kind,
        entity_id=entity_id,
        action="remove",
        operator_user_id=user.id,
        operator_name=user.name,
        member_user_id=member.user_id,
        member_name=member.member_name,
        detail="移出协作团队并立即收回团队关系权限",
        created_at=now,
    ))
    await db.delete(member)
    await db.commit()
    return await _team_payload(db, kind, entity_id)


# —— bootstrap ——
@router.get("/crm/bootstrap", response_model=CrmBootstrapResponse)
async def crm_bootstrap(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> CrmBootstrapResponse:
    try:
        data = await CrmService(db).bootstrap(user)
        return CrmBootstrapResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/crm/workbench", response_model=WorkbenchStatsResponse)
async def crm_workbench(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> WorkbenchStatsResponse:
    try:
        data = await CrmService(db).get_workbench(user)
        return WorkbenchStatsResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


# —— attachments ——
@router.post("/crm/attachments", response_model=CrmAttachmentUploadResponse)
async def upload_crm_attachments(
    user: Annotated[AuthUser, Depends(require_user)],
    files: Annotated[list[UploadFile], File(description="CRM 附件")],
    lead_id: Annotated[str | None, Form(alias="leadId")] = None,
) -> CrmAttachmentUploadResponse:
    try:
        ids = await save_upload_files(files, uploaded_by=user.id, lead_id=lead_id)
        records = build_attachment_records(ids)
        attachments = [
            CrmAttachment(
                id=str(item["id"]),
                url=str(item["url"]),
                storage_path=item.get("storagePath"),
                name=item.get("name") or item.get("originalName"),
                original_name=item.get("originalName"),
                content_type=item.get("contentType"),
                size=item.get("size"),
                uploaded_at=item.get("uploadedAt"),
                uploaded_by=item.get("uploadedBy"),
            )
            for item in records
        ]
        return CrmAttachmentUploadResponse(attachment_ids=ids, attachments=attachments)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/crm/attachments/{attachment_id}")
async def get_crm_attachment(
    attachment_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    download: bool = False,
):
    try:
        storage_id = await CrmService(db).assert_attachment_access(user, attachment_id)
        stored = load_attachment(storage_id)
        return FileResponse(
            path=stored.path,
            media_type=stored.content_type,
            filename=stored.original_name,
            content_disposition_type="attachment" if download else "inline",
        )
    except AppError as e:
        _http_error(e)
        raise


@router.delete("/crm/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_crm_attachment(
    attachment_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    try:
        # 删除前先校验父实体仍可读：改派/离职后失去数据范围的用户不得删除自己上传的附件
        storage_id = await CrmService(db).assert_attachment_access(user, attachment_id)
        # 转客户/转商机附件只删除逻辑引用，不能删掉来源实体仍在使用的共享文件。
        if storage_id == attachment_id:
            delete_attachment(attachment_id, user_id=user.id)
    except AppError as e:
        _http_error(e)
        raise


# —— leads ——
@router.get("/lead-source-options")
async def list_lead_source_options(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    primary_source: str | None = Query(default=None, alias="primarySource"),
    meeting_name: str | None = Query(default=None, alias="meetingName"),
    organizer: str | None = Query(default=None),
    start_date: date | None = Query(default=None, alias="startDate"),
    include_disabled: bool = Query(default=False, alias="includeDisabled"),
) -> dict[str, Any]:
    try:
        _assert_source_option_reader(user)
    except AppError as e:
        _http_error(e)
        raise
    stmt = select(LeadSourceOption).where(LeadSourceOption.deleted_at.is_(None))
    if primary_source:
        stmt = stmt.where(LeadSourceOption.primary_source == primary_source.strip())
    if meeting_name and meeting_name.strip():
        stmt = stmt.where(LeadSourceOption.name.like(f"%{meeting_name.strip()}%"))
    if organizer and organizer.strip():
        stmt = stmt.where(LeadSourceOption.organizer.like(f"%{organizer.strip()}%"))
    if start_date:
        stmt = stmt.where(LeadSourceOption.start_date == start_date)
    if not include_disabled:
        stmt = stmt.where(LeadSourceOption.enabled.is_(True))
    rows = (await db.execute(stmt.order_by(LeadSourceOption.start_date.desc(), LeadSourceOption.sort_order, LeadSourceOption.name))).scalars().all()
    return {"items": [_source_option_dict(row) for row in rows]}


@router.post("/lead-source-options", status_code=status.HTTP_201_CREATED)
async def create_lead_source_option(
    body: LeadSourceOptionCreateBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        _assert_source_option_manager(user)
        primary = body.primary_source.strip()
        _assert_valid_source_option_input(primary, body.start_date, body.organizer)
        name = body.name.strip()
        if not name:
            from app.core.exceptions import ValidationError

            raise ValidationError("二级来源名称不能为空")
        organizer = (body.organizer or "").strip() or None
        now = datetime.utcnow()
        existing = (
            await db.execute(
                select(LeadSourceOption).where(
                    LeadSourceOption.primary_source == primary,
                    LeadSourceOption.name == name,
                    LeadSourceOption.start_date == body.start_date,
                    LeadSourceOption.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        if existing is not None:
            from app.core.exceptions import ValidationError

            raise ConflictError("同一一级来源下已存在相同名称的二级来源")
        row = LeadSourceOption(
            id=str(uuid4()), primary_source=primary, start_date=body.start_date,
            name=name, organizer=organizer, enabled=True,
            sort_order=body.sort_order, updated_by=user.id, created_at=now, updated_at=now,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return _source_option_dict(row)
    except IntegrityError:
        await db.rollback()
        return _http_error(ConflictError("同一一级来源下已存在相同名称的二级来源"))
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/lead-source-options/{option_id}")
async def update_lead_source_option(
    option_id: str,
    body: LeadSourceOptionUpdateBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        _assert_source_option_manager(user)
        row = await db.get(LeadSourceOption, option_id)
        if not row or row.deleted_at is not None:
            from app.core.exceptions import NotFoundError

            raise NotFoundError("二级来源不存在")
        if body.name is not None:
            name = body.name.strip()
            if not name:
                from app.core.exceptions import ValidationError

                raise ValidationError("二级来源名称不能为空")
            row.name = name
        if body.enabled is not None:
            row.enabled = body.enabled
        if body.sort_order is not None:
            row.sort_order = body.sort_order
        row.updated_by = user.id
        row.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(row)
        return _source_option_dict(row)
    except IntegrityError:
        await db.rollback()
        return _http_error(ConflictError("同一一级来源下已存在相同日期和名称的会议"))
    except AppError as e:
        _http_error(e)
        raise


@router.delete("/lead-source-options/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead_source_option(
    option_id: str,
    body: LeadSourceOptionDeleteBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    try:
        _assert_source_option_manager(user)
        row = await db.get(LeadSourceOption, option_id)
        if not row or row.deleted_at is not None:
            from app.core.exceptions import NotFoundError

            raise NotFoundError("二级来源不存在")
        reason = body.reason.strip()
        if not reason:
            from app.core.exceptions import ValidationError

            raise ValidationError("请填写删除原因")
        row.deleted_by = user.id
        row.deletion_reason = reason
        row.deleted_at = datetime.utcnow()
        row.enabled = False
        row.updated_by = user.id
        row.updated_at = datetime.utcnow()
        await db.commit()
    except AppError as e:
        _http_error(e)
        raise


@router.get("/leads", response_model=LeadListResponse)
async def list_leads(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    name: str | None = Query(default=None),
    contact_name: str | None = Query(default=None, alias="contactName"),
    sdr: str | None = Query(default=None),
    sales: str | None = Query(default=None),
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
    source_detail: str | None = Query(default=None, alias="sourceDetail"),
    level: str | None = Query(default=None),
    region: str | None = Query(default=None),
    first_contact_from: str | None = Query(default=None, alias="firstContactFrom"),
    first_contact_to: str | None = Query(default=None, alias="firstContactTo"),
    transfer_from: str | None = Query(default=None, alias="transferFrom"),
    transfer_to: str | None = Query(default=None, alias="transferTo"),
    created_from: str | None = Query(default=None, alias="createdFrom"),
    created_to: str | None = Query(default=None, alias="createdTo"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> LeadListResponse:
    try:
        data = await CrmService(db).list_leads(
            user,
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
        return LeadListResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/leads/stats", response_model=LeadStatsResponse)
async def lead_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> LeadStatsResponse:
    try:
        data = await CrmService(db).get_lead_stats(user)
        return LeadStatsResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/leads/{lead_id}")
async def get_lead(
    lead_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_lead(user, lead_id)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/crm/mark-materials/{file_id}")
async def get_mark_material(
    file_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    download: bool = False,
):
    try:
        row = await MarkIntegrationRepository(db).get_file_by_id(file_id)
        if not row:
            from app.core.exceptions import NotFoundError

            raise NotFoundError("Mark 材料不存在")
        await CrmService(db).assert_mark_material_access(user, row.crm_lead_id)
        stored = load_mark_pdf(row.storage_path)
        return FileResponse(
            path=stored,
            media_type="application/pdf",
            filename=row.original_name,
            content_disposition_type="attachment" if download else "inline",
        )
    except AppError as e:
        _http_error(e)
        raise


@router.post("/crm/mark-materials/{file_id}/retry")
async def retry_mark_material(
    file_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).retry_mark_material(user, file_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_lead(user, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/leads/{lead_id}")
async def patch_lead(
    lead_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_lead(user, lead_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/leads/{lead_id}/convert-candidates", response_model=ConvertCandidatesResponse)
async def convert_lead_candidates(
    lead_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> ConvertCandidatesResponse:
    try:
        data = await CrmService(db).convert_lead_candidates(user, lead_id)
        return ConvertCandidatesResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/leads/{lead_id}/convert", response_model=ConvertLeadResponse)
async def convert_lead(
    lead_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    body: ConvertLeadBody | None = None,
) -> ConvertLeadResponse:
    try:
        payload = body or ConvertLeadBody()
        data = await CrmService(db).convert_lead(
            user,
            lead_id,
            mode=payload.mode,
            customer_id=payload.customer_id,
            sales=payload.sales,
        )
        return ConvertLeadResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


# —— customers ——
@router.get("/public-pool")
async def list_public_pool(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    company_name: str | None = Query(default=None, alias="companyName"),
    industry: str | None = Query(default=None),
    region: str | None = Query(default=None),
    source: str | None = Query(default=None),
    pool_status: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
) -> dict[str, Any]:
    try:
        return await CrmService(db).list_public_pool(
            user,
            company_name=company_name,
            industry=industry,
            region=region,
            source=source,
            status=pool_status,
            page=page,
            page_size=page_size,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/public-pool/stats")
async def public_pool_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, int]:
    try:
        return await CrmService(db).get_public_pool_stats(user)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/public-pool/{entry_id}")
async def public_pool_detail(
    entry_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_public_pool_detail(user, entry_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/public-pool/{entry_id}/claim", status_code=status.HTTP_201_CREATED)
async def apply_public_pool_claim(
    entry_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).apply_public_pool_claim(user, entry_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/public-pool/claims/{claim_id}/review")
async def review_public_pool_claim(
    claim_id: str,
    body: PublicPoolReviewBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).review_public_pool_claim(
            user,
            claim_id,
            approved=body.approved,
            reason=body.reason,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/customers", response_model=CustomerListResponse)
async def list_customers(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    company_name: str | None = Query(default=None, alias="companyName"),
    brand_name: str | None = Query(default=None, alias="brandName"),
    owner: str | None = Query(default=None),
    status: str | None = Query(default=None),
    industry: str | None = Query(default=None),
    industry_l2: str | None = Query(default=None, alias="industryL2"),
    region: str | None = Query(default=None),
    credit_code: str | None = Query(default=None, alias="creditCode"),
    key_only: bool = Query(default=False, alias="keyOnly"),
    last_follow_from: str | None = Query(default=None, alias="lastFollowFrom"),
    last_follow_to: str | None = Query(default=None, alias="lastFollowTo"),
    next_follow_from: str | None = Query(default=None, alias="nextFollowFrom"),
    next_follow_to: str | None = Query(default=None, alias="nextFollowTo"),
    relation: str | None = Query(default=None),
    mine_only: bool = Query(default=False, alias="mineOnly"),
    coverage_scope: str | None = Query(default=None, alias="coverageScope"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> CustomerListResponse:
    try:
        data = await CrmService(db).list_customers(
            user,
            company_name=company_name,
            brand_name=brand_name,
            owner=owner,
            status=status,
            industry=industry,
            industry_l2=industry_l2,
            region=region,
            credit_code=credit_code,
            key_only=key_only,
            last_follow_from=last_follow_from,
            last_follow_to=last_follow_to,
            next_follow_from=next_follow_from,
            next_follow_to=next_follow_to,
            relation=relation,
            mine_only=mine_only,
            coverage_scope=coverage_scope,
            page=page,
            page_size=page_size,
        )
        return CustomerListResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/customers/stats", response_model=CustomerStatsResponse)
async def customer_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    mine_only: bool = Query(default=False, alias="mineOnly"),
    coverage_scope: str | None = Query(default=None, alias="coverageScope"),
) -> CustomerStatsResponse:
    try:
        data = await CrmService(db).get_customer_stats(
            user, mine_only=mine_only, coverage_scope=coverage_scope
        )
        return CustomerStatsResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers/batch-assign-owner", response_model=BatchAssignCustomerOwnerResponse)
async def batch_assign_customer_owner(
    body: BatchAssignCustomerOwnerBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> BatchAssignCustomerOwnerResponse:
    try:
        data = await CrmService(db).batch_assign_customer_owner(
            user,
            customer_ids=body.customer_ids,
            owner=body.owner,
        )
        return BatchAssignCustomerOwnerResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/customers/duplicate-check", response_model=ConvertCandidatesResponse)
async def customer_duplicate_check(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    company_name: str = Query(default="", alias="companyName"),
    credit_code: str = Query(default="", alias="creditCode"),
) -> ConvertCandidatesResponse:
    try:
        data = await CrmService(db).customer_create_candidates(
            user,
            company_name=company_name,
            credit_code=credit_code,
        )
        return ConvertCandidatesResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/customers/{customer_id}")
async def get_customer(
    customer_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    coverage_scope: str | None = Query(default=None, alias="coverageScope"),
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_customer(
            user, customer_id, coverage_scope=coverage_scope
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/customers/{customer_id}/coverages")
async def list_customer_coverages(
    customer_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    coverage_scope: str | None = Query(default=None, alias="coverageScope"),
) -> list[dict[str, Any]]:
    try:
        return await CrmService(db).list_customer_coverages(
            user, customer_id, coverage_scope=coverage_scope
        )
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers/{customer_id}/coverages", status_code=status.HTTP_201_CREATED)
async def create_customer_coverage(
    customer_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        doc = dict(body.document or {})
        owner_user_id = str(doc.pop("ownerUserId", None) or doc.pop("owner_user_id", None) or "").strip() or None
        return await CrmService(db).create_customer_coverage(
            user,
            customer_id,
            owner_user_id=owner_user_id,
            document=doc,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/coverages/{coverage_id}")
async def get_coverage(
    coverage_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_coverage(user, coverage_id)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/coverages/{coverage_id}")
async def patch_coverage(
    coverage_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_coverage(user, coverage_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers", status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_customer(user, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers/{customer_id}/release-to-public-pool")
async def release_customer_to_public_pool(
    customer_id: str,
    body: PublicPoolReleaseBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).release_customer_to_public_pool(
            user,
            customer_id,
            reason=body.reason,
            coverage_id=body.coverage_id,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/customers/{customer_id}")
async def patch_customer(
    customer_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_customer(user, customer_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers/{customer_id}/contacts", status_code=status.HTTP_201_CREATED)
async def create_customer_contact_lead(
    customer_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_customer_contact_lead(user, customer_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/customers/{customer_id}/contacts/{contact_id}/transfer")
async def transfer_customer_contact(
    customer_id: str,
    contact_id: str,
    body: TransferContactOwnerBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).transfer_customer_contact(
            user,
            customer_id=customer_id,
            contact_id=contact_id,
            target_owner_name=body.target_owner_name,
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get(
    "/customers/{customer_id}/assignable-contact-owners",
    response_model=AssignableContactOwnersResponse,
)
async def list_assignable_contact_owners(
    customer_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> AssignableContactOwnersResponse:
    try:
        data = await CrmService(db).list_assignable_contact_owners(user, customer_id)
        return AssignableContactOwnersResponse(**data)
    except AppError as e:
        _http_error(e)
        raise


# —— opportunities ——
@router.get("/opportunities")
async def list_opportunities(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict[str, Any]]:
    try:
        return await CrmService(db).list_opportunities(user)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/opportunities/{opportunity_id}")
async def get_opportunity(
    opportunity_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_opportunity(user, opportunity_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/opportunities", status_code=status.HTTP_201_CREATED)
async def create_opportunity(
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_opportunity(user, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/opportunities/{opportunity_id}")
async def patch_opportunity(
    opportunity_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_opportunity(user, opportunity_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


# —— contracts ——
@router.get("/contracts")
async def list_contracts(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict[str, Any]]:
    try:
        return await CrmService(db).list_contracts(user)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/contracts/{contract_id}/payment-plans")
async def list_contract_payment_plans(
    contract_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict[str, Any]]:
    try:
        return await CrmService(db).list_contract_payment_plans(user, contract_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/contracts/{contract_id}/payment-plans", status_code=status.HTTP_201_CREATED)
async def create_contract_payment_plan(
    contract_id: str,
    body: PaymentPlanBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_payment_plan(
            user, contract_id, body.model_dump(by_alias=True, exclude_unset=True)
        )
    except AppError as e:
        _http_error(e)
        raise


@router.get("/contracts/{contract_id}")
async def get_contract(
    contract_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).get_contract(user, contract_id)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/contracts", status_code=status.HTTP_201_CREATED)
async def create_contract(
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).create_contract(user, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/contracts/{contract_id}")
async def patch_contract(
    contract_id: str,
    body: CrmDocumentBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_contract(user, contract_id, body.document)
    except AppError as e:
        _http_error(e)
        raise


@router.get("/payment-plans")
async def list_payment_plans(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict[str, Any]]:
    try:
        return await CrmService(db).list_payment_plans(user)
    except AppError as e:
        _http_error(e)
        raise


@router.patch("/payment-plans/{payment_plan_id}")
async def patch_payment_plan(
    payment_plan_id: str,
    body: PaymentPlanBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    try:
        return await CrmService(db).update_payment_plan(
            user, payment_plan_id, body.model_dump(by_alias=True, exclude_unset=True)
        )
    except AppError as e:
        _http_error(e)
        raise


@router.delete("/payment-plans/{payment_plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment_plan(
    payment_plan_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    try:
        await CrmService(db).delete_payment_plan(user, payment_plan_id)
    except AppError as e:
        _http_error(e)
        raise


# —— 跟进记录评论（Leader 指导 / 销售回复） ——
def _follow_up_comment_response(row: CrmFollowUpComment) -> FollowUpCommentResponse:
    return FollowUpCommentResponse(
        id=row.id,
        follow_up_id=row.follow_up_id,
        author_user_id=row.author_user_id,
        author_name=row.author_name,
        author_role=row.author_role,
        content=row.content,
        created_at=row.created_at.isoformat(timespec="seconds"),
    )


async def _check_partner_follow_up_comment_access(db, user, follow_up_id):
    from app.models.channel import ChannelFollowUp
    from app.modules.channel_management.access import require_partner
    row = await db.get(ChannelFollowUp, follow_up_id)
    if row:
        await require_partner(db, user, row.partner_id)


@router.get("/crm/follow-up-comments", response_model=FollowUpCommentListResponse)
async def list_follow_up_comments(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    follow_up_id: Annotated[str, Query(alias="followUpId", min_length=1, max_length=128)],
) -> FollowUpCommentListResponse:
    await _check_partner_follow_up_comment_access(db, user, follow_up_id)
    rows = (
        await db.execute(
            select(CrmFollowUpComment)
            .where(CrmFollowUpComment.follow_up_id == follow_up_id)
            .order_by(CrmFollowUpComment.created_at.asc(), CrmFollowUpComment.id.asc())
        )
    ).scalars().all()
    return FollowUpCommentListResponse(items=[_follow_up_comment_response(row) for row in rows])


@router.post(
    "/crm/follow-up-comments",
    response_model=FollowUpCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_follow_up_comment(
    body: FollowUpCommentCreateBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> FollowUpCommentResponse:
    role_codes = {str(code).strip() for code in [user.role, *(user.roles or [])] if str(code).strip()}
    is_leader = bool(
        role_codes.intersection({"leader", "ops", "admin", "super_admin"})
        or user.manual_department_leader
    )
    is_sales = bool(role_codes.intersection({"sales", "sdr"}))
    if not is_leader and not is_sales:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅 Leader 和销售可以参与跟进评论")

    await _check_partner_follow_up_comment_access(db, user, body.follow_up_id.strip())
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="评论内容不能为空")
    row = CrmFollowUpComment(
        id=f"fuc-{uuid4().hex}",
        follow_up_id=body.follow_up_id.strip(),
        author_user_id=user.id,
        author_name=user.name or "当前用户",
        author_role="leader" if is_leader else "sales",
        content=content,
        created_at=china_now(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _follow_up_comment_response(row)


# —— audit（操作历史） ——
@router.get("/crm/audit", response_model=AuditListResponse)
async def list_crm_audits(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    entity_id: Annotated[str | None, Query(alias="entityId")] = None,
    module: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> AuditListResponse:
    try:
        items = await CrmService(db).list_audits(user, entity_id=entity_id, module=module, limit=limit)
        return AuditListResponse(items=items)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/crm/audit", response_model=AuditRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_crm_audit(
    body: AuditRecordCreateBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuditRecordResponse:
    try:
        return await CrmService(db).create_audit(user, body)
    except AppError as e:
        _http_error(e)
        raise


# —— notifications（@提及） ——
@router.get("/crm/notifications/ws-ticket")
async def crm_notifications_ws_ticket(
    user: Annotated[AuthUser, Depends(require_user)],
) -> dict[str, object]:
    ticket, expires_in = create_ws_ticket(user_id=user.id)
    return {"ticket": ticket, "expiresIn": expires_in}


@router.websocket("/crm/notifications/ws")
async def crm_notifications_ws(websocket: WebSocket) -> None:
    ticket = websocket.query_params.get("ticket")
    user: AuthUser | None = None
    try:
        if ticket:
            user_id = decode_ws_ticket(ticket)
            async with SessionLocal() as db:
                user = await AuthRepository(db).get_auth_user_by_id(user_id)
        else:
            from app.config import get_settings

            access_token = websocket.cookies.get(get_settings().jwt_cookie)
            if not access_token:
                raise UnauthorizedError("请先登录")
            payload = decode_access_token(access_token)
            async with SessionLocal() as db:
                user = await AuthRepository(db).get_auth_user_by_id(payload.user_id)
        if not user:
            raise UnauthorizedError("请先登录")
    except UnauthorizedError as exc:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason=exc.message) from exc

    async def poll_unread(*, user_id: str, user_name: str) -> tuple[int, str | None]:
        async with SessionLocal() as db:
            return await CrmService(db).unread_snapshot(user_id=user_id, user_name=user_name)

    await run_notification_socket(
        websocket=websocket,
        user_id=user.id,
        user_name=user.name,
        poll_unread=poll_unread,
    )


@router.get("/crm/notifications", response_model=NotificationListResponse)
async def list_crm_notifications(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> NotificationListResponse:
    try:
        items = await CrmService(db).list_notifications(user, limit=limit)
        return NotificationListResponse(items=items)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/crm/notifications", response_model=NotificationListResponse, status_code=status.HTTP_201_CREATED)
async def create_crm_notifications(
    body: NotificationCreateBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> NotificationListResponse:
    try:
        items = await CrmService(db).create_notifications(user, body)
        return NotificationListResponse(items=items)
    except AppError as e:
        _http_error(e)
        raise


@router.post("/crm/notifications/read-all")
async def mark_all_crm_notifications_read(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, int]:
    try:
        count = await CrmService(db).mark_all_notifications_read(user)
        return {"updated": count}
    except AppError as e:
        _http_error(e)
        raise


@router.post("/crm/notifications/{notification_id}/read", response_model=NotificationResponse)
async def mark_crm_notification_read(
    notification_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> NotificationResponse:
    try:
        return await CrmService(db).mark_notification_read(user, notification_id)
    except AppError as e:
        _http_error(e)
        raise
