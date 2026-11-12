"""需求表单 data 全列化：标量列 + products/intent/list/import_meta 子表（回填）。

Revision ID: 044_request_form_columns
Revises: 043_customer_remaining
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "044_request_form_columns"
down_revision: Union[str, None] = "043_customer_remaining"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 1024), 'null'), 'undefined')"


def _jtext(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '{path}')), '')"
    return f"NULLIF(NULLIF({inner}, 'null'), 'undefined')"


def _jdate(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '{path}')), '')"
    return (
        f"CASE WHEN {inner} REGEXP '^[0-9]{{4}}[-/][0-9]{{1,2}}[-/][0-9]{{1,2}}' "
        f"THEN CAST(LEFT({inner}, 10) AS DATE) ELSE NULL END"
    )


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    match = re.match(
        r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?",
        str(value).strip(),
    )
    if not match:
        return None
    try:
        year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        hour = int(match.group(4) or 0)
        minute = int(match.group(5) or 0)
        second = int(match.group(6) or 0)
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def _jstrv(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def upgrade() -> None:
    bind = op.get_bind()

    string_columns = [
        ("scope_type", sa.String(16)),
        ("has_overseas_site", sa.String(8)),
        ("overseas_site_url", sa.String(1024)),
        ("intent_type", sa.String(16)),
        ("optimize_period", sa.String(16)),
        ("optimize_period_custom", sa.String(64)),
        ("contact_name", sa.String(128)),
        ("contact_phone", sa.String(64)),
        ("contact_title", sa.String(128)),
        ("budget", sa.String(64)),
        ("period", sa.String(32)),
        ("website", sa.String(1024)),
        ("customer_no", sa.String(64)),
        ("feishu_code", sa.String(128)),
        ("project_stage", sa.String(64)),
        ("city", sa.String(128)),
        ("industry", sa.String(128)),
        ("budget_range", sa.String(64)),
    ]
    text_columns = [
        ("optimize_background", sa.Text()),
        ("intent_rough", sa.Text()),
        ("strength_market", sa.Text()),
        ("strength_tech", sa.Text()),
        ("strength_brand", sa.Text()),
        ("strength_ecosystem", sa.Text()),
        ("strength_other", sa.Text()),
        ("competitors", sa.Text()),
    ]
    for name, col_type in string_columns + text_columns:
        op.add_column("requests", sa.Column(name, col_type, nullable=True))
    op.add_column("requests", sa.Column("expected_start_date", sa.Date(), nullable=True))
    op.add_column("requests", sa.Column("expected_start", sa.Date(), nullable=True))
    # 旧 brand_name 列 String(255) 放不下长品牌文案（实测最长 354 字符）：加宽并重背fill
    op.alter_column(
        "requests",
        "brand_name",
        existing_type=sa.String(255),
        type_=sa.String(1024),
        existing_nullable=True,
    )

    assigns = ",\n".join(
        f"{name} = {_jstr('$.' + _camel(name))}" for name, _ in string_columns
    )
    text_assigns = ",\n".join(
        f"{name} = {_jtext('$.' + _camel(name))}" for name, _ in text_columns
    )
    bind.execute(
        sa.text(
            "UPDATE requests SET "
            f"{assigns}, "
            f"{text_assigns}, "
            "company_name = " + _jstr("$.companyName") + ", "
            "brand_name = " + _jstr("$.brandName") + ", "
            "goal = " + _jstr("$.goal") + ", "
            "expected_start_date = " + _jdate("$.expectedStartDate") + ", "
            "expected_start = " + _jdate("$.expectedStart")
        )
    )

    op.create_table(
        "request_products",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("item_id", sa.String(64), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("fn", sa.Text(), nullable=True),
        sa.Column("users", sa.Text(), nullable=True),
        sa.Column("scenario", sa.Text(), nullable=True),
        sa.Column("competitors", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("request_id", "sort_order", name="uq_request_products_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_request_products_request", "request_products", ["request_id"])

    op.create_table(
        "request_intent_items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("item_id", sa.String(64), nullable=True),
        sa.Column("product_id", sa.String(64), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("request_id", "kind", "sort_order", name="uq_request_intent_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_request_intent_request", "request_intent_items", ["request_id", "kind"])

    op.create_table(
        "request_list_items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("value", sa.String(512), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("request_id", "kind", "sort_order", name="uq_request_list_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_request_list_request", "request_list_items", ["request_id", "kind"])

    op.create_table(
        "request_import_meta",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column("source", sa.String(64), nullable=True),
        sa.Column("feishu_record_id", sa.String(64), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=False), nullable=True),
        mysql_charset="utf8mb4",
    )
    op.create_table(
        "request_feishu_links",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("url", sa.String(1024), nullable=True),
        sa.Column("text", sa.String(1024), nullable=True),
        sa.Column("field", sa.String(64), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("request_id", "sort_order", name="uq_request_feishu_links_order"),
        mysql_charset="utf8mb4",
    )
    op.create_index("idx_request_feishu_links_request", "request_feishu_links", ["request_id"])
    # 035 的 String(16)/String(32) 放不下多行地区串（实测最长 58 字符）：加宽
    op.alter_column(
        "request_regions",
        "country",
        existing_type=sa.String(16),
        type_=sa.String(128),
        existing_nullable=False,
    )
    op.alter_column(
        "request_regions",
        "language",
        existing_type=sa.String(32),
        type_=sa.String(128),
        existing_nullable=True,
    )

    # —— 子表回填（Python 逐行，逻辑与仓库 sync 一致）——
    rows = bind.execute(sa.text("SELECT id, data FROM requests")).fetchall()
    product_params: list[dict[str, Any]] = []
    intent_params: list[dict[str, Any]] = []
    list_params: list[dict[str, Any]] = []
    meta_params: list[dict[str, Any]] = []
    feishu_params: list[dict[str, Any]] = []
    product_sql = sa.text(
        "INSERT INTO request_products (id, request_id, item_id, name, fn, users, scenario, competitors, sort_order) "
        "VALUES (:id, :request_id, :item_id, :name, :fn, :users, :scenario, :competitors, :sort_order)"
    )
    intent_sql = sa.text(
        "INSERT INTO request_intent_items (id, request_id, kind, item_id, product_id, text, sort_order) "
        "VALUES (:id, :request_id, :kind, :item_id, :product_id, :text, :sort_order)"
    )
    list_sql = sa.text(
        "INSERT INTO request_list_items (id, request_id, kind, value, sort_order) "
        "VALUES (:id, :request_id, :kind, :value, :sort_order)"
    )
    meta_sql = sa.text(
        "INSERT IGNORE INTO request_import_meta (request_id, source, feishu_record_id, imported_at) "
        "VALUES (:request_id, :source, :feishu_record_id, :imported_at)"
    )
    feishu_sql = sa.text(
        "INSERT INTO request_feishu_links (id, request_id, url, text, field, sort_order) "
        "VALUES (:id, :request_id, :url, :text, :field, :sort_order)"
    )
    for row in rows:
        raw = row.data
        if isinstance(raw, (str, bytes)):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}
        data = raw if isinstance(raw, dict) else {}
        rid = row.id

        for index, item in enumerate(data.get("products") or []):
            if not isinstance(item, dict):
                continue
            product_params.append(
                {
                    "id": f"{rid}-pr-{index}",
                    "request_id": rid,
                    "item_id": _jstrv(item.get("id")),
                    "name": _jstrv(item.get("name")) or "",
                    "fn": _jstrv(item.get("fn")),
                    "users": _jstrv(item.get("users")),
                    "scenario": _jstrv(item.get("scenario")),
                    "competitors": _jstrv(item.get("competitors")),
                    "sort_order": index,
                }
            )
        for kind, key in (("questions", "intentQuestions"), ("rough", "intentRoughItems")):
            items = data.get(key)
            if not isinstance(items, list):
                continue
            for index, item in enumerate(items):
                if isinstance(item, str):
                    intent_params.append(
                        {
                            "id": f"{rid}-it-{kind}-{index}",
                            "request_id": rid,
                            "kind": kind,
                            "item_id": None,
                            "product_id": None,
                            "text": item.strip(),
                            "sort_order": index,
                        }
                    )
                elif isinstance(item, dict):
                    intent_params.append(
                        {
                            "id": f"{rid}-it-{kind}-{index}",
                            "request_id": rid,
                            "kind": kind,
                            "item_id": _jstrv(item.get("id")),
                            "product_id": _jstrv(item.get("productId")),
                            "text": str(item.get("text") or "").strip(),
                            "sort_order": index,
                        }
                    )
        for kind, key in (
            ("platforms", "platforms"),
            ("brand_aliases", "brandAliases"),
            ("brand_competitors", "brandCompetitors"),
        ):
            items = data.get(key)
            if not isinstance(items, list):
                continue
            for index, value in enumerate(items):
                value = str(value or "").strip()
                if not value:
                    continue
                list_params.append(
                    {
                        "id": f"{rid}-li-{kind}-{index}",
                        "request_id": rid,
                        "kind": kind,
                        "value": value[:512],
                        "sort_order": index,
                    }
                )
        for index, link in enumerate(data.get("feishuLinks") or []):
            if isinstance(link, dict):
                feishu_params.append(
                    {
                        "id": f"{rid}-fl-{index}",
                        "request_id": rid,
                        "url": _jstrv(link.get("url")),
                        "text": _jstrv(link.get("text")),
                        "field": _jstrv(link.get("field")),
                        "sort_order": index,
                    }
                )
            elif isinstance(link, str) and str(link).strip():
                feishu_params.append(
                    {
                        "id": f"{rid}-fl-{index}",
                        "request_id": rid,
                        "url": str(link).strip(),
                        "text": None,
                        "field": None,
                        "sort_order": index,
                    }
                )
        meta = data.get("importMeta")
        if isinstance(meta, dict) and meta:
            meta_params.append(
                {
                    "request_id": rid,
                    "source": _jstrv(meta.get("source")),
                    "feishu_record_id": _jstrv(meta.get("feishuRecordId")),
                    "imported_at": _parse_dt(meta.get("importedAt")),
                }
            )
    if product_params:
        bind.execute(product_sql, product_params)
    if intent_params:
        bind.execute(intent_sql, intent_params)
    if list_params:
        bind.execute(list_sql, list_params)
    if meta_params:
        bind.execute(meta_sql, meta_params)
    if feishu_params:
        bind.execute(feishu_sql, feishu_params)

    # —— 035 曾回填但 dev 库源数据后导入导致为空：幂等补回填 data.regions / data.goals ——
    # 035 建的 request_* 子表为 utf8mb4_unicode_ci，与 requests(0900_ai_ci) 跨列比较会报 collation 错，
    # 因此用 expanding 参数删除（参数不带 collation），再按当前 data 重建。
    rid_params = sa.bindparam("rids", expanding=True)
    if rows:
        rids = tuple(str(r.id) for r in rows)
        bind.execute(
            sa.text(
                "DELETE FROM request_regions WHERE request_id IN :rids"
            ).bindparams(rid_params),
            {"rids": rids},
        )
        bind.execute(
            sa.text(
                "DELETE FROM request_goals WHERE request_id IN :rids"
            ).bindparams(rid_params),
            {"rids": rids},
        )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO request_regions (id, request_id, country, language) "
            "SELECT CONCAT(r.id, '-rg-', jt.ordinality - 1), r.id, "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.country')), ''), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.language')), '') "
            "FROM requests r, "
            "JSON_TABLE(r.data, '$.regions[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.country')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO request_goals (id, request_id, goal) "
            "SELECT CONCAT(r.id, '-gl-', jt.ordinality - 1), r.id, JSON_UNQUOTE(jt.value) "
            "FROM requests r, "
            "JSON_TABLE(r.data, '$.goals[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(jt.value) IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_index("idx_request_feishu_links_request", table_name="request_feishu_links")
    op.drop_table("request_feishu_links")
    op.drop_table("request_import_meta")
    op.drop_index("idx_request_list_request", table_name="request_list_items")
    op.drop_table("request_list_items")
    op.drop_index("idx_request_intent_request", table_name="request_intent_items")
    op.drop_table("request_intent_items")
    op.drop_index("idx_request_products_request", table_name="request_products")
    op.drop_table("request_products")
    for name in [
        "expected_start",
        "expected_start_date",
        "competitors",
        "industry",
        "city",
        "project_stage",
        "feishu_code",
        "customer_no",
        "budget_range",
        "website",
        "period",
        "budget",
        "contact_title",
        "contact_phone",
        "contact_name",
        "strength_other",
        "strength_ecosystem",
        "strength_brand",
        "strength_tech",
        "strength_market",
        "optimize_period_custom",
        "optimize_period",
        "intent_rough",
        "intent_type",
        "optimize_background",
        "overseas_site_url",
        "has_overseas_site",
        "scope_type",
    ]:
        op.drop_column("requests", name)


def _camel(name: str) -> str:
    """列名 → data 驼峰 key。"""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
