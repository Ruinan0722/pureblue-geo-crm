from __future__ import annotations

from typing import Any

from app.modules.crm.service.base import (
    _CONTRACT_STATUSES,
)


def _normalize_contract_status(status: Any) -> str:
    """合同状态：飞书 1:1；历史 signing → pending。"""
    value = str(status or "").strip()
    feishu = {
        "待签订": "pending",
        "已签订": "signed",
        "签订后终止": "terminated",
        "已关闭": "closed",
    }
    if value in feishu:
        return feishu[value]
    if value in _CONTRACT_STATUSES:
        return value
    if value == "signing":
        return "pending"
    return "pending"

def _ensure_contract_code(document: dict[str, Any]) -> dict[str, Any]:
    """保留传入编码；飞书或手工合同缺少编码时保持为空。"""
    return {**document, "code": str(document.get("code") or "").strip()}

def _normalize_contract_document(document: dict[str, Any]) -> dict[str, Any]:
    doc = dict(document or {})
    doc["status"] = _normalize_contract_status(doc.get("status"))
    return doc

def _has_contract_file_attachment(attachments: Any) -> bool:
    """签署闸门：须至少有一份合同文件（kind 缺省或为 contract；SOW 不算）。"""
    if not isinstance(attachments, list):
        return False
    for item in attachments:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "contract").strip().lower()
        if kind in ("sow", "sow文档"):
            continue
        if kind not in ("", "contract", "合同"):
            continue
        if str(item.get("id") or item.get("name") or item.get("url") or "").strip():
            return True
    return False
