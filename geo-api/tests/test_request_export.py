"""需求批量导出：行构建、xlsx/pdf 生成与服务端权限/范围校验。"""

from __future__ import annotations

import io

import pytest
from openpyxl import load_workbook

from app.core.exceptions import PermissionDeniedError, ValidationError
from app.modules.requests.export_data import build_pdf, build_xlsx, request_to_row
from app.modules.requests.service import RequestService


def _record(**overrides):
    base = {
        "id": "req-1",
        "code": "GEO-OV-20260807-0001",
        "status": "submitted",
        "submitted_at": "2026-08-07 10:00:00",
        "updated_at": "2026-08-07 10:00:00",
        "owner": "张三",
        "staff_user_id": "u1",
        "owner_employment_status": None,
        "notes": [],
        "attachments": [],
        "invite_id": None,
        "opportunity_id": None,
        "data": {
            "companyName": "测试公司",
            "contactName": "李四",
            "contactTitle": "负责人",
            "contactPhone": "13800000000",
            "brandName": "测试品牌",
            "brandAliases": ["别名A"],
            "scopeType": "brand_only",
            "hasOverseasSite": "yes",
            "overseasSiteUrl": "https://example.com",
            "targetCustomer": "toc",
            "regions": [{"id": "r1", "country": "US", "language": "en"}],
            "platforms": ["ChatGPT"],
            "optimizeBackground": "背景",
            "intentType": "clear",
            "intentQuestions": [{"id": "q1", "text": "用户问题", "productId": "__brand__"}],
            "goal": "source",
            "goals": [],
        },
    }
    base.update(overrides)
    return type("Row", (), base)()


def test_request_to_row_labels():
    row = request_to_row(_record())
    assert row[0] == "GEO-OV-20260807-0001"
    assert row[1] == "客户已提交"
    assert row[2] == "测试公司"
    assert row[8] == "仅优化品牌整体"
    assert row[10] == "https://example.com"
    assert row[11] == "A、TOC（个人消费者）"
    assert row[12] == "美国-英语"
    assert row[14] == "背景"
    assert row[15] == "我有明确的问题：Top 1 · 【测试品牌】用户问题"
    assert row[16] == "来源率"
    assert row[17] == "张三"


def test_request_to_row_legacy_status_and_missing_fields():
    row = request_to_row(_record(status="closed", data={"companyName": "老需求"}))
    assert row[1] == "已关闭"
    assert row[10] == "无"
    assert row[11] == "—"
    assert row[12] == "—"
    assert row[15] == "—"


def test_build_xlsx_returns_readable_workbook():
    content = build_xlsx([_record(), _record(code="GEO-OV-20260807-0002")])
    wb = load_workbook(io.BytesIO(content))
    ws = wb.active
    assert ws.title == "需求导出"
    assert ws.max_row == 3
    assert ws.cell(row=1, column=1).value == "需求编号"
    assert ws.cell(row=2, column=2).value == "客户已提交"


def test_build_pdf_returns_pdf_bytes():
    content = build_pdf([_record(), _record(code="GEO-OV-20260807-0002")])
    assert content.startswith(b"%PDF")
    assert len(content) > 1000


def _svc(rows, permissions):
    class FakeRepo:
        def __init__(self, rows):
            self.rows = rows

        async def get_by_ids_for_export(self, ids, **kwargs):
            return [r for r in self.rows if r.id in set(ids)]

        async def list_request_children(self, request_ids):
            # 测试行已自带完整 data，不需要子表组装
            return {rid: None for rid in request_ids}

    class FakeUser:
        pass

    svc = RequestService(object())  # type: ignore[arg-type]
    svc.repo = FakeRepo(rows)  # type: ignore[assignment]

    async def _noop_enrich(records):
        return records

    svc._enrich_records = _noop_enrich  # type: ignore[method-assign]
    user = FakeUser()
    user.permissions = permissions
    user.role = "sales"
    return svc, user


@pytest.mark.asyncio
async def test_export_requires_export_permission():
    svc, user = _svc([_record()], permissions=["request:view"])
    with pytest.raises(PermissionDeniedError):
        await svc.export_records(user, ["req-1"])


@pytest.mark.asyncio
async def test_export_rejects_empty_ids():
    svc, user = _svc([_record()], permissions=["request:view", "request:export"])
    with pytest.raises(ValidationError):
        await svc.export_records(user, [])


@pytest.mark.asyncio
async def test_export_rejects_out_of_scope_ids():
    svc, user = _svc([_record()], permissions=["request:view", "request:export"])

    async def resolve_scope(_user, **kwargs):
        return None, False

    svc._resolve_list_scope = resolve_scope  # type: ignore[method-assign]
    with pytest.raises(PermissionDeniedError):
        await svc.export_records(user, ["req-1", "req-missing"])


@pytest.mark.asyncio
async def test_export_returns_records_in_scope():
    svc, user = _svc([_record(), _record(id="req-2")], permissions=["request:view", "request:export"])

    async def resolve_scope(_user, **kwargs):
        return None, False

    svc._resolve_list_scope = resolve_scope  # type: ignore[method-assign]
    records = await svc.export_records(user, ["req-1", "req-2"])
    assert [r.id for r in records] == ["req-1", "req-2"]
