"""打卡现场照片：本地磁盘存储（暂不上云）。"""

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

_SAFE_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$",
    re.IGNORECASE,
)

ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


@dataclass(frozen=True)
class StoredAttachment:
    id: str
    path: Path
    content_type: str
    original_name: str


def _root_dir() -> Path:
    path = Path(get_settings().checkin_attachments_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _meta_path(file_path: Path) -> Path:
    return file_path.with_suffix(file_path.suffix + ".meta.json")


def _assert_safe_id(attachment_id: str) -> None:
    if not _SAFE_ID_RE.match(attachment_id.lower()):
        raise ValidationError("无效的附件 ID")


def resolve_attachment_path(attachment_id: str) -> Path:
    _assert_safe_id(attachment_id)
    root = _root_dir().resolve()
    path = (root / attachment_id).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValidationError("无效的附件路径") from exc
    return path


async def save_upload_files(files: list[UploadFile], *, uploaded_by: str) -> list[str]:
    settings = get_settings()
    if not files:
        return []
    if len(files) > settings.checkin_attachment_max_count:
        raise ValidationError(f"最多上传 {settings.checkin_attachment_max_count} 张照片")

    root = _root_dir()
    saved_ids: list[str] = []

    try:
        for upload in files:
            content_type = (upload.content_type or "").split(";")[0].strip().lower()
            extension = ALLOWED_CONTENT_TYPES.get(content_type)
            if not extension:
                raise ValidationError("仅支持 JPEG / PNG / WebP / GIF 图片")

            raw = await upload.read()
            if not raw:
                raise ValidationError("空文件无法上传")
            if len(raw) > settings.checkin_attachment_max_bytes:
                max_mb = settings.checkin_attachment_max_bytes / (1024 * 1024)
                raise ValidationError(f"单张图片不能超过 {max_mb:.0f}MB")

            attachment_id = f"{uuid.uuid4()}{extension}"
            file_path = root / attachment_id
            meta = {
                "id": attachment_id,
                "contentType": content_type,
                "originalName": (upload.filename or attachment_id)[:255],
                "size": len(raw),
                "uploadedBy": uploaded_by,
                "uploadedAt": utc_now().isoformat(),
            }
            try:
                file_path.write_bytes(raw)
                _meta_path(file_path).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            except OSError as exc:
                logger.exception("写入打卡附件失败 %s", attachment_id)
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

    return StoredAttachment(
        id=attachment_id,
        path=path,
        content_type=content_type,
        original_name=original_name,
    )


def _unlink_quiet(attachment_id: str) -> None:
    try:
        path = resolve_attachment_path(attachment_id)
    except ValidationError:
        return
    meta_file = _meta_path(path)
    path.unlink(missing_ok=True)
    meta_file.unlink(missing_ok=True)


def delete_attachment(attachment_id: str, *, user_id: str) -> None:
    """仅允许删除本人上传的附件（用于打卡失败时清理孤立文件）。"""
    path = resolve_attachment_path(attachment_id)
    if not path.is_file():
        raise NotFoundError("附件不存在")
    meta = _read_meta(path)
    uploaded_by = str(meta.get("uploadedBy") or "")
    if uploaded_by and uploaded_by != user_id:
        raise PermissionDeniedError("无权删除该附件")
    _unlink_quiet(attachment_id)


def assert_attachments_ready(attachment_ids: list[str], *, uploaded_by: str) -> None:
    """创建打卡前确认附件已在磁盘且归属当前用户。"""
    settings = get_settings()
    if len(attachment_ids) > settings.checkin_attachment_max_count:
        raise ValidationError(f"最多关联 {settings.checkin_attachment_max_count} 张照片")

    seen: set[str] = set()
    for attachment_id in attachment_ids:
        if not attachment_id or attachment_id in seen:
            raise ValidationError("附件 ID 无效或重复")
        seen.add(attachment_id)
        try:
            path = resolve_attachment_path(attachment_id)
        except ValidationError as exc:
            raise ValidationError("附件 ID 无效") from exc
        if not path.is_file():
            raise ValidationError("现场照片不存在或已失效，请重新上传后再打卡")
        meta = _read_meta(path)
        owner = str(meta.get("uploadedBy") or "")
        if owner and owner != uploaded_by:
            raise ValidationError("现场照片不属于当前用户，请重新上传后再打卡")


def attachment_api_url(attachment_id: str) -> str:
    return f"/api/checkin/attachments/{attachment_id}"


def attachment_storage_path(attachment_id: str) -> str:
    settings = get_settings()
    return f"{settings.checkin_attachments_dir.rstrip('/')}/{attachment_id}"


def build_attachment_db_records(attachment_ids: list[str] | None) -> list[dict]:
    """组装写入 checkin_records.attachments 的结构化记录（含可访问链接）。"""
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
                    "originalName": stored.original_name,
                    "contentType": stored.content_type,
                    "size": stored.path.stat().st_size if stored.path.is_file() else None,
                }
            )
            meta_file = _meta_path(stored.path)
            if meta_file.is_file():
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                if meta.get("uploadedAt"):
                    item["uploadedAt"] = meta["uploadedAt"]
                if meta.get("uploadedBy"):
                    item["uploadedBy"] = meta["uploadedBy"]
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            # 磁盘文件缺失时仍保留可查询链接，便于排查
            logger.warning("组装附件元数据失败，仍写入链接 id=%s", attachment_id)
        records.append(item)
    return records
