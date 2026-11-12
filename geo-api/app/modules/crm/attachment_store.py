"""CRM 附件：本地磁盘按归属实体分目录存储（线索 leads/{leadId}/）。

业务侧权威元数据在 MySQL `document.attachments`（含 storagePath）；
磁盘旁路 `.meta.json` 仅供下载/删除时解析 contentType/originalName，不是 CRM 列表数据源。
"""

from __future__ import annotations

import json
import logging
import mimetypes
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.core.time_utils import utc_now

logger = logging.getLogger(__name__)

# 文件名：uuid + 扩展名
_SAFE_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\."
    r"(jpg|jpeg|png|webp|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip)$",
    re.IGNORECASE,
)
# 线索 / 客户 / 商机 ID：字母数字与常见分隔符
_OWNER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
}

_EXT_FALLBACK: dict[str, tuple[str, str]] = {
    ".jpg": ("image/jpeg", ".jpg"),
    ".jpeg": ("image/jpeg", ".jpg"),
    ".png": ("image/png", ".png"),
    ".webp": ("image/webp", ".webp"),
    ".gif": ("image/gif", ".gif"),
    ".pdf": ("application/pdf", ".pdf"),
    ".doc": ("application/msword", ".doc"),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    ".xls": ("application/vnd.ms-excel", ".xls"),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
    ".ppt": ("application/vnd.ms-powerpoint", ".ppt"),
    ".pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
    ".txt": ("text/plain", ".txt"),
    ".csv": ("text/csv", ".csv"),
    ".zip": ("application/zip", ".zip"),
}


@dataclass(frozen=True)
class StoredAttachment:
    id: str
    path: Path
    content_type: str
    original_name: str
    storage_path: str


def _root_dir() -> Path:
    path = Path(get_settings().crm_attachments_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _meta_path(file_path: Path) -> Path:
    return file_path.with_suffix(file_path.suffix + ".meta.json")


def _assert_safe_id(attachment_id: str) -> None:
    if not _SAFE_ID_RE.match(attachment_id.lower()):
        raise ValidationError("无效的附件 ID")


def _sanitize_owner_id(owner_id: str) -> str:
    value = (owner_id or "").strip()
    if not _OWNER_ID_RE.match(value):
        raise ValidationError("无效的线索/归属 ID")
    return value


def _owner_folder(*, lead_id: str | None = None) -> tuple[Path, str]:
    """返回 (绝对目录, 相对 storagePath 前缀)。线索：leads/{leadId}。"""
    root = _root_dir()
    if lead_id:
        safe = _sanitize_owner_id(lead_id)
        rel = f"leads/{safe}"
        folder = root / "leads" / safe
        folder.mkdir(parents=True, exist_ok=True)
        return folder, rel
    return root, ""


def resolve_attachment_path(attachment_id: str) -> Path:
    """按文件名解析：先扁平目录（兼容旧数据），再在 leads/* 等子目录中查找。"""
    _assert_safe_id(attachment_id)
    root = _root_dir().resolve()
    flat = (root / attachment_id).resolve()
    try:
        flat.relative_to(root)
    except ValueError as exc:
        raise ValidationError("无效的附件路径") from exc
    if flat.is_file():
        return flat

    for found in root.rglob(attachment_id):
        if not found.is_file() or found.name != attachment_id:
            continue
        if found.name.endswith(".meta.json"):
            continue
        resolved = found.resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            continue
        return resolved

    # 未找到时仍返回扁平路径，供调用方判断 is_file
    return flat


def relative_storage_path(file_path: Path) -> str:
    root = _root_dir().resolve()
    resolved = file_path.resolve()
    try:
        return str(resolved.relative_to(root)).replace("\\", "/")
    except ValueError:
        return file_path.name


def _resolve_type_and_ext(upload: UploadFile) -> tuple[str, str]:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    extension = ALLOWED_CONTENT_TYPES.get(content_type)
    if extension:
        return content_type, extension

    name = (upload.filename or "").lower()
    suffix = Path(name).suffix
    fallback = _EXT_FALLBACK.get(suffix)
    if fallback:
        return fallback
    raise ValidationError("不支持的文件类型（支持图片、PDF、Office、文本、ZIP）")


async def save_upload_files(
    files: list[UploadFile],
    *,
    uploaded_by: str,
    lead_id: str | None = None,
) -> list[str]:
    settings = get_settings()
    if not files:
        return []
    if len(files) > settings.crm_attachment_max_count:
        raise ValidationError(f"最多上传 {settings.crm_attachment_max_count} 个附件")

    folder, rel_prefix = _owner_folder(lead_id=lead_id)
    saved_ids: list[str] = []

    try:
        for upload in files:
            content_type, extension = _resolve_type_and_ext(upload)
            raw = await upload.read()
            if not raw:
                raise ValidationError("空文件无法上传")
            if len(raw) > settings.crm_attachment_max_bytes:
                max_mb = settings.crm_attachment_max_bytes / (1024 * 1024)
                raise ValidationError(f"单个附件不能超过 {max_mb:.0f}MB")

            attachment_id = f"{uuid.uuid4()}{extension}"
            file_path = folder / attachment_id
            storage_path = f"{rel_prefix}/{attachment_id}" if rel_prefix else attachment_id
            meta = {
                "id": attachment_id,
                "contentType": content_type,
                "originalName": (upload.filename or attachment_id)[:255],
                "size": len(raw),
                "uploadedBy": uploaded_by,
                "uploadedAt": utc_now().isoformat(),
                "storagePath": storage_path,
                "leadId": lead_id,
            }
            try:
                file_path.write_bytes(raw)
                _meta_path(file_path).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            except OSError as exc:
                logger.exception("写入 CRM 附件失败 %s", storage_path)
                file_path.unlink(missing_ok=True)
                _meta_path(file_path).unlink(missing_ok=True)
                raise ValidationError("附件保存失败，请检查服务器磁盘") from exc
            saved_ids.append(attachment_id)
    except Exception:
        for attachment_id in saved_ids:
            _unlink_quiet(attachment_id)
        raise

    return saved_ids


def _read_meta(file_path: Path) -> dict:
    meta_file = _meta_path(file_path)
    if not meta_file.is_file():
        return {}
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        return meta if isinstance(meta, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def load_attachment(attachment_id: str) -> StoredAttachment:
    path = resolve_attachment_path(attachment_id)
    if not path.is_file():
        raise NotFoundError("附件不存在")

    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    original_name = path.name
    meta = _read_meta(path)
    content_type = str(meta.get("contentType") or content_type)
    original_name = str(meta.get("originalName") or original_name)
    storage_path = str(meta.get("storagePath") or relative_storage_path(path))

    return StoredAttachment(
        id=attachment_id,
        path=path,
        content_type=content_type,
        original_name=original_name,
        storage_path=storage_path,
    )


def attachment_owner_hints(
    attachment_id: str,
    *,
    path: Path | None = None,
) -> dict[str, str]:
    """从磁盘路径 / meta 推断归属，供下载前做 data_scope 校验。

    若调用方已 resolve 过路径，传入 path 可避免二次磁盘查找。
    """
    hints: dict[str, str] = {}
    try:
        file_path = path if path is not None else resolve_attachment_path(attachment_id)
    except (ValidationError, NotFoundError):
        return hints
    if not file_path.is_file():
        return hints
    meta = _read_meta(file_path)
    lead_id = str(meta.get("leadId") or "").strip()
    if lead_id:
        hints["lead_id"] = lead_id
    storage = str(meta.get("storagePath") or relative_storage_path(file_path)).replace("\\", "/")
    parts = [p for p in storage.split("/") if p]
    if len(parts) >= 2 and parts[0] == "leads":
        hints.setdefault("lead_id", parts[1])
    elif len(parts) >= 2 and parts[0] in ("customers", "opportunities", "contracts", "requests"):
        kind_map = {
            "customers": "customer",
            "opportunities": "opportunity",
            "contracts": "contract",
            "requests": "request",
        }
        hints["entity_kind"] = kind_map[parts[0]]
        hints["entity_id"] = parts[1]
    return hints


def _unlink_quiet(attachment_id: str) -> None:
    try:
        path = resolve_attachment_path(attachment_id)
    except ValidationError:
        return
    meta_file = _meta_path(path)
    path.unlink(missing_ok=True)
    meta_file.unlink(missing_ok=True)


def delete_attachment(attachment_id: str, *, user_id: str) -> None:
    path = resolve_attachment_path(attachment_id)
    if not path.is_file():
        raise NotFoundError("附件不存在")
    meta = _read_meta(path)
    uploaded_by = str(meta.get("uploadedBy") or "")
    if uploaded_by and uploaded_by != user_id:
        raise PermissionDeniedError("无权删除该附件")
    _unlink_quiet(attachment_id)


def attachment_api_url(attachment_id: str) -> str:
    return f"/api/crm/attachments/{attachment_id}"


def attachment_storage_path(attachment_id: str) -> str:
    """优先读 meta；否则按磁盘相对路径。"""
    try:
        path = resolve_attachment_path(attachment_id)
        if path.is_file():
            meta = _read_meta(path)
            if meta.get("storagePath"):
                return str(meta["storagePath"])
            return relative_storage_path(path)
    except Exception:  # noqa: BLE001, S110  有意兜底（清理/回退/探测不应中断主流程）
        pass
    settings = get_settings()
    return f"{settings.crm_attachments_dir.rstrip('/')}/{attachment_id}"


def build_attachment_records(attachment_ids: list[str] | None) -> list[dict]:
    if not attachment_ids:
        return []

    records: list[dict] = []
    for attachment_id in attachment_ids:
        item: dict = {
            "id": attachment_id,
            "url": attachment_api_url(attachment_id),
            "storagePath": attachment_storage_path(attachment_id),
        }
        try:
            stored = load_attachment(attachment_id)
            item.update(
                {
                    "name": stored.original_name,
                    "originalName": stored.original_name,
                    "contentType": stored.content_type,
                    "size": stored.path.stat().st_size if stored.path.is_file() else None,
                    "storagePath": stored.storage_path,
                }
            )
            meta = _read_meta(stored.path)
            if meta.get("uploadedAt"):
                item["uploadedAt"] = meta["uploadedAt"]
            if meta.get("uploadedBy"):
                item["uploadedBy"] = meta["uploadedBy"]
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            logger.warning("组装 CRM 附件元数据失败 id=%s", attachment_id)
        records.append(item)
    return records
