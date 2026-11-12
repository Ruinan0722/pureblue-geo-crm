"""需求批量导出：服务端生成 Excel(.xlsx) 与 PDF。

调用方（router）负责权限与数据范围校验；本模块只负责把已授权的
RequestRecord 列表渲染为文件字节。
"""

from __future__ import annotations

import io
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from babel import Locale
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.modules.contracts.status_catalog import (
    INTAKE_DOMESTIC_GOALS,
    REQUEST_STATUS_META,
)

EXPORT_HEADERS = [
    "需求编号",
    "状态",
    "公司名称",
    "联系人",
    "职位",
    "手机号",
    "品牌名称",
    "品牌别名",
    "本次优化范围",
    "产品或服务（含功能/用户/场景/竞品）",
    "海外官网",
    "品牌核心目标用户",
    "目标国家-语言",
    "AI 平台",
    "优化背景",
    "用户问题/方向",
    "优化目标",
    "跟进人",
    "提交时间",
]

_ZH = Locale.parse("zh_Hans_CN")

_SPECIAL_REGION_LABELS = {"MENA": "中东"}

_OVERSEAS_GOAL_LABELS = {
    "source": "来源率",
    "recommend": "推荐率",
    "top3": "前三推荐率",
    "priority": "优先推荐率",
}

_DOMESTIC_GOAL_LABELS = {item["value"]: item["label"] for item in INTAKE_DOMESTIC_GOALS}

_SCOPE_LABELS = {
    "brand_only": "仅优化品牌整体",
    "specific": "优化具体产品或服务",
}

_TARGET_CUSTOMER_LABELS = {
    "toc": "A、TOC（个人消费者）",
    "tob": "B、TOB（企业/机构客户）",
    "both": "C、TOC & TOB（两类用户均覆盖）",
}


def _flatten(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\n+", "；").strip()
    return text


def _region_label(regions: Any) -> str:
    if not isinstance(regions, list):
        return "—"
    labels: list[str] = []
    for item in regions:
        if not isinstance(item, dict) or not item.get("country"):
            continue
        country = str(item["country"])
        language = str(item.get("language") or "")
        platform = str(item.get("platform") or "")
        country_label = _SPECIAL_REGION_LABELS.get(country) or _ZH.territories.get(country, country)
        if language:
            language_label = (
                "简体中文" if language == "zh-Hans" else
                "繁体中文" if language == "zh-Hant" else
                _ZH.languages.get(language, language)
            )
            region_label = f"{country_label}-{language_label}"
        else:
            region_label = country_label
        labels.append(f"{platform}｜{region_label}" if platform else region_label)
    return "；".join(labels) or "—"


def _goal_label(value: Any) -> str:
    if not value:
        return "—"
    key = str(value)
    return _OVERSEAS_GOAL_LABELS.get(key) or _DOMESTIC_GOAL_LABELS.get(key) or key


def _target_customer_label(value: Any) -> str:
    if not value:
        return "—"
    return _TARGET_CUSTOMER_LABELS.get(str(value)) or str(value)


def _goals_text(data: dict[str, Any]) -> str:
    goals = data.get("goals")
    if isinstance(goals, list) and goals:
        return "、".join(_goal_label(g) for g in goals if g)
    return _goal_label(data.get("goal"))


def _products_text(data: dict[str, Any]) -> str:
    if data.get("scopeType") != "specific":
        return "—"
    products = [p for p in (data.get("products") or []) if isinstance(p, dict) and (p.get("name") or "").strip()]
    if not products:
        return "—"
    parts: list[str] = []
    for index, product in enumerate(products, start=1):
        item = [
            f"Top {index} · {product.get('name', '')}",
            f"功能：{_flatten(product.get('fn')) or '—'}",
            f"用户：{_flatten(product.get('users')) or '—'}",
            f"场景：{_flatten(product.get('scenario')) or '—'}",
        ]
        if (product.get("competitors") or "").strip():
            item.append(f"竞品：{_flatten(product.get('competitors'))}")
        parts.append("；".join(item))
    return " | ".join(parts)


def _intent_text(data: dict[str, Any]) -> str:
    products = [p for p in (data.get("products") or []) if isinstance(p, dict)]
    default_product_id = (
        next((p["id"] for p in products if (p.get("name") or "").strip()), "__brand__")
        if data.get("scopeType") == "specific"
        else "__brand__"
    )

    def product_name(product_id: Any) -> str:
        if not product_id or product_id == "__brand__":
            return (data.get("brandName") or "").strip() or "品牌整体"
        for product in products:
            if product.get("id") == product_id and (product.get("name") or "").strip():
                return str(product["name"]).strip()
        return "品牌整体"

    items: list[tuple[str, str]] = []
    mode_label = ""
    intent_type = data.get("intentType")
    if intent_type == "clear":
        mode_label = "我有明确的问题"
        raw = data.get("intentQuestions") or []
        for q in raw:
            if isinstance(q, dict) and (q.get("text") or "").strip():
                items.append((str(q.get("productId") or default_product_id), str(q["text"]).strip()))
    elif intent_type == "rough":
        mode_label = "我只有大致业务方向"
        raw = data.get("intentRoughItems") or []
        for q in raw:
            if isinstance(q, dict) and (q.get("text") or "").strip():
                items.append((str(q.get("productId") or default_product_id), str(q["text"]).strip()))

    if not items:
        return "—"
    lines = [
        f"Top {index} · 【{product_name(product_id)}】{text}"
        for index, (product_id, text) in enumerate(items, start=1)
    ]
    body = " | ".join(lines)
    return f"{mode_label}：{body}" if mode_label else body


def _status_label(status: Any) -> str:
    meta = REQUEST_STATUS_META.get(str(status) if status else "")
    return (meta or {}).get("label", str(status) or "—")


def _owner_text(owner: Any, employment_status: Any) -> str:
    name = str(owner or "").strip() or "未分配"
    if employment_status == "resigned" and name != "未分配":
        return f"{name}（已离职）"
    return name


def request_to_row(record: Any) -> list[str]:
    data = record.data if isinstance(record.data, dict) else {}
    overseas_url = data.get("overseasSiteUrl")
    return [
        str(record.code or ""),
        _status_label(record.status),
        _flatten(data.get("companyName")),
        _flatten(data.get("contactName")),
        _flatten(data.get("contactTitle")),
        _flatten(data.get("contactPhone")),
        _flatten(data.get("brandName")),
        "、".join(a for a in (data.get("brandAliases") or []) if str(a).strip()),
        _SCOPE_LABELS.get(data.get("scopeType") or "", "—"),
        _products_text(data),
        _flatten(overseas_url) if data.get("hasOverseasSite") == "yes" else "无",
        _target_customer_label(data.get("targetCustomer")),
        _region_label(data.get("regions")),
        "、".join(str(p) for p in (data.get("platforms") or [])),
        _flatten(data.get("optimizeBackground")) or "—",
        _intent_text(data),
        _goals_text(data),
        _owner_text(getattr(record, "owner", None), getattr(record, "owner_employment_status", None)),
        str(record.submitted_at or "—"),
    ]


def build_xlsx(records: Iterable[Any]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "需求导出"
    header_fill = PatternFill("solid", fgColor="1E40AF")
    header_font = Font(color="FFFFFF", bold=True)
    for col_index, header in enumerate(EXPORT_HEADERS, start=1):
        cell = ws.cell(row=1, column=col_index, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row_index, record in enumerate(records, start=2):
        for col_index, value in enumerate(request_to_row(record), start=1):
            cell = ws.cell(row=row_index, column=col_index, value=value)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    widths = [16, 12, 22, 12, 12, 14, 18, 18, 16, 46, 18, 10, 22, 14, 36, 46, 16, 14, 20]
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(index)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(EXPORT_HEADERS))}{ws.max_row}"
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))


def _pdf_styles() -> dict[str, ParagraphStyle]:
    base = ParagraphStyle(
        "base",
        fontName="STSong-Light",
        fontSize=10,
        leading=16,
        wordWrap="CJK",
    )
    return {
        "title": ParagraphStyle("title", parent=base, fontSize=18, leading=26, alignment=1),
        "meta": ParagraphStyle("meta", parent=base, fontSize=9, leading=14, textColor=colors.HexColor("#475569")),
        "h2": ParagraphStyle("h2", parent=base, fontSize=13, leading=20, textColor=colors.HexColor("#1E3A8A")),
        "cell": ParagraphStyle("cell", parent=base, fontSize=9.5, leading=14),
        "cellLabel": ParagraphStyle("cellLabel", parent=base, fontSize=9.5, leading=14, textColor=colors.HexColor("#475569")),
        "footer": ParagraphStyle("footer", parent=base, fontSize=8, leading=11, textColor=colors.HexColor("#94A3B8")),
    }


def _escape_pdf_text(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_pdf(records: Iterable[Any]) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title="客户需求导出",
        author="GEO 客户经营平台",
    )
    styles = _pdf_styles()
    story: list[Any] = []
    records = list(records)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    story.append(Paragraph("客户需求导出", styles["title"]))
    story.append(
        Paragraph(f"导出时间：{now}　共 {len(records)} 条", styles["meta"])
    )
    story.append(Spacer(1, 6 * mm))

    for index, record in enumerate(records, start=1):
        row = request_to_row(record)
        if index > 1:
            story.append(PageBreak())
        story.append(Paragraph(f"{index}. {_escape_pdf_text(str(record.code or ''))}", styles["h2"]))
        story.append(Spacer(1, 3 * mm))
        table_data: list[list[Paragraph]] = []
        for label, value in zip(EXPORT_HEADERS, row):
            table_data.append(
                [
                    Paragraph(_escape_pdf_text(label), styles["cellLabel"]),
                    Paragraph(_escape_pdf_text(value or "—"), styles["cell"]),
                ]
            )
        table = Table(table_data, colWidths=[32 * mm, 142 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F1F5F9")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(table)

    def _footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("STSong-Light", 8)
        canvas.setFillColor(colors.HexColor("#94A3B8"))
        canvas.drawCentredString(A4[0] / 2, 10 * mm, f"第 {canvas.getPageNumber()} 页")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()
