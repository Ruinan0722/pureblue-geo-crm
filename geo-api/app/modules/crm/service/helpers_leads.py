from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from app.modules.crm.repository import (
    new_id,
)


def _carry_lead_notes_to_customer(notes: Any, *, lead_id: str) -> list[dict[str, Any]]:
    """把线索跟进复制到客户，并标注来自线索。"""
    if not isinstance(notes, list):
        return []
    carried: list[dict[str, Any]] = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        content = str(note.get("content") or "").strip()
        if not content:
            continue
        carried.append(
            {
                "id": new_id("cn"),
                "author": str(note.get("author") or ""),
                "content": content,
                "date": str(note.get("date") or ""),
                "wechatAdded": bool(note.get("wechatAdded")),
                "followType": str(note.get("followType") or "") or None,
                "origin": "lead",
                "sourceLeadId": lead_id,
                "sourceLeadNoteId": str(note.get("id") or "") or None,
            }
        )
    return carried


def _carry_lead_requirement_to_customer(lead: dict[str, Any], *, lead_id: str) -> dict[str, Any] | None:
    """第三方需求描述进入销售对接池跟进记录，避免转客户后只剩在线索详情。"""
    content = str(lead.get("requirements") or "").strip()
    if not content:
        return None
    meta = lead.get("importMeta") if isinstance(lead.get("importMeta"), dict) else {}
    operator = meta.get("operator") if isinstance(meta.get("operator"), dict) else {}
    return {
        "id": new_id("cn"),
        "author": str(operator.get("name") or "第三方接入"),
        "content": f"接入需求：{content}",
        "date": str(meta.get("occurredAt") or lead.get("createdAt") or ""),
        "origin": "lead",
        "sourceLeadId": lead_id,
        "sourceLeadNoteId": f"requirement:{lead_id}",
    }

def _carry_lead_attachments_to_customer(attachments: Any, *, lead_id: str) -> list[dict[str, Any]]:
    """把线索附件引用带到客户（同一磁盘文件），并标注来自线索。"""
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
        # crm_attachments.id 是全局主键，不能复用线索附件 id；本地文件仍通过
        # sourceLeadAttachmentId 解析到同一份物理文件，避免复制文件。
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
                "storagePath": item.get("storagePath"),
                "contentType": item.get("contentType"),
                "size": int(item.get("size") or 0),
                "uploadedAt": str(item.get("uploadedAt") or ""),
                "uploadedBy": str(item.get("uploadedBy") or ""),
                "description": description or None,
                "origin": "lead",
                "sourceLeadId": lead_id,
                "sourceLeadAttachmentId": file_id,
            }
        )
    return carried


def _carry_mark_materials_to_customer(materials: Any, *, lead_id: str) -> list[dict[str, Any]]:
    """把已归档 Mark PDF 作为只读附件引用带入销售对接池。"""
    if not isinstance(materials, list):
        return []
    carried: list[dict[str, Any]] = []
    for item in materials:
        if not isinstance(item, dict) or item.get("status") != "downloaded":
            continue
        file_id = str(item.get("id") or "").strip()
        name = str(item.get("fileName") or "").strip()
        if not file_id or not name:
            continue
        carried.append(
            {
                "id": file_id,
                "name": name,
                "url": f"/api/crm/mark-materials/{file_id}",
                "contentType": "application/pdf",
                "size": int(item.get("size") or 0),
                "uploadedAt": str(item.get("uploadedAt") or item.get("generatedAt") or ""),
                "uploadedBy": "Mark",
                "description": "Mark 自动生成并由 CRM 校验归档的 PDF 材料",
                "origin": "lead",
                "sourceLeadId": lead_id,
                "sourceLeadAttachmentId": f"mark:{file_id}",
            }
        )
    return carried

def _lead_wechat_added(lead: dict[str, Any], notes: Any) -> bool:
    if bool(lead.get("wechatAdded")):
        return True
    if not isinstance(notes, list):
        return False
    return any(isinstance(n, dict) and n.get("wechatAdded") for n in notes)

def _contact_matches_lead(contact: dict[str, Any], *, name: str, phone: str, wechat: str) -> bool:
    cn = str(contact.get("name") or "").strip()
    if not name or cn != name:
        return False
    cp = str(contact.get("phone") or "").strip()
    cw = str(contact.get("wechat") or contact.get("contactWechat") or "").strip()
    if phone and cp and phone == cp:
        return True
    if wechat and cw and wechat == cw:
        return True
    return not phone and not wechat and not cp and not cw

def _merge_lead_into_existing_customer(
    customer_doc: dict[str, Any],
    *,
    lead: dict[str, Any],
    lead_id: str,
) -> dict[str, Any]:
    """挂靠：合并联系人、跟进、附件到对接池 document（历史名保留，语义已迁到池）。"""
    doc = dict(customer_doc)
    notes = lead.get("notes") or []
    name = str(lead.get("contactName") or "").strip()
    phone = str(lead.get("contactPhone") or "").strip()
    wechat = str(lead.get("contactWechat") or "").strip()
    title = str(lead.get("contactTitle") or "").strip()
    email = str(lead.get("email") or "").strip()
    wechat_added = _lead_wechat_added(lead, notes)

    contacts: list[dict[str, Any]] = []
    raw_contacts = doc.get("contacts")
    if isinstance(raw_contacts, list):
        for c in raw_contacts:
            if isinstance(c, dict):
                contacts.append(dict(c))

    matched = False
    if name:
        for c in contacts:
            if _contact_matches_lead(c, name=name, phone=phone, wechat=wechat):
                matched = True
                if wechat_added:
                    c["wechatAdded"] = True
                if title and not str(c.get("title") or "").strip():
                    c["title"] = title
                if phone and not str(c.get("phone") or "").strip():
                    c["phone"] = phone
                if email and not str(c.get("email") or "").strip():
                    c["email"] = email
                if wechat and not str(c.get("wechat") or c.get("contactWechat") or "").strip():
                    c["wechat"] = wechat
                c.setdefault("source", str(lead.get("source") or "").strip())
                c.setdefault("sourceDetail", str(lead.get("sourceDetail") or "").strip())
                c.setdefault("sourceLeadId", lead_id)
                c.setdefault("status", "awaiting_contact")
                break
    if name and not matched:
        contacts.append(
            {
                "id": new_id("ct"),
                "name": name,
                "title": title,
                "phone": phone,
                "email": email,
                "wechat": wechat,
                "isPrimary": not contacts,
                "active": True,
                "wechatAdded": wechat_added,
                "status": "awaiting_contact",
                "source": str(lead.get("source") or "").strip(),
                "sourceDetail": str(lead.get("sourceDetail") or "").strip(),
                "sourceLeadId": lead_id,
            }
        )
    doc["contacts"] = contacts

    carried_notes = _carry_lead_notes_to_customer(notes, lead_id=lead_id)
    requirement_note = _carry_lead_requirement_to_customer(lead, lead_id=lead_id)
    if requirement_note:
        carried_notes.insert(0, requirement_note)
    existing_notes: list[dict[str, Any]] = []
    raw_notes = doc.get("notes")
    if isinstance(raw_notes, list):
        for n in raw_notes:
            if isinstance(n, dict):
                existing_notes.append(dict(n))
    existing_note_keys = {
        (str(n.get("sourceLeadNoteId") or ""), str(n.get("content") or ""), str(n.get("date") or ""))
        for n in existing_notes
    }
    for n in carried_notes:
        key = (
            str(n.get("sourceLeadNoteId") or ""),
            str(n.get("content") or ""),
            str(n.get("date") or ""),
        )
        if key in existing_note_keys:
            continue
        existing_notes.append(n)
    doc["notes"] = existing_notes
    if existing_notes:
        doc["lastFollowAt"] = str(existing_notes[-1].get("date") or doc.get("lastFollowAt") or "")

    carried_atts = _carry_lead_attachments_to_customer(lead.get("attachments") or [], lead_id=lead_id)
    carried_atts.extend(
        _carry_mark_materials_to_customer(lead.get("markMaterials") or [], lead_id=lead_id)
    )
    existing_atts: list[dict[str, Any]] = []
    raw_atts = doc.get("attachments")
    if isinstance(raw_atts, list):
        for a in raw_atts:
            if isinstance(a, dict):
                existing_atts.append(dict(a))
    existing_att_ids = {
        str(a.get("sourceLeadAttachmentId") or a.get("id") or "")
        for a in existing_atts
    }
    for a in carried_atts:
        source_id = str(a.get("sourceLeadAttachmentId") or a.get("id") or "")
        if source_id in existing_att_ids:
            continue
        existing_atts.append(a)
        existing_att_ids.add(source_id)
    doc["attachments"] = existing_atts
    return doc
