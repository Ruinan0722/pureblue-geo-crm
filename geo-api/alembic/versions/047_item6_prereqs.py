"""第 6 项前置：补 dev 035 子表回填、剩余标量列、coverage import_meta、mentions 转 TEXT。

- dev 库 034/037/038/039/043 标量列与 035 子表在数据导入前回填导致为空：幂等重跑。
- 新增 leads 转客户列、opportunities/customers/contracts created_day 与合同剩余签约列。
- 新增 crm_coverage_import_meta（base_customer 运行时写入）。
- crm_follow_ups / lead_notes / opportunity_notes 的 mentions 由 JSON 转 TEXT（保留 JSON 文本）。

Revision ID: 047_item6_prereqs
Revises: 046_checkin_attachment_columns
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "047_item6_prereqs"
down_revision: Union[str, None] = "046_checkin_attachment_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str, column: str = "document") -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 1024), 'null'), 'undefined')"


def _jtext(path: str, column: str = "document") -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '{path}')), '')"
    return f"NULLIF(NULLIF({inner}, 'null'), 'undefined')"


def _jdate(path: str, column: str = "document") -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '{path}')), '')"
    return (
        f"CASE WHEN {inner} REGEXP '^[0-9]{{4}}[-/][0-9]{{1,2}}[-/][0-9]{{1,2}}' "
        f"THEN CAST(LEFT({inner}, 10) AS DATE) ELSE NULL END"
    )


def _camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _jbool(path: str, column: str = "document") -> str:
    return (
        f"CASE WHEN {_jstr(path, column)} IN ('true', '1', 'True') THEN 1 "
        "WHEN {inner} IS NULL THEN NULL ELSE 0 END".format(
            inner=f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '{path}')), '')"
        )
    )


def upgrade() -> None:
    bind = op.get_bind()

    # ============ 1) 新增列 ============
    op.add_column("crm_leads", sa.Column("converted_customer_id", sa.String(36), nullable=True))
    op.add_column("crm_leads", sa.Column("converted_coverage_id", sa.String(36), nullable=True))
    op.add_column("crm_leads", sa.Column("source_customer_id", sa.String(36), nullable=True))
    op.alter_column(
        "crm_leads",
        "website",
        existing_type=sa.String(255),
        type_=sa.String(1024),
        existing_nullable=True,
    )

    op.add_column("crm_opportunities", sa.Column("created_day", sa.Date(), nullable=True))

    op.add_column("crm_customers", sa.Column("source_lead_id", sa.String(36), nullable=True))
    op.add_column("crm_customers", sa.Column("sdr", sa.String(128), nullable=True))
    op.add_column("crm_customers", sa.Column("isolation_version", sa.Integer(), nullable=True))
    op.add_column("crm_customers", sa.Column("created_day", sa.Date(), nullable=True))

    contract_columns = [
        ("signer", sa.String(128)),
        ("sign_subject", sa.String(255)),
        ("our_sign_subject", sa.String(255)),
        ("customer_sign_subject", sa.String(255)),
        ("signer_manager", sa.String(128)),
        ("dept", sa.String(128)),
        ("valid_months", sa.Integer()),
        ("effective_date", sa.Date()),
        ("dual_sign_date", sa.Date()),
        ("end_date", sa.Date()),
        ("opportunity_id", sa.String(36)),
        ("owner", sa.String(128)),
        ("created_day", sa.Date()),
    ]
    for name, col_type in contract_columns:
        op.add_column("crm_contracts", sa.Column(name, col_type, nullable=True))

    op.create_table(
        "crm_coverage_import_meta",
        sa.Column("coverage_id", sa.String(36), primary_key=True),
        sa.Column("source", sa.String(64), nullable=True),
        sa.Column("backfill", sa.Boolean(), nullable=True),
        sa.Column("from_owner_user_id", sa.String(36), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=False), nullable=True),
        mysql_charset="utf8mb4",
    )

    # mentions JSON → TEXT（保留 JSON 文本，避免 SQL JSON 依赖）
    op.alter_column("crm_follow_ups", "mentions", existing_type=sa.JSON(), type_=sa.Text(), existing_nullable=True)
    op.alter_column("lead_notes", "mentions", existing_type=sa.JSON(), type_=sa.Text(), existing_nullable=True)
    op.alter_column("opportunity_notes", "mentions", existing_type=sa.JSON(), type_=sa.Text(), existing_nullable=True)

    # ============ 2) 新列回填 ============
    bind.execute(
        sa.text(
            "UPDATE crm_leads SET "
            f"converted_customer_id = {_jstr('$.convertedCustomerId')}, "
            f"converted_coverage_id = {_jstr('$.convertedCoverageId')}, "
            f"source_customer_id = {_jstr('$.sourceCustomerId')}"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE crm_opportunities SET created_day = " + _jdate("$.createdAt")
        )
    )
    bind.execute(
        sa.text(
            "UPDATE crm_customers SET "
            f"source_lead_id = {_jstr('$.sourceLeadId')}, "
            f"sdr = {_jstr('$.sdr')}, "
            f"isolation_version = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.isolationVersion')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.isolationVersion')), '') AS UNSIGNED) END, "
            "created_day = " + _jdate("$.createdAt")
        )
    )
    contract_assigns = ",\n".join(
        f"{name} = {_jstr('$.' + _camel(name))}" for name, _ in contract_columns
        if name not in ("valid_months", "effective_date", "dual_sign_date", "end_date", "created_day")
    )
    bind.execute(
        sa.text(
            "UPDATE crm_contracts SET "
            f"{contract_assigns}, "
            "amount = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.amount')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.amount')), '') AS DECIMAL(18,2)) END, "
            "valid_months = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.validMonths')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.validMonths')), '') AS UNSIGNED) END, "
            "effective_date = " + _jdate("$.effectiveDate") + ", "
            "dual_sign_date = " + _jdate("$.dualSignDate") + ", "
            "end_date = " + _jdate("$.endDate") + ", "
            "created_day = " + _jdate("$.createdAt")
        )
    )
    # coverage import_meta 回填
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_coverage_import_meta "
            "(coverage_id, source, backfill, from_owner_user_id, imported_at) "
            "SELECT id, "
            f"{_jstr('$.source', 'document')}, "
            f"CASE WHEN {_jstr('$.backfill', 'document')} IN ('true', '1', 'True') THEN 1 ELSE NULL END, "
            f"{_jstr('$.fromOwnerUserId', 'document')}, "
            "CAST(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.importedAt')), ''), 19) AS DATETIME) "
            "FROM crm_sales_coverages "
            "WHERE JSON_TYPE(JSON_EXTRACT(document, '$.importMeta')) = 'OBJECT' "
            "AND JSON_LENGTH(document, '$.importMeta') > 0"
        )
    )

    # ============ 3) dev 库标量列幂等重背fill（数据后导入场景） ============
    bind.execute(
        sa.text(
            "UPDATE crm_leads SET "
            f"follow_state = {_jstr('$.followState')}, "
            f"brand_name = {_jstr('$.brandName')}, "
            f"sdr = {_jstr('$.sdr')}, "
            f"sales = {_jstr('$.sales')}, "
            f"transfer_date = {_jdate('$.transferDate')}, "
            f"created_day = {_jdate('$.createdAt')}, "
            f"contact_title = {_jstr('$.contactTitle')}, "
            f"contact_department = {_jstr('$.contactDepartment')}, "
            f"contact_phone = {_jstr('$.contactPhone')}, "
            f"contact_wechat = {_jstr('$.contactWechat')}, "
            f"email = {_jstr('$.email')}, "
            f"website = {_jstr('$.website')}, "
            f"city = {_jstr('$.city')}, "
            f"invalid_reason = {_jstr('$.invalidReason')}, "
            "wechat_added = CASE "
            "WHEN JSON_EXTRACT(document, '$.wechatAdded') IS NULL THEN NULL "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(document, '$.wechatAdded')) IN ('true', '1', 'True') THEN 1 "
            "ELSE 0 END"
        )
    )
    opportunity_cols = ["name", "brand_name", "region", "geo_source", "goal", "platform", "period",
                        "owner", "advisor", "customer_success", "subsidiary_id", "subsidiary_name",
                        "primary_contact_id", "lost_stage", "lost_reason_l1", "lost_reason_l2", "competitor"]
    opp_assigns = ",\n".join(
        f"{c} = {_jstr('$.' + _camel(c))}" for c in opportunity_cols
    )
    bind.execute(
        sa.text(
            "UPDATE crm_opportunities SET "
            f"{opp_assigns}, "
            "probability = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.probability')), '') IS NULL THEN NULL "
            "ELSE CAST(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.probability')), '') AS DECIMAL(8,1)) AS UNSIGNED) END"
        )
    )
    contract_scalar = ["code", "name", "company", "region", "city", "geo_source",
                       "project_status", "type", "sign_type", "source", "status_reason"]
    c_assigns = ",\n".join(
        f"{c} = {_jstr('$.' + _camel(c))}" for c in contract_scalar
    )
    bind.execute(sa.text(f"UPDATE crm_contracts SET {c_assigns}"))
    customer_cols = ["company_uid", "website", "city", "industry_l2", "scale", "nature", "sdr_user_id",
                     "source", "source_detail", "migration_status"]
    cu_assigns = ",\n".join(
        f"{c} = {_jstr('$.' + _camel(c))}" for c in customer_cols
    )
    bind.execute(
        sa.text(
            "UPDATE crm_customers SET "
            f"{cu_assigns}, "
            "founded_date = " + _jdate("$.foundedDate") + ", "
            "sdr_transfer_date = " + _jdate("$.sdrTransferDate") + ", "
            "registered_capital = CASE "
            "WHEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.registeredCapital')), '') IS NULL THEN NULL "
            "ELSE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '$.registeredCapital')), '') AS DECIMAL(18,2)) END"
        )
    )

    # ============ 4) 035 子表幂等补回填（dev 数据后导入场景） ============
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO opportunity_stage_history "
            "(id, opportunity_id, stage, entered_at, left_at, reason, change_type, sort_order) "
            "SELECT CONCAT(o.id, '-sh-', jt.ordinality - 1), o.id, "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.stage')), ''), "
            "COALESCE(STR_TO_DATE(REPLACE(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.enteredAt')), ''), 19), 'T', ' '), '%Y-%m-%d %H:%i:%s'), NOW()), "
            "CAST(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.leftAt')), ''), 19) AS DATETIME), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.reason')), ''), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.changeType')), ''), jt.ordinality - 1 "
            "FROM crm_opportunities o, "
            "JSON_TABLE(o.document, '$.stageHistory[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.stage')), '') IS NOT NULL"
        )
    )
    for entity in ("lead", "coverage", "opportunity", "contract"):
        table = {"lead": "crm_leads", "coverage": "crm_sales_coverages",
                 "opportunity": "crm_opportunities", "contract": "crm_contracts"}[entity]
        bind.execute(
            sa.text(
                f"INSERT IGNORE INTO crm_attachments "
                f"(id, entity_type, entity_id, name, size, kind, url, storage_path, content_type, "
                f"description, checksum, uploaded_by, uploaded_at, created_at) "
                f"SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), '{entity}', c.id, "
                f"COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
                f"COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), "
                f"{_jstr('$.kind', 'jt.value')}, {_jstr('$.url', 'jt.value')}, {_jstr('$.storagePath', 'jt.value')}, "
                f"{_jstr('$.contentType', 'jt.value')}, {_jstr('$.description', 'jt.value')}, "
                f"{_jstr('$.checksum', 'jt.value')}, {_jstr('$.uploadedBy', 'jt.value')}, "
                f"CAST(LEFT({_jstr('$.uploadedAt', 'jt.value')}, 19) AS DATETIME), NOW() "
                f"FROM {table} c, "
                f"JSON_TABLE(c.document, '$.attachments[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
                f"WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL"
            )
        )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO crm_audit_change_items "
            "(id, audit_id, field, before_value, after_value, sort_order) "
            "SELECT CONCAT(a.id, '-ch-', jt.ordinality - 1), a.id, "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.field')), ''), "
            "JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.before')), "
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
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.author')), ''), ''), "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), ''), ''), "
            "COALESCE(STR_TO_DATE(REPLACE(LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.createdAt')), ''), 19), 'T', ' '), '%Y-%m-%d %H:%i:%s'), NOW()), "
            "jt.ordinality - 1 "
            "FROM requests r, "
            "JSON_TABLE(r.notes, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.content')), '') IS NOT NULL"
        )
    )
    bind.execute(
        sa.text(
            "INSERT IGNORE INTO checkin_attachments "
            "(id, checkin_id, name, url, storage_path, content_type, size, created_at) "
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')), c.id, "
            "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.name')), ''), ''), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.url')), ''), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.storagePath')), ''), "
            "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.contentType')), ''), "
            "COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.size')), '') AS UNSIGNED), 0), c.created_at "
            "FROM checkin_records c, "
            "JSON_TABLE(c.attachments, '$[*]' COLUMNS (ordinality FOR ORDINALITY, value JSON PATH '$')) jt "
            "WHERE JSON_UNQUOTE(JSON_EXTRACT(jt.value, '$.id')) IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_table("crm_coverage_import_meta")
    op.alter_column("opportunity_notes", "mentions", existing_type=sa.Text(), type_=sa.JSON(), existing_nullable=True)
    op.alter_column("lead_notes", "mentions", existing_type=sa.Text(), type_=sa.JSON(), existing_nullable=True)
    op.alter_column("crm_follow_ups", "mentions", existing_type=sa.Text(), type_=sa.JSON(), existing_nullable=True)
    for name in [
        "created_day",
        "owner",
        "opportunity_id",
        "end_date",
        "dual_sign_date",
        "effective_date",
        "valid_months",
        "dept",
        "signer_manager",
        "customer_sign_subject",
        "our_sign_subject",
        "sign_subject",
        "signer",
        "amount",
    ]:
        op.drop_column("crm_contracts", name)
    op.drop_column("crm_customers", "created_day")
    op.drop_column("crm_customers", "isolation_version")
    op.drop_column("crm_customers", "sdr")
    op.drop_column("crm_customers", "source_lead_id")
    op.drop_column("crm_opportunities", "created_day")
    op.drop_column("crm_leads", "source_customer_id")
    op.drop_column("crm_leads", "converted_coverage_id")
    op.drop_column("crm_leads", "converted_customer_id")
