from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import Field

from app.modules.auth.schemas import CamelModel

ProjectStage = Literal["pending_start", "active", "completed", "paused"]
ProjectHealth = Literal["healthy", "watch", "unhealthy"]
ProjectRisk = Literal["low", "medium", "high"]
ProjectNoteKind = Literal["weekly", "communication", "execution", "risk", "next_step", "other"]
ProjectListView = Literal["active", "archive"]
ProjectWorkItemKind = Literal[
    "task", "issue", "change", "risk", "follow_up", "help", "appeasement", "delay", "delivery"
]


class ProjectNoteItem(CamelModel):
    id: str
    project_id: str
    kind: ProjectNoteKind
    content: str
    created_at: str
    created_by: str
    created_by_user_id: str | None = None


class ProjectRecord(CamelModel):
    id: str
    name: str
    customer_id: str
    customer_name: str
    source_contract_id: str
    opportunity_id: str | None = None
    geo_source: str | None = None
    stage: ProjectStage
    health: ProjectHealth
    risk_level: ProjectRisk
    biz_owner: str = ""
    biz_owner_user_id: str | None = None
    project_manager: str = ""
    project_manager_user_id: str | None = None
    project_leader: str = ""
    executor: str = ""
    executor_user_id: str | None = None
    content_ops: str = ""
    content_ops_user_id: str | None = None
    content_ops_members: list[str] = Field(default_factory=list)
    contract_amount: float | None = None
    customer_industry: str = ""
    customer_type: str = ""
    customer_region: str = ""
    contact_info: str = ""
    team_name: str = ""
    content_team_name: str = ""
    office: str = ""
    customer_level: str = ""
    customer_tags: list[str] = Field(default_factory=list)
    assistant_members: list[str] = Field(default_factory=list)
    execution_members: list[str] = Field(default_factory=list)
    acceptance_criteria: str = ""
    project_types: list[str] = Field(default_factory=list)
    intent_brand: int = 0
    intent_content: int = 0
    intent_search: int = 0
    platforms: list[str] = Field(default_factory=list)
    detection_platforms: list[str] = Field(default_factory=list)
    monitoring_intent_count: int = 0
    renewal_status: Literal["", "yes", "no"] = ""
    kpi_notes: str = ""
    start_date: str | None = None
    planned_start_date: str | None = None
    sow_end_date: str | None = None
    original_delivery_date: str | None = None
    latest_delivery_date: str | None = None
    actual_delivery_date: str | None = None
    delay_reason: str = ""
    remediation_plan: str = ""
    delay_customer_note: str = ""
    created_at: str
    updated_at: str
    created_by: str | None = None
    updated_by: str | None = None
    archived_at: str | None = None
    # computed
    intent_total: int = 0
    days_to_sow_end: int | None = None
    delay_duration_days: int | None = None
    renewal_warning: bool = False
    overdue: bool = False
    delivery_delay_days: int = 0


class ProjectListResponse(CamelModel):
    items: list[ProjectRecord]
    total: int


class ProjectStatsResponse(CamelModel):
    active: int = 0
    delayed: int = 0
    renewal_warning: int = 0
    unhealthy: int = 0
    completed: int = 0


class ProjectWorkItemRecord(CamelModel):
    id: str
    project_id: str
    kind: ProjectWorkItemKind
    title: str
    description: str = ""
    category: str = ""
    status: str = "pending"
    owner: str = ""
    owner_user_id: str | None = None
    due_date: str | None = None
    priority: str = "medium"
    risk_level: str = "low"
    solution: str = ""
    occurred_at: str | None = None
    resolved_at: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    created_by: str = ""
    created_by_user_id: str | None = None
    created_at: str
    updated_at: str
    overdue: bool = False


class ProjectWorkItemsResponse(CamelModel):
    items: list[ProjectWorkItemRecord] = Field(default_factory=list)


class ProjectWorkItemBody(CamelModel):
    kind: ProjectWorkItemKind | None = None
    title: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    owner: str | None = None
    owner_user_id: str | None = None
    due_date: date | None = None
    priority: str | None = None
    risk_level: str | None = None
    solution: str | None = None
    occurred_at: str | None = None
    resolved_at: str | None = None
    data: dict[str, Any] | None = None
    clear_due_date: bool | None = None


class ProjectPaymentSummary(CamelModel):
    contract_amount: float = 0
    planned_amount: float = 0
    paid_amount: float = 0
    outstanding_amount: float = 0
    overdue_amount: float = 0
    next_payment_date: str | None = None
    status: str = "normal"
    plans: list[dict[str, Any]] = Field(default_factory=list)


class ProjectDashboardResponse(CamelModel):
    total: int = 0
    pending_start: int = 0
    in_transit: int = 0
    completed: int = 0
    delayed: int = 0
    delay_rate: float = 0
    office_distribution: dict[str, int] = Field(default_factory=dict)
    customer_level_distribution: dict[str, int] = Field(default_factory=dict)
    team_member_distribution: list[dict[str, Any]] = Field(default_factory=list)
    appeasement_count: int = 0
    issue_total: int = 0
    issue_resolved: int = 0
    leader_answered_count: int = 0
    issue_resolution_rate: float = 0
    open_issues: int = 0
    overdue_issues: int = 0
    high_risk_projects: int = 0
    task_total: int = 0
    task_completed: int = 0
    task_completion_rate: float = 0
    top_blockers: list[dict[str, Any]] = Field(default_factory=list)
    planned_payment_amount: float = 0
    paid_amount: float = 0
    outstanding_amount: float = 0
    overdue_payment_amount: float = 0
    drilldowns: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    generated_at: str = ""


class ProjectReportResponse(CamelModel):
    period: str
    title: str
    generated_at: str
    content: str


class PatchProjectBody(CamelModel):
    name: str | None = None
    stage: ProjectStage | None = None
    health: ProjectHealth | None = None
    risk_level: ProjectRisk | None = None
    biz_owner: str | None = None
    biz_owner_user_id: str | None = None
    project_manager: str | None = None
    project_manager_user_id: str | None = None
    project_leader: str | None = None
    executor: str | None = None
    executor_user_id: str | None = None
    content_ops: str | None = None
    content_ops_user_id: str | None = None
    content_ops_members: list[str] | None = None
    contract_amount: float | None = None
    contact_info: str | None = None
    team_name: str | None = None
    content_team_name: str | None = None
    office: str | None = None
    customer_level: str | None = None
    customer_tags: list[str] | None = None
    assistant_members: list[str] | None = None
    execution_members: list[str] | None = None
    acceptance_criteria: str | None = None
    project_types: list[str] | None = None
    intent_brand: int | None = None
    intent_content: int | None = None
    intent_search: int | None = None
    optimization_intent_count: int | None = None
    platforms: list[str] | None = None
    detection_platforms: list[str] | None = None
    monitoring_intent_count: int | None = None
    renewal_status: Literal["", "yes", "no"] | None = None
    kpi_notes: str | None = None
    start_date: date | None = None
    planned_start_date: date | None = None
    sow_end_date: date | None = None
    original_delivery_date: date | None = None
    latest_delivery_date: date | None = None
    actual_delivery_date: date | None = None
    delay_reason: str | None = None
    remediation_plan: str | None = None
    delay_customer_note: str | None = None
    # allow clearing dates via explicit null in JSON — use sentinel strings in service if needed
    clear_start_date: bool | None = None
    clear_planned_start_date: bool | None = None
    clear_sow_end_date: bool | None = None
    clear_original_delivery_date: bool | None = None
    clear_latest_delivery_date: bool | None = None
    clear_actual_delivery_date: bool | None = None


class CreateProjectNoteBody(CamelModel):
    kind: ProjectNoteKind = "other"
    content: str


class ProjectNotesResponse(CamelModel):
    items: list[ProjectNoteItem]


class ProjectAttachmentItem(CamelModel):
    id: str
    name: str
    size: int = 0
    url: str
    content_type: str = "application/pdf"
    storage_path: str | None = None
    uploaded_at: str = ""
    uploaded_by: str = ""


class ProjectAttachmentsResponse(CamelModel):
    items: list[ProjectAttachmentItem] = Field(default_factory=list)


class ProjectSowClause(CamelModel):
    title: str
    content: str


class ProjectSowVersionRecord(CamelModel):
    id: str
    project_id: str
    version_no: int
    is_current: bool = False
    sow_end_date: str
    project_types: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    optimization_intent_count: int = 0
    optimization_target: str = ""
    acceptance_criteria: str = ""
    clauses: list[ProjectSowClause] = Field(default_factory=list)
    change_reason: str = ""
    confirmer: str = ""
    source_change_id: str | None = None
    created_by: str = ""
    created_at: str = ""
    virtual: bool = False


class ProjectSowVersionsResponse(CamelModel):
    current: ProjectSowVersionRecord
    items: list[ProjectSowVersionRecord] = Field(default_factory=list)


class CreateProjectSowVersionBody(CamelModel):
    sow_end_date: date
    project_types: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(default_factory=list)
    optimization_intent_count: int = 0
    optimization_target: str = ""
    acceptance_criteria: str = ""
    clauses: list[ProjectSowClause] = Field(default_factory=list)
    change_type: str
    change_reason: str
    confirmer: str = ""
    attachments: list[ProjectAttachmentItem] = Field(default_factory=list)
