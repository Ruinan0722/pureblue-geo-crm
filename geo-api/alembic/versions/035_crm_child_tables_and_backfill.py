"""CRM JSON 嵌套集合落子表（统一附件/阶段历史/审计变更项/需求子表/打卡附件）。

同时把 033 拆出的 crm_contacts / crm_follow_ups 从 document 补回填（旧数据只写穿未回填）。

Revision ID: 035_crm_child_tables_and_backfill
Revises: 034_crm_json_fields_to_columns
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "035_crm_child_tables"
down_revision: Union[str, None] = "034_crm_json_fields_to_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _str(path: str) -> str:
    return f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '{path}')), '')"


def _bool_true(path: str) -> str:
    return f"IF({_str(path)} IN ('true', '1', 'True'), 1, 0)"


def _dt(path: str) -> str:
    return (
        "COALESCE(STR_TO_DATE(REPLACE(LEFT("
        f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '{path}')), ''), 19), 'T', ' '), "
        "'%Y-%m-%d %H:%i:%s'), NOW())"
    )


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "crm_attachments",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(512), nullable=False, server_default=""),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(32), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("content_type", sa.String(128), nullable=True),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("checksum", sa.String(128), nullable=True),
        sa.Column("uploaded_by", sa.String(128), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_type", "entity_id", "id", name="uq_crm_attachment_entity_item"),
    )
    op.create_index("idx_crm_attachments_entity", "crm_attachments", ["entity_type", "entity_id"])

    op.create_table(
        "opportunity_stage_history",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("opportunity_id", sa.String(36), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False),
        sa.Column("entered_at", sa.DateTime(), nullable=False),
        sa.Column("left_at", sa.DateTime(), nullable=True),
        sa.Column("reason", sa.String(512), nullable=True),
        sa.Column("change_type", sa.String(16), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("opportunity_id", "sort_order", name="uq_opp_stage_history_order"),
    )
    op.create_index(
        "idx_opp_stage_history_opp",
        "opportunity_stage_history",
        ["opportunity_id", "entered_at"],
    )

    op.create_table(
        "crm_audit_change_items",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("audit_id", sa.String(64), nullable=False),
        sa.Column("field", sa.String(128), nullable=False, server_default=""),
        sa.Column("before_value", sa.Text(), nullable=True),
        sa.Column("after_value", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("idx_audit_change_audit", "crm_audit_change_items", ["audit_id"])

    op.create_table(
        "request_notes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("author", sa.String(128), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("request_id", "sort_order", name="uq_request_notes_order"),
    )
    op.create_index("idx_request_notes_request", "request_notes", ["request_id", "created_at"])

    op.create_table(
        "request_regions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("country", sa.String(16), nullable=False),
        sa.Column("language", sa.String(32), nullable=True),
        sa.UniqueConstraint("request_id", "country", name="uq_request_regions_country"),
    )
    op.create_index("idx_request_regions_request", "request_regions", ["request_id"])

    op.create_table(
        "request_goals",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("goal", sa.String(64), nullable=False),
        sa.UniqueConstraint("request_id", "goal", name="uq_request_goals_goal"),
    )
    op.create_index("idx_request_goals_request", "request_goals", ["request_id"])

    op.create_table(
        "checkin_attachments",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("checkin_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(512), nullable=False, server_default=""),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("content_type", sa.String(128), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("checkin_id", "id", name="uq_checkin_attachment_item"),
    )
    op.create_index("idx_checkin_attachments_checkin", "checkin_attachments", ["checkin_id"])

    # —— 回填 crm_contacts / crm_follow_ups（033 只写穿未回填旧数据） ——
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_contacts "
            "(id, coverage_id, customer_id, name, title, phone, wechat, email, status, "
            "is_primary, active, wechat_added, source, source_detail, source_lead_id, created_at, updated_at) "
            "SELECT CONCAT(c.id, '-ct-', jt.ordinality - 1), c.id, c.customer_id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            f"{_str('$.title')}, {_str('$.phone')}, {_str('$.wechat')}, {_str('$.email')}, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.status')), ''), 'awaiting_contact'), "
            f"{_bool_true('$.isPrimary')}, IF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.active')) = 'false', 0, 1), "
            f"{_bool_true('$.wechatAdded')}, {_str('$.source')}, {_str('$.sourceDetail')}, {_str('$.sourceLeadId')}, "
            "NOW(), NOW() "
            "FROM crm_sales_coverages c, "
            "JSON_TABLE(c.document, '$.contacts[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_follow_ups "
            "(id, coverage_id, customer_id, author, content, follow_type, wechat_added, mentions, "
            "next_follow_at, created_at, updated_at) "
            "SELECT CONCAT(c.id, '-fu-', jt.ordinality - 1), c.id, c.customer_id, "
            f"COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.author')), ''), ''), "
            f"COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), ''), ''), "
            f"{_str('$.followType')}, {_bool_true('$.wechatAdded')}, "
            "JSON_EXTRACT(jt.value, '$.mentions'), "
            f"CAST(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.nextFollowAt')), ''), 10) AS DATE), "
            f"COALESCE(CAST(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.date')), ''), 10) AS DATE), NOW()), NOW() "
            "FROM crm_sales_coverages c, "
            "JSON_TABLE(c.document, '$.notes[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), '') IS NOT NULL"
        )
    )

    # —— 回填统一附件表 ——
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_attachments "
            "(id, entity_type, entity_id, name, size, kind, url, storage_path, content_type, "
            "description, checksum, uploaded_by, uploaded_at, created_at) "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), 'lead', c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
            f"{_str('$.kind')}, {_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            f"{_str('$.description')}, {_str('$.checksum')}, {_str('$.uploadedBy')}, "
            f"CAST(LEFT({_str('$.uploadedAt')}, 19) AS DATETIME), NOW() "
            "FROM crm_leads c, "
            "JSON_TABLE(c.document, '$.attachments[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL "
            "UNION ALL "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), 'coverage', c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
            f"{_str('$.kind')}, {_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            f"{_str('$.description')}, {_str('$.checksum')}, {_str('$.uploadedBy')}, "
            f"CAST(LEFT({_str('$.uploadedAt')}, 19) AS DATETIME), NOW() "
            "FROM crm_sales_coverages c, "
            "JSON_TABLE(c.document, '$.attachments[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL "
            "UNION ALL "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), 'opportunity', c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
            f"{_str('$.kind')}, {_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            f"{_str('$.description')}, {_str('$.checksum')}, {_str('$.uploadedBy')}, "
            f"CAST(LEFT({_str('$.uploadedAt')}, 19) AS DATETIME), NOW() "
            "FROM crm_opportunities c, "
            "JSON_TABLE(c.document, '$.attachments[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL "
            "UNION ALL "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), 'contract', c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
            f"{_str('$.kind')}, {_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            f"{_str('$.description')}, {_str('$.checksum')}, {_str('$.uploadedBy')}, "
            f"CAST(LEFT({_str('$.uploadedAt')}, 19) AS DATETIME), NOW() "
            "FROM crm_contracts c, "
            "JSON_TABLE(c.document, '$.attachments[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL "
            "UNION ALL "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), 'request', r.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
            f"{_str('$.kind')}, {_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            f"{_str('$.description')}, {_str('$.checksum')}, {_str('$.uploadedBy')}, "
            f"CAST(LEFT({_str('$.uploadedAt')}, 19) AS DATETIME), NOW() "
            "FROM requests r, "
            "JSON_TABLE(r.attachments, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL"
        )
    )

    # —— 回填阶段历史 / 审计变更项 / 需求子表 / 打卡附件 ——
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO opportunity_stage_history "
            "(id, opportunity_id, stage, entered_at, left_at, reason, change_type, sort_order) "
            "SELECT CONCAT(o.id, '-sh-', jt.ordinality - 1), o.id, "
            f"{_str('$.stage')}, {_dt('$.enteredAt')}, "
            f"CAST(LEFT({_str('$.leftAt')}, 19) AS DATETIME), {_str('$.reason')}, {_str('$.changeType')}, "
            "jt.ordinality - 1 "
            "FROM crm_opportunities o, "
            "JSON_TABLE(o.document, '$.stageHistory[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.stage')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_audit_change_items "
            "(id, audit_id, field, before_value, after_value, sort_order) "
            "SELECT CONCAT(a.id, '-ch-', jt.ordinality - 1), a.id, "
            f"{_str('$.field')}, JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.before')), "
            "JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.after')), jt.ordinality - 1 "
            "FROM crm_audit_records a, "
            "JSON_TABLE(a.changes, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.field')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO request_notes (id, request_id, author, content, created_at, sort_order) "
            "SELECT CONCAT(r.id, '-rn-', jt.ordinality - 1), r.id, "
            f"COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.author')), ''), ''), "
            f"COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), ''), ''), "
            f"{_dt('$.createdAt')}, jt.ordinality - 1 "
            "FROM requests r, "
            "JSON_TABLE(r.notes, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO request_regions (id, request_id, country, language) "
            "SELECT CONCAT(r.id, '-rg-', jt.ordinality - 1), r.id, "
            f"{_str('$.country')}, {_str('$.language')} "
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
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO checkin_attachments "
            "(id, checkin_id, name, url, storage_path, content_type, size, created_at) "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            f"{_str('$.url')}, {_str('$.storagePath')}, {_str('$.contentType')}, "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), c.created_at "
            "FROM checkin_records c, "
            "JSON_TABLE(c.attachments, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_table("checkin_attachments")
    op.drop_table("request_goals")
    op.drop_table("request_regions")
    op.drop_table("request_notes")
    op.drop_table("crm_audit_change_items")
    op.drop_table("opportunity_stage_history")
    op.drop_table("crm_attachments")
