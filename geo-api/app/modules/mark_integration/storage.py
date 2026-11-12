from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import socket
import uuid
from asyncio import to_thread
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.core.exceptions import NotFoundError, ValidationError

_CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class StoredMarkPdf:
    file_id: str
    original_name: str
    path: Path
    storage_path: str
    size: int
    checksum: str


def _root() -> Path:
    root = Path(get_settings().mark_integration_files_path).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


async def _validate_public_https_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValidationError("PDF fileUrl 必须是无用户信息的 HTTPS 地址")
    if parsed.port not in (None, 443):
        raise ValidationError("PDF fileUrl 仅允许使用 HTTPS 443 端口")
    host = parsed.hostname.lower().rstrip(".")
    allowed = get_settings().mark_integration_file_host_list
    if host not in allowed:
        raise ValidationError("PDF fileUrl 域名不在 Mark 文件域名白名单中")

    try:
        infos = await to_thread(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValidationError("PDF fileUrl 域名解析失败") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise ValidationError("PDF fileUrl 域名没有可用地址")
    settings = get_settings()
    try:
        allowed_private_networks = [
            ipaddress.ip_network(item, strict=False)
            for item in settings.mark_integration_private_cidr_list
        ]
    except ValueError as exc:
        raise ValidationError("MARK_INTEGRATION_PRIVATE_CIDRS 配置无效") from exc
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
            if not ip.is_global:
                allowed_private = (
                    settings.mark_integration_allow_private_hosts
                    and any(ip in network for network in allowed_private_networks)
                )
                if not allowed_private:
                    raise ValidationError("PDF fileUrl 禁止解析到未授权的内网或保留地址")
        except ValueError as exc:
            raise ValidationError("PDF fileUrl 解析结果无效") from exc
    return host


async def download_mark_pdf(
    *,
    source_url: str,
    external_record_id: str,
    file_id: str,
    original_name: str,
    expected_checksum: str | None,
    expected_size: int | None,
) -> StoredMarkPdf:
    await _validate_public_https_url(source_url)
    expected = (expected_checksum or "").strip().lower()
    if expected and not _CHECKSUM_RE.match(expected):
        raise ValidationError("PDF checksum 必须是 SHA-256")
    max_bytes = get_settings().mark_integration_pdf_max_bytes
    if expected_size and expected_size > max_bytes:
        raise ValidationError("PDF 声明大小超过 CRM 限制")

    folder_key = hashlib.sha256(external_record_id.encode()).hexdigest()[:24]
    folder = _root() / folder_key
    folder.mkdir(parents=True, exist_ok=True)
    path = (folder / f"{file_id}.pdf").resolve()
    temp_path = (folder / f".{file_id}.{uuid.uuid4().hex}.part").resolve()
    try:
        path.relative_to(_root())
        temp_path.relative_to(_root())
    except ValueError as exc:
        raise ValidationError("无效的 PDF 存储路径") from exc

    digest = hashlib.sha256()
    total = 0
    prefix = b""
    try:
        timeout = httpx.Timeout(get_settings().mark_integration_download_timeout_seconds, connect=10.0)
        # response 上下文依赖 client，不能合并为单一 with
        async with httpx.AsyncClient(  # noqa: SIM117
            timeout=timeout, follow_redirects=False, trust_env=False
        ) as client:
            async with client.stream("GET", source_url, headers={"Accept": "application/pdf"}) as response:
                if response.status_code != 200:
                    raise ValidationError(f"Mark PDF 下载返回 HTTP {response.status_code}")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type != "application/pdf":
                    raise ValidationError("Mark PDF 下载响应类型不是 application/pdf")
                length = response.headers.get("content-length")
                if length and int(length) > max_bytes:
                    raise ValidationError("Mark PDF 下载响应超过大小限制")
                with temp_path.open("wb") as output:
                    async for chunk in response.aiter_bytes(64 * 1024):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > max_bytes:
                            raise ValidationError("Mark PDF 下载内容超过大小限制")
                        if len(prefix) < 5:
                            prefix += chunk[: 5 - len(prefix)]
                        digest.update(chunk)
                        output.write(chunk)
        if total == 0 or prefix != b"%PDF-":
            raise ValidationError("Mark 文件内容不是有效的 PDF")
        if expected_size is not None and total != expected_size:
            raise ValidationError("Mark PDF 实际大小与声明大小不一致")
        actual = digest.hexdigest()
        if expected and not hmac_safe_equal(actual, expected):
            raise ValidationError("Mark PDF SHA-256 校验失败")
        os.replace(temp_path, path)
    except (OSError, httpx.HTTPError, ValueError) as exc:
        temp_path.unlink(missing_ok=True)
        if isinstance(exc, ValidationError):
            raise
        raise ValidationError("Mark PDF 下载失败") from exc
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return StoredMarkPdf(
        file_id=file_id,
        original_name=original_name,
        path=path,
        storage_path=str(path.relative_to(_root())).replace("\\", "/"),
        size=total,
        checksum=digest.hexdigest(),
    )


def hmac_safe_equal(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)


def load_mark_pdf(storage_path: str | None) -> Path:
    if not storage_path:
        raise NotFoundError("PDF 尚未下载完成")
    root = _root()
    path = (root / storage_path).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValidationError("无效的 PDF 存储路径") from exc
    if not path.is_file():
        raise NotFoundError("PDF 文件不存在")
    return path


def delete_mark_pdf(storage_path: str) -> None:
    try:
        path = (_root() / storage_path).resolve()
        path.relative_to(_root())
        path.unlink(missing_ok=True)
    except (OSError, ValueError):
        pass
