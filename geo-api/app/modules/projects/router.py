from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.deps import require_user
from app.core.exceptions import AppError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.projects.schemas import (
    CreateProjectNoteBody,
    CreateProjectSowVersionBody,
    PatchProjectBody,
    ProjectAttachmentsResponse,
    ProjectDashboardResponse,
    ProjectListResponse,
    ProjectNoteItem,
    ProjectNotesResponse,
    ProjectPaymentSummary,
    ProjectRecord,
    ProjectReportResponse,
    ProjectStatsResponse,
    ProjectSowVersionsResponse,
    ProjectWorkItemBody,
    ProjectWorkItemRecord,
    ProjectWorkItemsResponse,
)
from app.modules.projects.service import ProjectsService
from app.modules.crm.attachment_store import (
    build_attachment_records,
    delete_attachment,
    save_upload_files,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _http_error(exc: AppError):
    from fastapi import HTTPException

    code_map = {
        "not_found": 404,
        "permission_denied": 403,
        "unauthorized": 401,
        "validation_error": 400,
    }
    raise HTTPException(status_code=code_map.get(exc.code, 400), detail=exc.message)


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    view: str = Query(default="active"),
    keyword: str | None = Query(default=None),
    stage: str | None = Query(default=None),
    health: str | None = Query(default=None),
    risk_level: str | None = Query(default=None, alias="riskLevel"),
    office: str | None = Query(default=None),
    renewal_warning: bool = Query(default=False, alias="renewalWarning"),
    mine_only: bool = Query(default=False, alias="mineOnly"),
    amount_min: float | None = Query(default=None, alias="amountMin"),
    amount_max: float | None = Query(default=None, alias="amountMax"),
    sow_from: str | None = Query(default=None, alias="sowFrom"),
    sow_to: str | None = Query(default=None, alias="sowTo"),
    updated_from: str | None = Query(default=None, alias="updatedFrom"),
    updated_to: str | None = Query(default=None, alias="updatedTo"),
    due_days_min: int | None = Query(default=None, alias="dueDaysMin"),
    due_days_max: int | None = Query(default=None, alias="dueDaysMax"),
):
    try:
        return await ProjectsService(db).list_projects(
            user,
            view=view,
            keyword=keyword,
            stage=stage,
            health=health,
            risk_level=risk_level,
            office=office,
            renewal_warning=renewal_warning,
            mine_only=mine_only,
            amount_min=amount_min,
            amount_max=amount_max,
            sow_from=sow_from,
            sow_to=sow_to,
            updated_from=updated_from,
            updated_to=updated_to,
            due_days_min=due_days_min,
            due_days_max=due_days_max,
        )
    except AppError as exc:
        _http_error(exc)


@router.get("/stats", response_model=ProjectStatsResponse)
async def project_stats(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    view: str = Query(default="active"),
):
    try:
        return await ProjectsService(db).stats(user, view=view)
    except AppError as exc:
        _http_error(exc)


@router.get("/dashboard", response_model=ProjectDashboardResponse)
async def project_dashboard(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).dashboard(user)
    except AppError as exc:
        _http_error(exc)


@router.get("/reports/auto", response_model=ProjectReportResponse)
async def auto_project_report(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    period: str = Query(default="week"),
):
    try:
        return await ProjectsService(db).report(user, period=period)
    except AppError as exc:
        _http_error(exc)


@router.get("/problem-pool", response_model=ProjectWorkItemsResponse)
async def project_problem_pool(
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    keyword: str | None = Query(default=None),
):
    try:
        return await ProjectsService(db).problem_pool(user, keyword=keyword)
    except AppError as exc:
        _http_error(exc)


@router.post("/ensure-from-contract/{contract_id}", response_model=ProjectRecord)
async def ensure_from_contract(
    contract_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).ensure_from_contract_id(user, contract_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/by-contract/{contract_id}", response_model=ProjectRecord)
async def get_project_by_contract(
    contract_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).get_project_by_contract(user, contract_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/by-customer/{customer_id}", response_model=ProjectListResponse)
async def list_projects_by_customer(
    customer_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).list_projects_by_customer(user, customer_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}", response_model=ProjectRecord)
async def get_project(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).get_project(user, project_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}/attachments", response_model=ProjectAttachmentsResponse)
async def list_project_attachments(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).list_attachments(user, project_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}/sow-versions", response_model=ProjectSowVersionsResponse)
async def list_project_sow_versions(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).list_sow_versions(user, project_id)
    except AppError as exc:
        _http_error(exc)


@router.post("/{project_id}/sow-versions", response_model=ProjectSowVersionsResponse)
async def create_project_sow_version(
    project_id: str,
    body: CreateProjectSowVersionBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).create_sow_version(user, project_id, body)
    except AppError as exc:
        _http_error(exc)


@router.post("/{project_id}/attachments", response_model=ProjectAttachmentsResponse)
async def upload_project_attachments(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    files: Annotated[list[UploadFile], File(description="项目附件（图片、PDF、Office、文本、ZIP）")],
):
    saved_ids: list[str] = []
    try:
        if not files:
            raise ValidationError("请选择要上传的项目附件")

        saved_ids = await save_upload_files(files, uploaded_by=user.id)
        records = build_attachment_records(saved_ids)
        return await ProjectsService(db).add_attachments(user, project_id, records)
    except Exception as exc:
        for attachment_id in saved_ids:
            try:
                delete_attachment(attachment_id, user_id=user.id)
            except Exception:
                pass
        if isinstance(exc, AppError):
            _http_error(exc)
        raise


@router.patch("/{project_id}", response_model=ProjectRecord)
async def patch_project(
    project_id: str,
    body: PatchProjectBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).patch_project(user, project_id, body)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}/notes", response_model=ProjectNotesResponse)
async def list_project_notes(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    kind: str | None = Query(default=None),
):
    try:
        return await ProjectsService(db).list_notes(user, project_id, kind=kind)
    except AppError as exc:
        _http_error(exc)


@router.post("/{project_id}/notes", response_model=ProjectNoteItem)
async def create_project_note(
    project_id: str,
    body: CreateProjectNoteBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).add_note(user, project_id, body)
    except AppError as exc:
        _http_error(exc)


@router.delete("/{project_id}/notes/{note_id}", status_code=204)
async def delete_project_note(
    project_id: str,
    note_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        await ProjectsService(db).delete_note(user, project_id, note_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}/work-items", response_model=ProjectWorkItemsResponse)
async def list_project_work_items(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    kind: str | None = Query(default=None),
):
    try:
        return await ProjectsService(db).list_work_items(user, project_id, kind=kind)
    except AppError as exc:
        _http_error(exc)


@router.post("/{project_id}/work-items", response_model=ProjectWorkItemRecord)
async def create_project_work_item(
    project_id: str,
    body: ProjectWorkItemBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).create_work_item(user, project_id, body)
    except AppError as exc:
        _http_error(exc)


@router.patch("/{project_id}/work-items/{item_id}", response_model=ProjectWorkItemRecord)
async def patch_project_work_item(
    project_id: str,
    item_id: str,
    body: ProjectWorkItemBody,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).patch_work_item(user, project_id, item_id, body)
    except AppError as exc:
        _http_error(exc)


@router.delete("/{project_id}/work-items/{item_id}", status_code=204)
async def delete_project_work_item(
    project_id: str,
    item_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        await ProjectsService(db).delete_work_item(user, project_id, item_id)
    except AppError as exc:
        _http_error(exc)


@router.get("/{project_id}/payments", response_model=ProjectPaymentSummary)
async def project_payment_summary(
    project_id: str,
    user: Annotated[AuthUser, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
):
    try:
        return await ProjectsService(db).payment_summary(user, project_id)
    except AppError as exc:
        _http_error(exc)
