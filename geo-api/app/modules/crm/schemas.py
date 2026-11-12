from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import Field

from app.modules.auth.schemas import CamelModel


class CrmDocumentBody(CamelModel):
    """前端提交完整 CRM 文档（camelCase 字段，与 geo-admin 类型对齐）。"""

    document: dict[str, Any]


class TeamMemberCreate(CamelModel):
    user_id: str = Field(min_length=1, max_length=36)
    role: str = Field(min_length=1, max_length=32)
    permission: str = Field(pattern="^(read|edit)$")


class TeamMembersAddBody(CamelModel):
    members: list[TeamMemberCreate] = Field(min_length=1, max_length=50)


class TeamMemberPermissionBody(CamelModel):
    permission: str = Field(pattern="^(read|edit)$")


class PaymentPlanBody(CamelModel):
    period_index: int | None = Field(default=None, ge=1, le=999)
    period_name: str | None = Field(default=None, max_length=64)
    planned_amount: float | None = Field(default=None, ge=0)
    planned_date: date | None = None
    invoice_status: str | None = None
    invoice_date: date | None = None
    invoice_amount: float | None = Field(default=None, ge=0)
    invoice_attachment: dict[str, Any] | None = None
    actual_payment_date: date | None = None
    actual_amount: float | None = Field(default=None, ge=0)
    receipt_attachment: dict[str, Any] | None = None


class LeadSourceOptionCreateBody(CamelModel):
    primary_source: str = Field(min_length=1, max_length=64)
    start_date: date | None = None
    name: str = Field(min_length=1, max_length=128)
    organizer: str | None = Field(default=None, min_length=1, max_length=128)
    sort_order: int = 0


class LeadSourceOptionUpdateBody(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    sort_order: int | None = None


class LeadSourceOptionDeleteBody(CamelModel):
    reason: str = Field(min_length=1, max_length=500)


class ConvertLeadResponse(CamelModel):
    lead: dict[str, Any]
    customer: dict[str, Any]


class ConvertLeadBody(CamelModel):
    """线索转客户：新建或挂靠已有客户。"""

    mode: str = "create"  # create | link
    customer_id: str | None = None
    sales: str | None = None


class ConvertCandidatesResponse(CamelModel):
    """打开「生成客户」时的同名/同信用代码候选。"""

    items: list[dict[str, Any]] = Field(default_factory=list)
    hidden_match_count: int = 0
    company_name: str = ""
    credit_code: str = ""


class BatchAssignCustomerOwnerBody(CamelModel):
    """客户列表：批量指定销售负责人。"""

    customer_ids: list[str] = Field(default_factory=list, min_length=1, max_length=100)
    owner: str


class TransferContactOwnerBody(CamelModel):
    """客户详情联系人：Leader/运营/管理员改派联系人成员归属（池间移动）。"""

    target_owner_name: str = Field(min_length=1, max_length=128)


class PublicPoolReleaseBody(CamelModel):
    reason: str = Field(min_length=1, max_length=1000)
    coverage_id: str | None = None


class PublicPoolReviewBody(CamelModel):
    approved: bool
    reason: str = Field(default="", max_length=1000)


class AssignableContactOwnerItem(CamelModel):
    id: str
    name: str


class AssignableContactOwnersResponse(CamelModel):
    """改派联系人归属时可选的销售成员（服务端按可指派集合下发）。"""

    items: list[AssignableContactOwnerItem] = Field(default_factory=list)


class BatchAssignCustomerOwnerItem(CamelModel):
    customer_id: str
    company_name: str = ""
    reason: str = ""


class BatchAssignCustomerOwnerResponse(CamelModel):
    owner: str
    succeeded: list[BatchAssignCustomerOwnerItem] = Field(default_factory=list)
    failed: list[BatchAssignCustomerOwnerItem] = Field(default_factory=list)


class OpportunityStageBody(CamelModel):
    stage: str
    document: dict[str, Any] | None = None


class MarkLostBody(CamelModel):
    lost_stage: str
    lost_reason_l1: str
    lost_reason_l2: str
    competitor: str = ""
    document: dict[str, Any] | None = None


class LeadStatsResponse(CamelModel):
    total: int = 0
    today: int = 0
    untouched: int = 0
    touched: int = 0
    converted: int = 0
    invalid: int = 0


class LeadListResponse(CamelModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10


class CustomerStatsResponse(CamelModel):
    total: int = 0
    cooperating: int = 0
    awaiting_contact: int = 0
    connected: int = 0
    opportunity_following: int = 0
    stopped: int = 0
    # 旧字段兼容
    following: int = 0
    potential: int = 0
    lost: int = 0
    key: int = 0


class CustomerListResponse(CamelModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 10


class WorkbenchStatsResponse(CamelModel):
    """首页工作台聚合指标（由后端按权限与数据范围计算）。"""

    leads_total: int = 0
    leads_need: int = 0
    leads_untouched: int = 0
    leads_to_transfer: int = 0
    leads_converted: int = 0
    leads_invalid: int = 0
    lead_rate: int = 0
    customers_total: int = 0
    customers_active: int = 0
    customers_stale: int = 0
    customers_cooperating: int = 0
    opps_total: int = 0
    opps_active: int = 0
    opps_follow_due: int = 0
    opps_stale: int = 0
    opps_lost_no_reason: int = 0
    opps_signing: int = 0
    opps_won: int = 0
    opps_lost: int = 0
    month_expected: float = 0
    won_amount: float = 0
    req_pending: int = 0
    req_supplement: int = 0
    req_confirmed: int = 0
    signing_contracts: int = 0
    signed_contracts: int = 0
    contracts_total: int = 0
    contracts_pending: int = 0
    contract_amount: float = 0
    projects_total: int = 0
    projects_active: int = 0
    projects_delayed: int = 0
    projects_renewal_warning: int = 0
    projects_unhealthy: int = 0
    projects_completed: int = 0


class CrmBootstrapResponse(CamelModel):
    leads: list[dict[str, Any]] = Field(default_factory=list)
    customers: list[dict[str, Any]] = Field(default_factory=list)
    opportunities: list[dict[str, Any]] = Field(default_factory=list)
    contracts: list[dict[str, Any]] = Field(default_factory=list)
    lead_stats: LeadStatsResponse = Field(default_factory=LeadStatsResponse)
    customer_stats: CustomerStatsResponse = Field(default_factory=CustomerStatsResponse)


class CrmAttachment(CamelModel):
    id: str
    url: str
    storage_path: str | None = None
    name: str | None = None
    original_name: str | None = None
    content_type: str | None = None
    size: int | None = None
    uploaded_at: str | None = None
    uploaded_by: str | None = None


class CrmAttachmentUploadResponse(CamelModel):
    attachment_ids: list[str] = Field(default_factory=list)
    attachments: list[CrmAttachment] = Field(default_factory=list)


class AuditChangeItem(CamelModel):
    field: str
    label: str = ""
    before: str = ""
    after: str = ""


class AuditRecordCreateBody(CamelModel):
    module: str
    entity_type: str
    entity_id: str
    related_entity_ids: list[str] | None = None
    entity_name: str = ""
    action: str
    changes: list[AuditChangeItem] = Field(default_factory=list)
    # 可选：客户端迁移旧 localStorage 时传入
    id: str | None = None
    actor: str | None = None
    timestamp: str | None = None


class AuditRecordResponse(CamelModel):
    id: str
    module: str
    entity_type: str
    entity_id: str
    related_entity_ids: list[str] | None = None
    entity_name: str = ""
    action: str
    actor: str
    timestamp: str
    changes: list[AuditChangeItem] = Field(default_factory=list)
    # lead = 线索转客户带入的 SDR 操作历史
    origin: str | None = None


class AuditListResponse(CamelModel):
    items: list[AuditRecordResponse] = Field(default_factory=list)


class FollowUpCommentCreateBody(CamelModel):
    follow_up_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=1000)


class FollowUpCommentResponse(CamelModel):
    id: str
    follow_up_id: str
    author_user_id: str | None = None
    author_name: str
    author_role: str
    content: str
    created_at: str


class FollowUpCommentListResponse(CamelModel):
    items: list[FollowUpCommentResponse] = Field(default_factory=list)


class NotificationCreateItem(CamelModel):
    target_name: str
    message: str
    href: str = ""


class NotificationCreateBody(CamelModel):
    items: list[NotificationCreateItem] = Field(default_factory=list)
    """业务范围：leads / customers / requests / opportunities；传入后只通知有权限打开该模块的人。"""
    mention_scope: str | None = None


class NotificationResponse(CamelModel):
    id: str
    target_name: str
    actor: str
    message: str
    href: str = ""
    created_at: str
    read: bool = False


class NotificationListResponse(CamelModel):
    items: list[NotificationResponse] = Field(default_factory=list)
