from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.modules.crm.repository import (
    new_id,
)
from app.modules.crm.service.base import (
    FEISHU_OPP_STAGE_MAP,
    LEGACY_OPP_STAGE_MAP,
    OPP_FLOW_STAGES,
    OPP_STAGE_LABELS,
)
from app.modules.crm.service.helpers_common import _doc


def normalize_opp_stage(raw: str | None) -> str:
    s = str(raw or "").strip()
    if s in OPP_STAGE_LABELS and s not in LEGACY_OPP_STAGE_MAP:
        return s
    if s in FEISHU_OPP_STAGE_MAP:
        return FEISHU_OPP_STAGE_MAP[s]
    if s in LEGACY_OPP_STAGE_MAP:
        return LEGACY_OPP_STAGE_MAP[s]
    return s or "contact"

def _opp_flow_index(stage: str) -> int:
    try:
        return OPP_FLOW_STAGES.index(normalize_opp_stage(stage))
    except ValueError:
        return -1

def _is_opp_stage_rollback(prev_stage: str, new_stage: str) -> bool:
    prev_idx = _opp_flow_index(prev_stage)
    new_idx = _opp_flow_index(new_stage)
    if prev_idx < 0 or new_idx < 0:
        return False
    return new_idx < prev_idx

def _normalize_opportunity_document(document: dict[str, Any]) -> dict[str, Any]:
    """商机 document 契约：已有数组字段规范化；禁止把缺键静默填成 []（掩盖漏 compose）。"""
    doc = dict(document or {})
    doc["stage"] = normalize_opp_stage(str(doc.get("stage") or "contact"))
    for key in ("projectTypes", "notes", "advisorNotes", "attachments", "requestIds", "stageHistory"):
        if key not in doc:
            continue
        raw = doc.get(key)
        if key == "requestIds":
            if not isinstance(raw, list):
                doc[key] = []
            else:
                doc[key] = [str(x).strip() for x in raw if str(x).strip()][-1:]
            continue
        if key == "stageHistory":
            fallback_time = str(doc.get("lastFollowAt") or doc.get("createdAt") or "").strip()
            history_out: list[dict[str, Any]] = []
            if isinstance(raw, list):
                for item in raw:
                    if not isinstance(item, dict):
                        continue
                    entry = dict(item)
                    if not str(entry.get("enteredAt") or "").strip():
                        entry["enteredAt"] = fallback_time
                    history_out.append(entry)
            doc[key] = history_out
            continue
        if not isinstance(raw, list):
            doc[key] = []
    return doc

def _opportunity_doc(row) -> dict[str, Any]:
    return _normalize_opportunity_document(_doc(row))


def _opportunity_response(
    row: Any,
    *,
    stageHistory: list[dict[str, Any]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    projectTypes: list[str] | None = None,
    requestIds: list[str] | None = None,
    notes: list[dict[str, Any]] | None = None,
    advisorNotes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """商机响应组装：已列化/已建表字段以列与子表为权威源。

    试点阶段 E（034/035 已回填+双写）：stage/amount/expectedSignDate/lastFollowAt/
    nextFollowAt/lostReason 读列，stageHistory/attachments/notes/advisorNotes 读子表；
    其余暂未迁移字段仍从 document 过渡读取，前端契约保持不变。
    """
    doc = _opportunity_doc(row)
    doc.pop("projectManagerRequestJson", None)
    raw_manager_request = getattr(row, "project_manager_request_json", None)
    if raw_manager_request:
        try:
            parsed_manager_request = json.loads(raw_manager_request)
        except (TypeError, ValueError):
            parsed_manager_request = None
        if isinstance(parsed_manager_request, dict):
            doc["projectManagerRequest"] = parsed_manager_request
    if getattr(row, "stage", None) is not None:
        doc["stage"] = normalize_opp_stage(str(row.stage))
    amount = getattr(row, "amount", None)
    if amount is not None:
        doc["amount"] = float(amount)
    else:
        # 历史/未填写商机 amount 可能为空：契约统一返回数字，避免前端求和出现 NaN
        try:
            doc["amount"] = float(doc.get("amount") or 0)
        except (TypeError, ValueError):
            doc["amount"] = 0.0
    if getattr(row, "expected_sign_date", None) is not None:
        doc["expectedSignDate"] = row.expected_sign_date.strftime("%Y-%m-%d")
    if getattr(row, "last_follow_at", None) is not None:
        doc["lastFollowAt"] = row.last_follow_at.strftime("%Y-%m-%d")
    if getattr(row, "next_follow_at", None) is not None:
        doc["nextFollowAt"] = row.next_follow_at.strftime("%Y-%m-%d")
    if getattr(row, "lost_reason", None) is not None:
        doc["lostReason"] = row.lost_reason
    if stageHistory is not None:
        doc["stageHistory"] = stageHistory
    if attachments is not None:
        doc["attachments"] = attachments
    if projectTypes is not None:
        doc["projectTypes"] = projectTypes
    if requestIds is not None:
        doc["requestIds"] = requestIds
    if notes is not None:
        doc["notes"] = notes
    if advisorNotes is not None:
        doc["advisorNotes"] = advisorNotes
    for column, key in (
        ("name", "name"),
        ("brand_name", "brandName"),
        ("region", "region"),
        ("geo_source", "geoSource"),
        ("goal", "goal"),
        ("platform", "platform"),
        ("period", "period"),
        ("owner", "owner"),
        ("advisor", "advisor"),
        ("customer_success", "customerSuccess"),
        ("subsidiary_id", "subsidiaryId"),
        ("subsidiary_name", "subsidiaryName"),
        ("primary_contact_id", "primaryContactId"),
        ("lost_stage", "lostStage"),
        ("lost_reason_l1", "lostReasonL1"),
        ("lost_reason_l2", "lostReasonL2"),
        ("competitor", "competitor"),
    ):
        value = getattr(row, column, None)
        if value is not None:
            doc[key] = value
    if getattr(row, "probability", None) is not None:
        doc["probability"] = row.probability
    if getattr(row, "created_day", None) is not None:
        doc["createdAt"] = row.created_day.strftime("%Y-%m-%d")
    return doc


def _carry_request_notes_to_opportunity(notes: Any, *, request_id: str) -> list[dict[str, Any]]:
    """把需求跟进复制到商机，并标注来自需求。"""
    if not isinstance(notes, list):
        return []
    carried: list[dict[str, Any]] = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        content = str(note.get("content") or "").strip()
        if not content:
            continue
        note_id = str(note.get("id") or "").strip()
        carried.append(
            {
                "id": new_id("on"),
                "author": str(note.get("author") or ""),
                "content": content,
                "date": str(note.get("createdAt") or note.get("date") or ""),
                "origin": "request",
                "sourceRequestId": request_id,
                "sourceRequestNoteId": note_id or None,
            }
        )
    return carried

def _carry_request_attachments_to_opportunity(
    attachments: Any, *, request_id: str
) -> list[dict[str, Any]]:
    """把需求附件引用带到商机（同一磁盘文件），并标注来自需求。"""
    if not isinstance(attachments, list):
        return []
    carried: list[dict[str, Any]] = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        file_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or item.get("originalName") or "").strip()
        if not file_id or not name:
            continue
        source_url = str(item.get("url") or "").strip()
        suffix = Path(file_id).suffix
        carried_id = f"{uuid4()}{suffix}" if suffix else new_id("at")
        # crm_attachments.id 是全局主键，不能复用需求附件 id；本地文件仍通过
        # sourceRequestAttachmentId 解析到同一份物理文件，避免复制文件。
        url = (
            source_url
            if source_url and "/api/crm/attachments/" not in source_url
            else f"/api/crm/attachments/{carried_id}"
        )
        description = str(item.get("description") or "").strip()
        carried.append(
            {
                "id": carried_id,
                "name": name,
                "url": url,
                "storagePath": item.get("storagePath") or item.get("storage_path"),
                "contentType": item.get("contentType") or item.get("content_type"),
                "size": int(item.get("size") or 0),
                "uploadedAt": str(item.get("uploadedAt") or item.get("uploaded_at") or ""),
                "uploadedBy": str(item.get("uploadedBy") or item.get("uploaded_by") or ""),
                "description": description or None,
                "origin": "request",
                "sourceRequestId": request_id,
                "sourceRequestAttachmentId": file_id,
            }
        )
    return carried
