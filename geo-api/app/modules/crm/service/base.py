from __future__ import annotations

from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contracts.status_catalog import (
    CONTRACT_STATUS_META as _CONTRACT_STATUS_CATALOG,
)
from app.modules.contracts.status_catalog import (
    MEETING_PRIMARY_SOURCES as _MEETING_PRIMARY_SOURCES_CATALOG,
)
from app.modules.contracts.status_catalog import (
    OPP_STAGE_META as _OPP_STAGE_CATALOG,
)
from app.modules.contracts.status_catalog import (
    REQUEST_STATUS_META as _REQUEST_STATUS_CATALOG,
)
from app.modules.crm.repository import (
    CrmRepository,
)

CHINA_TZ = ZoneInfo("Asia/Shanghai")
# 会议类一级来源从唯一权威源派生。
MEETING_PRIMARY_SOURCES = frozenset(_MEETING_PRIMARY_SOURCES_CATALOG)
CUSTOMER_CREATE_SOURCES = frozenset({*MEETING_PRIMARY_SOURCES, "自拓"})

OPP_FLOW_STAGES = (
    "contact",
    "demand_research",
    "demand_diagnosis",
    "solution_confirm",
    "business_negotiation",
    "bidding",
    "signing",
    "won",
)

"""展示/审计文案 label 一律从唯一权威源 status_catalog.py 派生，禁止本地硬编码。"""
REQUEST_STATUS_LABELS: dict[str, str] = {
    code: meta["label"] for code, meta in _REQUEST_STATUS_CATALOG.items()
}
OPP_STAGE_LABELS: dict[str, str] = {
    code: meta["label"] for code, meta in _OPP_STAGE_CATALOG.items()
}

FEISHU_OPP_STAGE_MAP: dict[str, str] = {
    "需求调研": "demand_research",
    "需求诊断": "demand_diagnosis",
    "方案确认": "solution_confirm",
    "商务谈判": "business_negotiation",
    "招投标阶段": "bidding",
    "签署中": "signing",
    "已签订": "won",
    "输单": "lost",
}

LEGACY_OPP_STAGE_MAP: dict[str, str] = {
    "demand": "demand_diagnosis",
    "solution": "solution_confirm",
    "quote": "business_negotiation",
}

_DEMAND_STAGES = frozenset({"demand_research", "demand_diagnosis", "demand"})
# 合同状态码从唯一权威源 status_catalog.py 派生，禁止本地硬编码。
_CONTRACT_STATUSES = frozenset(_CONTRACT_STATUS_CATALOG.keys())

MSG_CONTRACT_SIGN_NEEDS_FILE = "完成签署前请先上传合同附件（非 SOW）"
MSG_CONTRACT_TERMINAL_READONLY = "已作废/终止的合同不可再编辑合同字段"

"""客户细粒度写权限码（矩阵可按角色配置）；customers:write 为遗留总写码兜底。"""
CUSTOMER_WRITE_CODES = frozenset(
    {
        "customers:create",
        "customers:master_edit",
        "customers:contact_add",
        "customers:contact_edit",
        "customers:follow_add",
        "customers:attachment_upload",
        "customers:status_change",
    }
)

CUSTOMER_MASTER_FIELDS = frozenset(
    {
        "id",
        "companyUid",
        "companyName",
        "brandName",
        "region",
        "city",
        "industryL1",
        "industryL2",
        "foundedDate",
        "creditCode",
        "registeredCapital",
        "annualRevenue",
        "scale",
        "nature",
        "website",
        "subsidiaries",
        "createdAt",
        "createdByUserId",
        "sourceLeadId",
        "sdr",
        "sdrUserId",
        "sdrTransferDate",
        "source",
        "migrationStatus",
        "isolationVersion",
    }
)

CUSTOMER_POOL_FIELDS = frozenset(
    {
        "contacts",
        "notes",
        "attachments",
        "status",
        "owner",
        "lastFollowAt",
        "nextFollowAt",
        "isKey",
        "clientDept",
        "opportunityCount",
        "contractCount",
    }
)

# 响应/计算字段：禁止写回 crm_customers.document
CUSTOMER_RESPONSE_META_FIELDS = frozenset(
    {
        "coverages",
        "myCoverageId",
        "canEditMaster",
        "opportunityCount",
        "contractCount",
    }
)

_MATCH_TYPE_RANK = {"credit": 0, "exact": 1, "partial": 2}

EMPTY_WORKBENCH_STATS: dict[str, Any] = {
    "leads_total": 0,
    "leads_need": 0,
    "leads_untouched": 0,
    "leads_to_transfer": 0,
    "leads_converted": 0,
    "leads_invalid": 0,
    "lead_rate": 0,
    "customers_total": 0,
    "customers_active": 0,
    "customers_stale": 0,
    "customers_cooperating": 0,
    "opps_total": 0,
    "opps_active": 0,
    "opps_follow_due": 0,
    "opps_stale": 0,
    "opps_lost_no_reason": 0,
    "opps_signing": 0,
    "opps_won": 0,
    "opps_lost": 0,
    "month_expected": 0.0,
    "won_amount": 0.0,
    "req_pending": 0,
    "req_supplement": 0,
    "req_confirmed": 0,
    "signing_contracts": 0,
    "signed_contracts": 0,
    "contracts_total": 0,
    "contracts_pending": 0,
    "contract_amount": 0.0,
    "projects_total": 0,
    "projects_active": 0,
    "projects_delayed": 0,
    "projects_renewal_warning": 0,
    "projects_unhealthy": 0,
    "projects_completed": 0,
}


# ===== 兼容历史 re-export（消费方经 base 导入；禁止删，见 noqa）=====
from datetime import date  # noqa: F401
from uuid import uuid4  # noqa: F401

from sqlalchemy import select  # noqa: F401

from app.core.deps import (  # noqa: F401
    user_can_see_unassigned,
    user_can_view_request,
    user_data_scope,
    user_has_permission,
)
from app.core.exceptions import (  # noqa: F401
    AppError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.geo_scope import forced_geo_source  # noqa: F401
from app.core.time_utils import china_now, format_legacy_time  # noqa: F401
from app.models.crm import LeadSourceOption  # noqa: F401
from app.modules.auth.schemas import AuthUser  # noqa: F401
from app.modules.crm.opportunity_request_gate import (  # noqa: F401
    MSG_OPP_ENTER_DEMAND_NEEDS_BIND,
    MSG_OPP_LEAVE_DEMAND_NEEDS_FINISHED,
    MSG_OPP_LINKED_MISSING,
    MSG_OPP_NO_ROLLBACK_TO_CONTACT,
)
from app.modules.crm.repository.base import (  # noqa: F401
    EMPTY_CUSTOMER_STATS,
    EMPTY_LEAD_STATS,
    company_name_match_kind,
    new_id,
)
from app.modules.crm.schemas import (  # noqa: F401
    NotificationCreateBody,
    NotificationResponse,
)
from app.modules.crm.service.base_access import BaseAccessMixin
from app.modules.crm.service.base_audit import BaseAuditMixin
from app.modules.crm.service.base_cache import BaseCacheMixin
from app.modules.crm.service.base_customer import BaseCustomerMixin
from app.modules.crm.service.base_geo import BaseGeoMixin
from app.modules.users.repository import UsersRepository  # noqa: F401

from .helpers_common import (  # noqa: F401
    _as_amount,
    _china_today_iso,
    _created_at_iso,
    _days_since,
    _doc,
    _follow_date_iso,
)
from .helpers_contracts import (  # noqa: F401
    _ensure_contract_code,
    _has_contract_file_attachment,
    _normalize_contract_document,
    _normalize_contract_status,
)
from .helpers_customers import (  # noqa: F401
    _coverage_doc_with_children,
    _coverage_public_doc,
    _customer_match_summary,
    _customer_update_write_codes,
    _extract_pool_fields,
    _pool_fields_have_operating_content,
    _sort_match_items,
    _strip_customer_master_document,
)
from .helpers_leads import (  # noqa: F401
    _carry_lead_attachments_to_customer,
    _carry_lead_notes_to_customer,
    _carry_lead_requirement_to_customer,
    _carry_mark_materials_to_customer,
    _lead_wechat_added,
    _merge_lead_into_existing_customer,
)
from .helpers_opportunities import (  # noqa: F401
    _carry_request_attachments_to_opportunity,
    _carry_request_notes_to_opportunity,
    _is_opp_stage_rollback,
    _normalize_opportunity_document,
    _opp_flow_index,
    _opportunity_doc,
    _opportunity_response,
    normalize_opp_stage,
)
from .helpers_workbench import (  # noqa: F401
    _aggregate_contract_workbench,
    _aggregate_customer_workbench,
    _aggregate_opportunity_workbench,
    _aggregate_request_workbench,
)


class CrmServiceBase(
    BaseAccessMixin,
    BaseGeoMixin,
    BaseCustomerMixin,
    BaseAuditMixin,
    BaseCacheMixin,
):
    def __init__(self, db: AsyncSession):
                self.db = db
                self.repo = CrmRepository(db)
