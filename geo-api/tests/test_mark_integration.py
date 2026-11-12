from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Depends, FastAPI, Request
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.core.database import get_db_session
from app.core.exceptions import ConflictError, ValidationError
from app.modules.mark_integration.auth import (
    require_integration_auth,
    require_integration_signature,
)
from app.modules.mark_integration.models import MarkIntegrationEvent, MarkIntegrationRecord
from app.modules.mark_integration.schemas import MarkMaterialEvent, UnifiedLeadEvent
from app.modules.mark_integration.service import MarkIntegrationService
from app.modules.mark_integration.storage import _validate_public_https_url, load_mark_pdf


def _signature(secret: str, method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    text = f"{method}\n{path}\n{timestamp}\n{nonce}\n{body_hash}"
    return "sha256=" + hmac.new(secret.encode(), text.encode(), hashlib.sha256).hexdigest()


class _ScalarResult:
    def scalar_one_or_none(self):
        return None


class _FakeNonceDb:
    def __init__(self):
        self.added = []

    async def execute(self, _stmt):
        return _ScalarResult()

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        return None

    async def rollback(self):
        return None


async def _fake_nonce_db():
    yield _FakeNonceDb()


@pytest.mark.asyncio
@pytest.mark.parametrize("platform", ["website", "36kr", "mark"])
async def test_bearer_auth_uses_body_platform_code(
    monkeypatch: pytest.MonkeyPatch, platform: str
):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    monkeypatch.setattr(settings, f"lead_integration_{platform}_token", f"{platform}-api-key")
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post("/signed", dependencies=[Depends(require_integration_auth)])
    async def signed(request: Request):
        return {"platform": request.state.integration_platform}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/signed",
            json={"platformCode": platform},
            headers={"Authorization": f"Bearer {platform}-api-key"},
        )
    assert response.status_code == 200
    assert response.json() == {"platform": platform}


@pytest.mark.asyncio
async def test_bearer_auth_rejects_api_key_from_other_platform(
    monkeypatch: pytest.MonkeyPatch,
):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    monkeypatch.setattr(settings, "lead_integration_website_token", "website-key")
    monkeypatch.setattr(settings, "lead_integration_mark_token", "mark-key")
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post("/signed", dependencies=[Depends(require_integration_auth)])
    async def signed():
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/signed",
            json={"platformCode": "website"},
            headers={"Authorization": "Bearer mark-key"},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_bearer_auth_rejects_missing_platform_code(
    monkeypatch: pytest.MonkeyPatch,
):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post("/signed", dependencies=[Depends(require_integration_auth)])
    async def signed():
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/signed",
            json={"eventId": "evt-1"},
            headers={"Authorization": "Bearer key"},
        )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_mark_material_bearer_auth_infers_fixed_mark_platform(
    monkeypatch: pytest.MonkeyPatch,
):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    monkeypatch.setattr(settings, "lead_integration_mark_token", "mark-material-api-key")
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post(
        "/api/integrations/mark/leads/{lead_id}/materials",
        dependencies=[Depends(require_integration_auth)],
    )
    async def materials(lead_id: str, request: Request):
        return {"leadId": lead_id, "platform": request.state.integration_platform}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/integrations/mark/leads/lead-1/materials",
            json={"eventId": "material-1"},
            headers={"Authorization": "Bearer mark-material-api-key"},
        )
    assert response.status_code == 200
    assert response.json() == {"leadId": "lead-1", "platform": "mark"}


@pytest.mark.asyncio
async def test_legacy_hmac_can_be_disabled(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_legacy_hmac_enabled", False)
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post("/signed", dependencies=[Depends(require_integration_auth)])
    async def signed():
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/signed", json={"platformCode": "website"})
    assert response.status_code == 401
    assert "Bearer" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("platform", ["website", "36kr", "mark"])
async def test_platform_signature_accepts_valid_request(
    monkeypatch: pytest.MonkeyPatch, platform: str
):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    monkeypatch.setattr(settings, "lead_integration_secret", "")
    monkeypatch.setattr(
        settings,
        f"lead_integration_{platform}_secret",
        "test-secret-at-least-long-enough",
    )
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.post("/signed", dependencies=[Depends(require_integration_signature)])
    async def signed(request: Request):
        return {"ok": True, "platform": request.state.integration_platform}

    body = json.dumps({"hello": "mark"}, separators=(",", ":")).encode()
    ts = str(int(time.time()))
    nonce = "nonce-1"
    headers = {
        "Content-Type": "application/json",
        "X-Platform-Code": platform,
        "X-Timestamp": ts,
        "X-Nonce": nonce,
        "X-Signature": _signature(
            "test-secret-at-least-long-enough", "POST", "/signed", ts, nonce, body
        ),
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/signed", content=body, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "platform": platform}


@pytest.mark.asyncio
async def test_mark_signature_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "lead_integration_enabled", True)
    monkeypatch.setattr(settings, "lead_integration_secret", "test-secret")
    app = FastAPI()
    app.dependency_overrides[get_db_session] = _fake_nonce_db

    @app.get("/signed", dependencies=[Depends(require_integration_signature)])
    async def signed():
        return {"ok": True}

    headers = {
        "X-Platform-Code": "mark",
        "X-Timestamp": str(int(time.time())),
        "X-Nonce": "nonce-2",
        "X-Signature": "sha256=bad",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/signed", headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_pdf_storage_loads_archived_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    settings = get_settings()
    monkeypatch.setattr(settings, "mark_integration_files_dir", str(tmp_path))
    raw = b"%PDF-1.4\nminimal test pdf\n%%EOF"
    path = tmp_path / "mark" / "file.pdf"
    path.parent.mkdir()
    path.write_bytes(raw)
    assert load_mark_pdf("mark/file.pdf").read_bytes() == raw


@pytest.mark.asyncio
async def test_pdf_url_rejects_non_https(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mark_integration_file_hosts", "files.mark.example.com")
    with pytest.raises(ValidationError, match="HTTPS"):
        await _validate_public_https_url("http://files.mark.example.com/file.pdf")


@pytest.mark.asyncio
async def test_pdf_url_rejects_host_outside_allowlist(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mark_integration_file_hosts", "files.mark.example.com")
    with pytest.raises(ValidationError, match="白名单"):
        await _validate_public_https_url("https://evil.example.net/file.pdf")


@pytest.mark.asyncio
async def test_pdf_url_rejects_private_dns_result(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mark_integration_file_hosts", "files.mark.example.com")
    monkeypatch.setattr(
        "app.modules.mark_integration.storage.socket.getaddrinfo",
        lambda *_args, **_kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(ValidationError, match="内网或保留地址"):
        await _validate_public_https_url("https://files.mark.example.com/file.pdf")


@pytest.mark.asyncio
async def test_pdf_url_allows_explicit_private_cidr(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "mark_integration_file_hosts", "files.mark.internal")
    monkeypatch.setattr(settings, "mark_integration_allow_private_hosts", True)
    monkeypatch.setattr(settings, "mark_integration_private_cidrs", "172.31.0.0/16")
    monkeypatch.setattr(
        "app.modules.mark_integration.storage.socket.getaddrinfo",
        lambda *_args, **_kwargs: [(2, 1, 6, "", ("172.31.8.20", 443))],
    )
    assert await _validate_public_https_url("https://files.mark.internal/file.pdf") == "files.mark.internal"


class _FakeDb:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, value):
        self.added.append(value)


@pytest.mark.asyncio
async def test_receive_website_lead_creates_unassigned_crm_lead():
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record = AsyncMock(return_value=None)
    lead_row = SimpleNamespace(id="l-website-1", document={})
    service.crm_repo.create_lead = AsyncMock(return_value=lead_row)
    body = UnifiedLeadEvent.model_validate(
        {
            "eventId": "evt-1",
            "eventType": "lead.created",
            "externalRecordId": "WEB-001",
            "occurredAt": "2026-08-04T15:30:00+08:00",
            "data": {
                "companyName": "示例公司",
                "contactName": "联系人",
                "contactPhone": "13800138000",
            },
        }
    )
    result = await service.receive_lead("website", body)
    assert result.created is True
    assert result.external_record_id == "WEB-001"
    assert result.crm_lead_id == "l-website-1"
    assert any(isinstance(row, MarkIntegrationRecord) for row in db.added)
    assert any(isinstance(row, MarkIntegrationEvent) for row in db.added)
    document = service.crm_repo.create_lead.await_args.kwargs["document"]
    assert document["source"] == "官网注册"
    assert document["sourceDetail"] == "官网首页"
    assert document["importMeta"]["platform"] == "website"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_receive_lead_preserves_all_business_fields_and_provenance():
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record = AsyncMock(return_value=None)
    service.crm_repo.create_lead = AsyncMock(
        return_value=SimpleNamespace(id="l-full-1", document={})
    )
    body = UnifiedLeadEvent.model_validate(
        {
            "platformCode": "mark",
            "eventId": "evt-full-1",
            "eventType": "lead.created",
            "externalRecordId": "MARK-FULL-1",
            "occurredAt": "2026-08-12T10:20:30+08:00",
            "operator": {"id": "op-1", "name": "Mark Bot"},
            "data": {
                "companyName": "完整字段公司",
                "brandName": "完整品牌",
                "contactName": "联系人",
                "contactTitle": "市场总监",
                "contactPhone": "13800138000",
                "email": "full@example.com",
                "website": "https://example.com",
                "requirements": "需要 GEO 诊断与执行方案",
                "landingPage": "https://example.com/landing",
                "utmSource": "36kr",
                "utmMedium": "cpc",
                "utmCampaign": "summer-2026",
            },
        }
    )

    await service.receive_lead("mark", body)

    document = service.crm_repo.create_lead.await_args.kwargs["document"]
    assert document["requirements"] == "需要 GEO 诊断与执行方案"
    assert document["website"] == "https://example.com"
    assert "landingPage" not in document
    assert document["importMeta"] == {
        "source": "integration",
        "platform": "mark",
        "externalRecordId": "MARK-FULL-1",
        "lastEventId": "evt-full-1",
        "occurredAt": "2026-08-12T10:20:30+08:00",
        "importedAt": document["importMeta"]["importedAt"],
        "landingpageRaw": "https://example.com/landing",
        "utmSource": "36kr",
        "utmMedium": "cpc",
        "utmCampaign": "summer-2026",
        "operator": {"id": "op-1", "name": "Mark Bot"},
    }


def test_mark_material_is_carried_to_customer_as_archived_read_only_attachment():
    from app.modules.crm.service.helpers_leads import _carry_mark_materials_to_customer

    carried = _carry_mark_materials_to_customer(
        [
            {
                "id": "file-row-1",
                "fileName": "方案.pdf",
                "size": 13264,
                "status": "downloaded",
                "uploadedAt": "2026-08-12T10:30:00",
            },
            {"id": "file-row-2", "fileName": "未完成.pdf", "status": "pending_download"},
        ],
        lead_id="lead-1",
    )

    assert carried == [
        {
            "id": "file-row-1",
            "name": "方案.pdf",
            "url": "/api/crm/mark-materials/file-row-1",
            "contentType": "application/pdf",
            "size": 13264,
            "uploadedAt": "2026-08-12T10:30:00",
            "uploadedBy": "Mark",
            "description": "Mark 自动生成并由 CRM 校验归档的 PDF 材料",
            "origin": "lead",
            "sourceLeadId": "lead-1",
            "sourceLeadAttachmentId": "mark:file-row-1",
        }
    ]


def test_external_requirement_is_carried_to_customer_follow_up():
    from app.modules.crm.service.helpers_leads import _carry_lead_requirement_to_customer

    note = _carry_lead_requirement_to_customer(
        {
            "requirements": "需要 GEO 诊断",
            "createdAt": "2026-08-12",
            "importMeta": {
                "occurredAt": "2026-08-12T10:20:30+08:00",
                "operator": {"id": "op-1", "name": "Mark Bot"},
            },
        },
        lead_id="lead-1",
    )

    assert note is not None
    assert note["content"] == "接入需求：需要 GEO 诊断"
    assert note["author"] == "Mark Bot"
    assert note["sourceLeadNoteId"] == "requirement:lead-1"


@pytest.mark.asyncio
async def test_converted_mark_material_keeps_original_lead_access():
    from app.modules.crm.service.leads import LeadMixin

    service = object.__new__(LeadMixin)
    service.repo = SimpleNamespace(
        get_lead=AsyncMock(
            return_value=SimpleNamespace(
                owner_user_id="sdr-1", sdr="SDR一号", converted_coverage_id="coverage-1"
            )
        )
    )
    service._assert_section = Mock()
    service._assert_row_access = AsyncMock(return_value=None)
    service._assert_coverage_access = AsyncMock()

    await service.assert_mark_material_access(SimpleNamespace(id="sdr-1"), "lead-1")

    service._assert_row_access.assert_awaited_once()
    service._assert_coverage_access.assert_not_awaited()


@pytest.mark.asyncio
async def test_converted_mark_material_falls_back_to_visible_sales_coverage():
    from app.core.exceptions import PermissionDeniedError
    from app.modules.crm.service.leads import LeadMixin

    coverage = SimpleNamespace(id="coverage-1")
    service = object.__new__(LeadMixin)
    service.repo = SimpleNamespace(
        get_lead=AsyncMock(
            return_value=SimpleNamespace(
                owner_user_id="sdr-1", sdr="SDR一号", converted_coverage_id="coverage-1"
            )
        ),
        get_coverage=AsyncMock(return_value=coverage),
    )
    service._assert_section = Mock()
    service._assert_row_access = AsyncMock(side_effect=PermissionDeniedError())
    service._assert_coverage_access = AsyncMock(return_value=None)

    await service.assert_mark_material_access(SimpleNamespace(id="sales-1"), "lead-1")

    service._assert_coverage_access.assert_awaited_once_with(
        SimpleNamespace(id="sales-1"), coverage
    )


@pytest.mark.asyncio
async def test_receive_lead_rejects_changed_duplicate_event():
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(
        return_value=MarkIntegrationEvent(
            id="event-row",
            platform="mark",
            event_id="evt-1",
            event_type="lead.created",
            external_record_id="WEB-001",
            payload_hash="different",
            process_status="processed",
            response_json={},
            received_at=datetime.now(),
            processed_at=datetime.now(),
        )
    )
    body = UnifiedLeadEvent.model_validate(
        {
            "eventId": "evt-1",
            "eventType": "lead.created",
            "externalRecordId": "WEB-001",
            "occurredAt": "2026-08-04T15:30:00+08:00",
            "data": {
                "companyName": "示例公司",
                "contactName": "联系人",
                "contactPhone": "13800138000",
            },
        }
    )
    with pytest.raises(ConflictError):
        await service.receive_lead("website", body)


@pytest.mark.asyncio
async def test_36kr_maps_to_website_registration():
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record = AsyncMock(return_value=None)
    service.crm_repo.create_lead = AsyncMock(
        return_value=SimpleNamespace(id="l-36kr-1", document={})
    )
    body = UnifiedLeadEvent.model_validate(
        {
            "eventId": "evt-36kr-1",
            "eventType": "lead.created",
            "externalRecordId": "36KR-001",
            "occurredAt": "2026-08-04T16:00:00+08:00",
            "data": {
                "companyName": "示例公司",
                "contactName": "联系人",
                "contactPhone": "13800138000",
            },
        }
    )
    await service.receive_lead("36kr", body)
    document = service.crm_repo.create_lead.await_args.kwargs["document"]
    assert document["source"] == "官网注册"
    assert document["sourceDetail"] == "36氪"


@pytest.mark.asyncio
async def test_receive_mark_lead_creates_basic_lead_without_material():
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record = AsyncMock(return_value=None)
    service.crm_repo.create_lead = AsyncMock(
        return_value=SimpleNamespace(id="l-mark-1", document={})
    )
    body = UnifiedLeadEvent.model_validate(
        {
            "eventId": "evt-mark-lead-1",
            "eventType": "lead.created",
            "externalRecordId": "MARK-DELIVERY-1",
            "occurredAt": "2026-08-04T16:00:00+08:00",
            "data": {
                "companyName": "示例公司",
                "brandName": "示例品牌",
                "contactName": "联系人",
                "contactTitle": "市场总监",
                "contactPhone": "13800138000",
                "email": "contact@example.com",
            },
        }
    )
    result = await service.receive_lead("mark", body)
    assert result.crm_lead_id == "l-mark-1"
    assert not any(row.__class__.__name__ == "MarkIntegrationFile" for row in db.added)
    assert any(row.__class__.__name__ == "MarkIntegrationEvent" for row in db.added)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_receive_mark_material_saves_s3_url_as_download_job(
    monkeypatch: pytest.MonkeyPatch,
):
    db = _FakeDb()
    service = MarkIntegrationService(db)  # type: ignore[arg-type]
    service.repo.get_event = AsyncMock(return_value=None)
    service.repo.get_record_by_lead = AsyncMock(
        return_value=SimpleNamespace(external_record_id="MARK-001")
    )
    service.repo.get_lead = AsyncMock(return_value=SimpleNamespace(id="l-mark-1"))
    service.repo.get_file = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "app.modules.mark_integration.service._validate_public_https_url",
        AsyncMock(return_value="your-bucket.s3.amazonaws.com"),
    )
    body = MarkMaterialEvent.model_validate({
        "eventId": "evt-material-1",
        "eventType": "materials.created",
        "externalRecordId": "MARK-001",
        "materialVersion": "1",
        "occurredAt": "2026-08-05T11:00:00+08:00",
        "fileId": "mark-file-1",
        "fileName": "report.pdf",
        "fileUrl": "https://your-bucket.s3.amazonaws.com/report.pdf?signature=test",
        "contentType": "application/pdf",
        "size": 20,
        "checksum": "b" * 64,
        "urlExpiresAt": "2099-08-05T12:00:00+08:00",
    })
    result = await service.receive_material("l-mark-1", body)
    file_row = next(row for row in db.added if row.__class__.__name__ == "MarkIntegrationFile")
    assert result.pdf_status == "pendingDownload"
    assert file_row.source_url.startswith("https://your-bucket.s3.amazonaws.com/")
    assert file_row.download_status == "pending_download"
    db.commit.assert_awaited_once()


def test_lead_schema_rejects_material_payload():
    with pytest.raises(Exception, match="pdf"):
        UnifiedLeadEvent.model_validate({
        "eventId": "evt-validation",
        "eventType": "lead.created",
        "externalRecordId": "EXT-001",
        "occurredAt": "2026-08-04T16:00:00+08:00",
        "data": {
            "companyName": "示例公司",
            "contactName": "联系人",
            "contactPhone": "13800138000",
            "email": "contact@example.com",
        },
        "pdf": {
            "fileId": "file-1",
            "fileName": "result.pdf",
        },
    })


def test_material_event_accepts_s3_pdf_location():
    body = MarkMaterialEvent.model_validate({
        "eventId": "evt-material-1",
        "eventType": "materials.created",
        "externalRecordId": "MARK-001",
        "materialVersion": "1",
        "occurredAt": "2026-08-05T11:00:00+08:00",
        "fileId": "mark-file-1",
        "fileName": "report.pdf",
        "fileUrl": "https://your-bucket.s3.amazonaws.com/report.pdf?signature=test",
        "contentType": "application/pdf",
        "size": 20,
        "checksum": "b" * 64,
    })
    assert body.material_version == "1"
    assert str(body.file_url).startswith("https://your-bucket.s3.amazonaws.com/")


def test_only_unified_lead_integration_route_is_registered():
    from app.main import create_app

    # FastAPI 新版本 app.routes 含 _IncludedRouter，用 openapi() 汇总真实注册路径（跨版本稳定）
    paths = set(create_app().openapi()["paths"].keys())
    assert "/api/integrations/leads" in paths
    assert "/api/v1/integrations/leads" in paths
    assert "/api/integrations/mark/leads/{crm_lead_id}/materials" in paths
    assert "/api/v1/integrations/mark/leads/{crm_lead_id}/materials" in paths
    assert "/api/crm/mark-materials/{file_id}" in paths
    assert "/api/crm/mark-materials/{file_id}/retry" in paths
    assert "/api/integrations/mark/events" not in paths


@pytest.mark.asyncio
async def test_integration_auth_error_uses_documented_envelope():
    from app.main import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/integrations/leads", json={})
    assert response.status_code == 401
    assert response.json()["code"] == 40101
    assert "message" in response.json()
    assert "requestId" in response.json()
