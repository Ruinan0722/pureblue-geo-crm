from app.modules.crm.service.base import (  # noqa: F401  re-export
    MSG_CONTRACT_SIGN_NEEDS_FILE,
    MSG_CONTRACT_TERMINAL_READONLY,
    CrmServiceBase,
    _aggregate_customer_workbench,
    _aggregate_opportunity_workbench,
    _carry_lead_attachments_to_customer,
    _carry_request_attachments_to_opportunity,
    _carry_request_notes_to_opportunity,
    _customer_update_write_codes,
    _has_contract_file_attachment,
    _lead_wechat_added,
    _merge_lead_into_existing_customer,
    _strip_customer_master_document,
)
from app.modules.crm.service.contracts import ContractMixin
from app.modules.crm.service.customers import CustomerMixin
from app.modules.crm.service.leads import LeadMixin
from app.modules.crm.service.notifications import NotificationMixin
from app.modules.crm.service.opportunities import OpportunityMixin
from app.modules.crm.service.public_pool import PublicPoolMixin
from app.modules.crm.service.workbench import WorkbenchMixin


class CrmService(
    CrmServiceBase,
    LeadMixin,
    CustomerMixin,
    OpportunityMixin,
    ContractMixin,
    NotificationMixin,
    WorkbenchMixin,
    PublicPoolMixin,
):
    """线索/客户/商机/合同/通知/工作台聚合服务（拆分后保持原 CrmService 接口不变）。"""
