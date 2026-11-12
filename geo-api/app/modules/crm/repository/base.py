from __future__ import annotations

import json
import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Select, and_, case, delete, func, or_, select  # noqa: F401  re-export
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationError

from app.models.crm import (
    CrmAttachment,
    CrmAuditChangeItem,
    CrmAuditRecord,  # noqa: F401  re-export（audit.py 等经 base 导入）
    CrmContact,
    CrmContract,  # noqa: F401  re-export
    CrmCoverageImportMeta,
    CrmCustomer,
    CrmFollowUp,  # noqa: F401  re-export
    CrmLead,
    CrmLeadImportMeta,
    CrmNotification,
    CrmOpportunity,  # noqa: F401  re-export
    CrmSalesCoverage,
    LeadNote,
    OpportunityNote,
    OpportunityProjectType,
    OpportunityRequestLink,
    OpportunityStageHistory,
)

EMPTY_LEAD_STATS: dict[str, int] = {
    "total": 0,
    "today": 0,
    "untouched": 0,
    "touched": 0,
    "converted": 0,
    "invalid": 0,
}

EMPTY_CUSTOMER_STATS: dict[str, int] = {
    "total": 0,
    "cooperating": 0,
    "awaiting_contact": 0,
    "connected": 0,
    "opportunity_following": 0,
    "stopped": 0,
    # 旧字段兼容
    "following": 0,
    "potential": 0,
    "lost": 0,
    "key": 0,
}


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:16]}"


def _doc_str(doc: dict[str, Any], key: str) -> str | None:
    """document 业务字段 → 镜像列；空值归一为 NULL。"""
    value = doc.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _doc_date(doc: dict[str, Any], key: str) -> date | None:
    text = _doc_str(doc, key)
    if not text:
        return None
    match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if not match:
        return None
    try:
        year, month, day = (int(x) for x in match.groups())
        return date(year, month, day)
    except ValueError:
        return None


def _doc_datetime(doc: dict[str, Any], key: str) -> datetime | None:
    """解析 document 中的日期时间（兼容非补零格式）。"""
    return _doc_dt_lenient(doc, key)


def _doc_decimal(doc: dict[str, Any], key: str) -> float | None:
    text = _doc_str(doc, key)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _doc_dt(doc: dict[str, Any], key: str) -> datetime | None:
    text = _doc_str(doc, key)
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def _doc_dt_lenient(doc: dict[str, Any], key: str) -> datetime | None:
    """宽松解析日期时间：兼容前端 zh-CN 非补零格式（'2026-8-7 10:30:45'）。"""
    text = _doc_str(doc, key)
    if not text:
        return None
    match = re.match(
        r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?",
        text,
    )
    if not match:
        return _doc_dt(doc, key)
    try:
        year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        hour = int(match.group(4) or 0)
        minute = int(match.group(5) or 0)
        second = int(match.group(6) or 0)
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def _format_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _format_note_date(value: datetime | None) -> str | None:
    """跟进日期回读：午夜时间归一为 date-only，保留前端原文展示习惯。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.hour == 0 and value.minute == 0 and value.second == 0:
            return value.strftime("%Y-%m-%d")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _mentions_list(raw: Any) -> list[Any] | None:
    """mentions 列（JSON 转 TEXT 后）→ Python 列表。"""
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


async def sync_attachments(
    db: AsyncSession, entity_type: str, entity_id: str, attachments: list[Any]
) -> None:
    """把 document.attachments 同步到统一附件表（写穿式，幂等）。"""
    await db.execute(
        delete(CrmAttachment).where(
            CrmAttachment.entity_type == entity_type,
            CrmAttachment.entity_id == entity_id,
        )
    )
    now = _now()
    for index, item in enumerate(attachments or []):
        if not isinstance(item, dict):
            continue
        db.add(
            CrmAttachment(
                id=str(item.get("id") or new_id("at")),
                entity_type=entity_type,
                entity_id=entity_id,
                name=str(item.get("name") or ""),
                size=int(item.get("size") or 0),
                kind=_doc_str(item, "kind"),
                url=_doc_str(item, "url"),
                storage_path=_doc_str(item, "storagePath"),
                content_type=_doc_str(item, "contentType"),
                description=_doc_str(item, "description"),
                checksum=_doc_str(item, "checksum"),
                uploaded_by=_doc_str(item, "uploadedBy"),
                uploaded_at=_doc_dt(item, "uploadedAt"),
                origin=_doc_str(item, "origin"),
                source_lead_id=_doc_str(item, "sourceLeadId"),
                source_lead_attachment_id=_doc_str(item, "sourceLeadAttachmentId"),
                source_request_id=_doc_str(item, "sourceRequestId"),
                source_request_attachment_id=_doc_str(item, "sourceRequestAttachmentId"),
                created_at=now,
            )
        )


async def sync_stage_history(
    db: AsyncSession, opportunity_id: str, history: list[Any]
) -> None:
    """把 document.stageHistory 同步到阶段历史表（写穿式，幂等）。"""
    await db.execute(
        delete(OpportunityStageHistory).where(
            OpportunityStageHistory.opportunity_id == opportunity_id
        )
    )
    now = _now()
    for index, item in enumerate(history or []):
        if not isinstance(item, dict):
            continue
        db.add(
            OpportunityStageHistory(
                id=f"{opportunity_id}-sh-{index}",
                opportunity_id=opportunity_id,
                stage=str(item.get("stage") or ""),
                entered_at=_doc_dt(item, "enteredAt") or now,
                left_at=_doc_dt(item, "leftAt"),
                reason=_doc_str(item, "reason"),
                change_type=_doc_str(item, "changeType"),
                sort_order=index,
            )
        )


async def sync_audit_changes(db: AsyncSession, audit_id: str, changes: list[Any]) -> None:
    """把 audit.changes 同步到变更项表（写穿式，幂等）。"""
    await db.execute(delete(CrmAuditChangeItem).where(CrmAuditChangeItem.audit_id == audit_id))
    for index, item in enumerate(changes or []):
        if not isinstance(item, dict):
            continue
        db.add(
            CrmAuditChangeItem(
                id=f"{audit_id}-ch-{index}",
                audit_id=audit_id,
                field=str(item.get("field") or ""),
                before_value=None if item.get("before") is None else str(item.get("before")),
                after_value=None if item.get("after") is None else str(item.get("after")),
                sort_order=index,
            )
        )


async def sync_opportunity_links(
    db: AsyncSession,
    opportunity_id: str,
    project_types: list[Any] | None,
    request_ids: list[Any] | None,
) -> None:
    """项目类型正常保存；已退役的需求关系仅清理，禁止重新写入。"""
    if request_ids:
        raise ValidationError("需求与商机绑定功能已取消")
    await db.execute(
        delete(OpportunityProjectType).where(
            OpportunityProjectType.opportunity_id == opportunity_id
        )
    )
    await db.execute(
        delete(OpportunityRequestLink).where(
            OpportunityRequestLink.opportunity_id == opportunity_id
        )
    )
    for index, value in enumerate(project_types or []):
        value = str(value or "").strip()
        if not value:
            continue
        db.add(
            OpportunityProjectType(
                id=f"{opportunity_id}-pt-{index}",
                opportunity_id=opportunity_id,
                project_type=value,
            )
        )


async def sync_opportunity_notes(
    db: AsyncSession,
    opportunity_id: str,
    notes: list[Any] | None,
    advisor_notes: list[Any] | None,
) -> None:
    """把 document.notes / advisorNotes 同步到跟进子表（写穿式，幂等）。"""
    await db.execute(
        delete(OpportunityNote).where(OpportunityNote.opportunity_id == opportunity_id)
    )
    for kind, items in (("sales", notes), ("advisor", advisor_notes)):
        for index, item in enumerate(items or []):
            if not isinstance(item, dict):
                continue
            db.add(
                OpportunityNote(
                    id=str(item.get("id") or new_id("on")),
                    opportunity_id=opportunity_id,
                    kind=kind,
                    author=_doc_str(item, "author") or "",
                    content=_doc_str(item, "content") or "",
                    date=_doc_dt_lenient(item, "date"),
                    follow_type=_doc_str(item, "followType"),
                    wechat_added=bool(item.get("wechatAdded")),
                    mentions=(
                        json.dumps(item.get("mentions"), ensure_ascii=False)
                        if isinstance(item.get("mentions"), list)
                        else None
                    ),
                    next_follow_at=_doc_date(item, "nextFollowAt"),
                    origin=_doc_str(item, "origin"),
                    source_request_id=_doc_str(item, "sourceRequestId"),
                    source_request_note_id=_doc_str(item, "sourceRequestNoteId"),
                    sort_order=index,
                )
            )


async def sync_lead_notes(
    db: AsyncSession,
    lead_id: str,
    notes: list[Any] | None,
) -> None:
    """把 document.notes 同步到线索跟进表（写穿式，幂等）。"""
    await db.execute(delete(LeadNote).where(LeadNote.lead_id == lead_id))
    for index, item in enumerate(notes or []):
        if not isinstance(item, dict):
            continue
        db.add(
            LeadNote(
                id=str(item.get("id") or new_id("ln")),
                lead_id=lead_id,
                author=_doc_str(item, "author") or "",
                content=_doc_str(item, "content") or "",
                date=_doc_dt_lenient(item, "date"),
                follow_type=_doc_str(item, "followType"),
                wechat_added=bool(item.get("wechatAdded")),
                mentions=(
                    json.dumps(item.get("mentions"), ensure_ascii=False)
                    if isinstance(item.get("mentions"), list)
                    else None
                ),
                next_follow_at=_doc_date(item, "nextFollowAt"),
                sort_order=index,
            )
        )


async def sync_lead_import_meta(
    db: AsyncSession,
    lead_id: str,
    meta: dict[str, Any] | None,
) -> None:
    """把 document.importMeta 同步到导入元数据表（1:1，写穿式，幂等）。"""
    await db.execute(
        delete(CrmLeadImportMeta).where(CrmLeadImportMeta.lead_id == lead_id)
    )
    if not isinstance(meta, dict) or not meta:
        return
    operator = meta.get("operator")
    operator_name = None
    operator_id = None
    if isinstance(operator, dict):
        operator_name = _doc_str(operator, "name")
        operator_id = _doc_str(operator, "id")
    db.add(
        CrmLeadImportMeta(
            lead_id=lead_id,
            imported_at=_doc_dt_lenient(meta, "importedAt"),
            feishu_lead_no=_doc_str(meta, "feishuLeadNo"),
            created_by_name=_doc_str(meta, "createdByName"),
            feishu_record_id=_doc_str(meta, "feishuRecordId"),
            landingpage_raw=_doc_str(meta, "landingpageRaw"),
            utm_source=_doc_str(meta, "utmSource"),
            utm_medium=_doc_str(meta, "utmMedium"),
            utm_campaign=_doc_str(meta, "utmCampaign"),
            platform=_doc_str(meta, "platform"),
            external_record_id=_doc_str(meta, "externalRecordId"),
            operator_name=operator_name,
            operator_id=operator_id,
            last_event_id=_doc_str(meta, "lastEventId"),
            occurred_at=_doc_dt_lenient(meta, "occurredAt"),
        )
    )


async def sync_coverage_import_meta(
    db: AsyncSession,
    coverage_id: str,
    meta: dict[str, Any] | None,
) -> None:
    """把 coverage document.importMeta 同步到导入元数据表（1:1，写穿式，幂等）。"""
    await db.execute(
        delete(CrmCoverageImportMeta).where(CrmCoverageImportMeta.coverage_id == coverage_id)
    )
    if not isinstance(meta, dict) or not meta:
        return
    db.add(
        CrmCoverageImportMeta(
            coverage_id=coverage_id,
            source=_doc_str(meta, "source"),
            backfill=(
                str(meta.get("backfill") or "").strip().lower() in ("true", "1")
                if meta.get("backfill") is not None
                else None
            ),
            from_owner_user_id=_doc_str(meta, "fromOwnerUserId"),
            imported_at=_doc_dt_lenient(meta, "importedAt"),
        )
    )


def _split_filter_values(raw: str | None) -> list[str]:
    """查询参数：单值或逗号分隔多值；忽略 all / 空。"""
    text = (raw or "").strip()
    if not text or text == "all":
        return []
    out: list[str] = []
    for part in text.replace("，", ",").split(","):
        item = part.strip()
        if item and item != "all" and item not in out:
            out.append(item)
    return out


def _coverage_contact_in_status(statuses: list[str]):
    """对接池联系人状态匹配（crm_contacts 表；033 写穿 + 035 回填）。"""
    return (
        select(CrmContact.id)
        .where(
            CrmContact.coverage_id == CrmSalesCoverage.id,
            CrmContact.active.is_(True),
            CrmContact.status.in_(statuses),
        )
        .exists()
    )


def normalize_company_name_key(name: str) -> str:
    """公司名比对键：去首尾空白、去全部空白、大小写不敏感。"""
    s = (name or "").strip().replace("\u3000", " ")
    s = re.sub(r"\s+", "", s)
    return s.casefold()


PARTIAL_COMPANY_NAME_MIN_LEN = 2
# 部分匹配时要求的最长公共子串最小长度（去掉后缀/通用词后的核心上）
PARTIAL_LCS_MIN_LEN = 2

# 法人后缀（长→短，循环剥离）
_COMPANY_LEGAL_SUFFIXES = (
    "有限责任公司",
    "股份有限公司",
    "有限公司",
    "集团公司",
    "集团股份",
    "集团",
    "公司",
    "co.,ltd.",
    "co.ltd.",
    "ltd.",
    "inc.",
    "llc",
    "corp.",
    "corp",
)

# 行业通用词：剥离后用剩余核心做包含 / LCS，降低「信息」「科技」误伤
_COMPANY_GENERIC_TOKENS = (
    "控股",
    "投资",
    "发展",
    "实业",
    "贸易",
    "商贸",
    "科技",
    "技术",
    "软件",
    "网络",
    "信息",
    "电子",
    "咨询",
    "服务",
    "文化",
    "传媒",
    "教育",
    "智能",
    "数据",
    "互联",
)


def strip_company_legal_suffixes(key: str) -> str:
    """去掉常见公司法人后缀（输入应为已 normalize 的 key）。"""
    s = key
    changed = True
    while changed and s:
        changed = False
        for suf in _COMPANY_LEGAL_SUFFIXES:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[: -len(suf)]
                changed = True
                break
    return s


def strip_company_generic_tokens(key: str) -> str:
    """去掉行业通用词，保留品牌核心。"""
    s = key
    changed = True
    while changed and s:
        changed = False
        for tok in _COMPANY_GENERIC_TOKENS:
            if tok in s and len(s) > len(tok):
                s = s.replace(tok, "")
                changed = True
    return s


def company_name_core(name: str) -> str:
    """公司名品牌核心：归一化 → 去法人后缀 → 去通用词。"""
    key = normalize_company_name_key(name)
    return strip_company_generic_tokens(strip_company_legal_suffixes(key))


def _longest_common_substring_len(a: str, b: str) -> int:
    if not a or not b:
        return 0
    # 滚动一维 DP，只保留长度
    prev = [0] * (len(b) + 1)
    best = 0
    for i, ca in enumerate(a, start=1):
        cur = [0] * (len(b) + 1)
        for j, cb in enumerate(b, start=1):
            if ca == cb:
                cur[j] = prev[j - 1] + 1
                best = max(best, cur[j])
        prev = cur
    return best


def company_name_partial_needles(name: str) -> list[str]:
    """供 SQL LIKE 召回的针：核心、去后缀串、以及核心上长度≥2的连续片段。"""
    key = normalize_company_name_key(name)
    if len(key) < PARTIAL_COMPANY_NAME_MIN_LEN:
        return []
    stripped = strip_company_legal_suffixes(key)
    core = strip_company_generic_tokens(stripped)
    needles: list[str] = []
    for part in (core, stripped, key):
        if len(part) >= PARTIAL_COMPANY_NAME_MIN_LEN and part not in needles:
            needles.append(part)
    # 核心较短时，用 2 字窗口扩大召回（如「触达」命中「未触达…」）
    source = core if len(core) >= PARTIAL_COMPANY_NAME_MIN_LEN else stripped
    if len(source) >= PARTIAL_COMPANY_NAME_MIN_LEN:
        for i in range(len(source) - PARTIAL_COMPANY_NAME_MIN_LEN + 1):
            gram = source[i : i + PARTIAL_COMPANY_NAME_MIN_LEN]
            if gram in _COMPANY_GENERIC_TOKENS:
                continue
            if gram not in needles:
                needles.append(gram)
    return needles[:12]


def company_name_match_kind(a: str, b: str) -> str | None:
    """公司名匹配类型：exact / partial / None。

    - exact：归一化后完全相同
    - partial：整串双向包含；或去掉法人后缀/通用词后核心双向包含；
      或核心上最长公共子串 ≥ PARTIAL_LCS_MIN_LEN（且非纯通用词）
    """
    ka = normalize_company_name_key(a)
    kb = normalize_company_name_key(b)
    if not ka or not kb:
        return None
    if ka == kb:
        return "exact"
    if min(len(ka), len(kb)) < PARTIAL_COMPANY_NAME_MIN_LEN:
        return None
    if ka in kb or kb in ka:
        return "partial"

    sa = strip_company_legal_suffixes(ka)
    sb = strip_company_legal_suffixes(kb)
    if sa and sb and (sa == sb or sa in sb or sb in sa):
        return "partial"

    ca = strip_company_generic_tokens(sa)
    cb = strip_company_generic_tokens(sb)
    if (
        len(ca) >= PARTIAL_COMPANY_NAME_MIN_LEN
        and len(cb) >= PARTIAL_COMPANY_NAME_MIN_LEN
        and (ca == cb or ca in cb or cb in ca)
    ):
        return "partial"

    # 核心上的 LCS：覆盖「触达信息」↔「未触达科技」
    left = ca if len(ca) >= PARTIAL_COMPANY_NAME_MIN_LEN else sa
    right = cb if len(cb) >= PARTIAL_COMPANY_NAME_MIN_LEN else sb
    lcs = _longest_common_substring_len(left, right)
    if lcs >= PARTIAL_LCS_MIN_LEN:
        return "partial"
    return None


def _customer_company_name_key_expr():
    """SQL：customer.document.companyName 的归一化比对键。"""
    raw = func.lower(func.coalesce(CrmCustomer.company_name, ""))
    # 去掉半角/全角空格
    return func.replace(func.replace(raw, " ", ""), "\u3000", "")


class CrmRepositoryBase:

    def __init__(self, db: AsyncSession):
            self.db = db

    async def _list_by_owners(
            self,
            model,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
        ) -> Sequence[Any]:
            stmt: Select[Any] = select(model).order_by(model.updated_at.desc())
            clause = self._owner_ids_clause(
                model.owner_user_id, owner_ids, include_unassigned=include_unassigned
            )
            if clause is not None:
                if owner_ids is not None and not owner_ids and not include_unassigned:
                    return []
                stmt = stmt.where(clause)
            result = await self.db.execute(stmt)
            return result.scalars().all()

    def _owner_ids_clause(
            self,
            column,
            owner_ids: list[str] | None,
            *,
            include_unassigned: bool = False,
        ):
            """owner_ids is None → 不限制；否则按负责人过滤，可选并入无负责人。"""
            if owner_ids is None:
                return None
            parts: list[Any] = []
            if owner_ids:
                parts.append(column.in_(owner_ids))
            if include_unassigned and owner_ids is not None:
                parts.append(column.is_(None))
            if not parts:
                return and_(False)
            return or_(*parts) if len(parts) > 1 else parts[0]

    def _lead_owner_clause(
            self, owner_ids: list[str] | None, *, include_unassigned: bool = False
        ):
            return self._owner_ids_clause(
                CrmLead.owner_user_id, owner_ids, include_unassigned=include_unassigned
            )

    def _lead_pool_clause(
            self, owner_clause, sdr_pool_names: list[str] | None = None
        ):
            """SDR 共享池：负责人/无负责人之外，sdr 归属字段命中 SDR 目录的导入线索也纳入。"""
            pool_names = [str(n) for n in (sdr_pool_names or []) if str(n).strip()]
            if not pool_names:
                return owner_clause
            sdr_clause = CrmLead.sdr.in_(pool_names)
            if owner_clause is None:
                return sdr_clause
            return or_(owner_clause, sdr_clause)

    def _lead_created_day_expr(self):
            """业务创建日（YYYY-MM-DD）：created_day 列，否则 DATE(created_at)。"""
            raw = func.coalesce(
                CrmLead.created_day,
                func.date_format(CrmLead.created_at, "%Y-%m-%d"),
            )
            # 截成日，避免 createdAt 带时间时 `<= 某日` 字符串比较失败
            return func.left(raw, 10)

    def _customer_visibility_clause(
            self, owner_ids: list[str] | None, *, include_unassigned: bool = False
        ):
            """「我的客户」列表：存在对接池 owner ∈ 可见集合。

            公司主档详情可读性在 Service 层单独校验。
            """
            if owner_ids is None:
                return None
            parts: list[Any] = []
            if owner_ids:
                cov_exists = (
                    select(CrmSalesCoverage.id)
                    .where(
                        CrmSalesCoverage.customer_id == CrmCustomer.id,
                        CrmSalesCoverage.owner_user_id.in_(owner_ids),
                    )
                    .exists()
                )
                parts.append(cov_exists)
            if include_unassigned:
                # 无对接池的公司（迁移 pending / 历史空 owner）：仅当归属（owner 或创建人）
                # 在本人管辖内可见，避免任意区域 Leader 看到全库未归因公司（跨区域泄漏）。
                # owner 与 createdByUserId 均为空（023 pending）的客户仅 all（admin/ops）可见，
                # 由迁移脚本统一归因后进池。
                created_by = CrmCustomer.created_by_user_id
                owned_or_created_here = or_(
                    CrmCustomer.owner_user_id.in_(owner_ids),
                    created_by.in_(owner_ids),
                )
                no_cov = (
                    ~select(CrmSalesCoverage.id)
                    .where(CrmSalesCoverage.customer_id == CrmCustomer.id)
                    .exists()
                )
                parts.append(and_(no_cov, owned_or_created_here))
            if not parts:
                return and_(False)
            return or_(*parts) if len(parts) > 1 else parts[0]

    def _coverage_owner_scope_clause(self, owner_ids: list[str] | None):
            """可选：把可见 owner 集合套到 coverage 子查询上（None=不限）。"""
            if owner_ids is None:
                return None
            return CrmSalesCoverage.owner_user_id.in_(owner_ids)

    def _notification_ownership_clauses(self, *, user_id: str, user_name: str):
            name = (user_name or "").strip()
            clauses = [CrmNotification.target_user_id == user_id]
            if name:
                clauses.append(CrmNotification.target_name == name)
            return clauses
