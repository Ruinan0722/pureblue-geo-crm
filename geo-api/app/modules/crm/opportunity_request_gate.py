"""商机 ↔ 需求闸门常量（与 geo-admin opportunity-request-gate.ts 保持一致）。

权威：本模块为服务端校验唯一真相；前端闸门仅做体验提示。
"""

from __future__ import annotations

from app.modules.contracts.status_catalog import (
    REQUEST_STATUS_ACTIONS as _REQUEST_STATUS_ACTIONS_CATALOG,
)

# 可离开商机「需求确认」节点：须需求已完成绑定并自动闭环（in_project）
REQUEST_FINISHED_STATUSES = frozenset({"in_project", "approved"})

# 推进到这些状态前必须已绑定商机
REQUEST_STATUSES_REQUIRE_OPPORTUNITY = frozenset({"in_project", "approved"})

# 已绑定商机后仍允许的正向状态推进（回退到待销售确认后可重新走完）
REQUEST_STATUS_TRANSITIONS_ALLOWED_WHEN_BOUND = frozenset(
    (from_code, meta["next"])
    for from_code, meta in _REQUEST_STATUS_ACTIONS_CATALOG.items()
)

MSG_REQUEST_REQUIRES_OPPORTUNITY = "需求闭环前，请先完成商机绑定"
MSG_REQUEST_LOCKED_AFTER_BIND_STATUS = (
    "已绑定商机后仅允许按流程推进需求状态（待销售确认→待绑定商机→已绑定商机）"
)
MSG_REQUEST_LOCKED_AFTER_BIND_OWNER = "已绑定商机后不可再修改跟进人"
MSG_OPP_ENTER_DEMAND_NEEDS_BIND = (
    "进入「需求调研」前，请先在「初步接触」阶段完成需求与商机的绑定"
)
MSG_OPP_LEAVE_DEMAND_NEEDS_FINISHED = (
    "关联需求完成绑定并自动闭环后，才能推进至「方案确认」及后续阶段"
)
MSG_OPP_LINKED_MISSING = "关联的需求单不存在，请重新绑定后再推进"
MSG_OPP_NO_ROLLBACK_TO_CONTACT = (
    "已离开「初步接触」后不可再回退至该阶段，请继续推进或标记输单"
)
