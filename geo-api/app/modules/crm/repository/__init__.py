# 兼容历史导入：模型类曾通过 repository 模块再导出
from app.models.crm import (  # noqa: F401
    CrmAuditRecord,
    CrmContact,
    CrmContract,
    CrmCustomer,
    CrmCustomerSubsidiary,
    CrmFollowUp,
    CrmLead,
    CrmNotification,
    CrmOpportunity,
    CrmPaymentPlan,
    CrmPublicPoolClaim,
    CrmPublicPoolEntry,
    CrmSalesCoverage,
)
from app.modules.crm.repository.audit import AuditRepositoryMixin
from app.modules.crm.repository.base import (  # noqa: F401  re-export（兼容历史导入）
    _COMPANY_GENERIC_TOKENS,
    _COMPANY_LEGAL_SUFFIXES,
    EMPTY_CUSTOMER_STATS,
    EMPTY_LEAD_STATS,
    PARTIAL_COMPANY_NAME_MIN_LEN,
    PARTIAL_LCS_MIN_LEN,
    CrmRepositoryBase,
    _coverage_contact_in_status,
    _customer_company_name_key_expr,
    _doc_date,
    _doc_decimal,
    _doc_dt,
    _doc_dt_lenient,
    _doc_str,
    _format_dt,
    _format_note_date,
    _longest_common_substring_len,
    _mentions_list,
    _now,
    _split_filter_values,
    company_name_core,
    company_name_match_kind,
    company_name_partial_needles,
    new_id,
    normalize_company_name_key,
    strip_company_generic_tokens,
    strip_company_legal_suffixes,
    sync_attachments,
    sync_audit_changes,
    sync_coverage_import_meta,
    sync_lead_import_meta,
    sync_lead_notes,
    sync_opportunity_links,
    sync_opportunity_notes,
    sync_stage_history,
)
from app.modules.crm.repository.contracts import ContractsRepositoryMixin
from app.modules.crm.repository.coverages import CoveragesRepositoryMixin
from app.modules.crm.repository.customers import CustomersRepositoryMixin
from app.modules.crm.repository.leads import LeadsRepositoryMixin
from app.modules.crm.repository.notifications import NotificationsRepositoryMixin
from app.modules.crm.repository.opportunities import OpportunitiesRepositoryMixin
from app.modules.crm.repository.public_pool import PublicPoolRepositoryMixin
from app.modules.crm.repository.workbench import WorkbenchRepositoryMixin


class CrmRepository(
    CrmRepositoryBase,
    LeadsRepositoryMixin,
    CoveragesRepositoryMixin,
    CustomersRepositoryMixin,
    WorkbenchRepositoryMixin,
    OpportunitiesRepositoryMixin,
    ContractsRepositoryMixin,
    PublicPoolRepositoryMixin,
    AuditRepositoryMixin,
    NotificationsRepositoryMixin,
):
    """CRM 仓储聚合（拆分后保持原 CrmRepository 接口不变）。"""
