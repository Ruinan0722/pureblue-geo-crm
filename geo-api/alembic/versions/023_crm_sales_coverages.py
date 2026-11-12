"""crm_sales_coverages: per-sales coverage pools on company customers

Revision ID: 023_crm_sales_coverages
Revises: 022_project_geo_source
Create Date: 2026-08-03
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "023_crm_sales_coverages"
down_revision: Union[str, None] = "022_project_geo_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return name in sa.inspect(bind).get_table_names()


def _parse_doc(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return {}
    return raw if isinstance(raw, dict) else {}


def upgrade() -> None:
    # 与 crm_customers / users 对齐：本地/生产多为 utf8mb4_0900_ai_ci。
    # 若仅建表不指定 collation，连接默认可能是 unicode_ci，回填 JOIN 会 1267。
    # （023 未上线过，不存在早期 collation 错误的表；重跑时表已正确，无需 CONVERT 全表重建。）
    if not _has_table("crm_sales_coverages"):
        op.create_table(
            "crm_sales_coverages",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("customer_id", sa.String(length=36), nullable=False, index=True),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False, index=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="awaiting_contact", index=True),
            sa.Column("document", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("customer_id", "owner_user_id", name="uq_crm_sales_coverages_customer_owner"),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_0900_ai_ci",
        )

    # 回填 DML 在 alembic 迁移事务中执行：中途失败整体回滚，重跑与首次结果一致——
    # 避免半失败态（已有 coverage 但主档未打标/未清经营字段）在重跑时被 NOT EXISTS 跳过。
    # 注意：alembic 已开启迁移事务（连接已 autobegin），不可再 bind.begin() 嵌套开启。
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT c.id, c.owner_user_id, c.status, c.document, c.created_at, c.updated_at
              FROM crm_customers c
             WHERE NOT EXISTS (
                   SELECT 1 FROM crm_sales_coverages cv WHERE cv.customer_id = c.id
             )
            """
        )
    ).mappings().all()

    now = datetime.utcnow()
    for row in rows:
        doc = _parse_doc(row["document"])

        owner_id = (row["owner_user_id"] or "").strip() or str(doc.get("createdByUserId") or "").strip()
        if not owner_id:
            # 无法归因：跳过，待人工；主档打标
            conn.execute(
                sa.text(
                    """
                    UPDATE crm_customers
                       SET document = JSON_SET(CAST(document AS JSON), '$.migrationStatus', 'pending')
                     WHERE id = :cid
                    """
                ),
                {"cid": row["id"]},
            )
            continue

        status = str(row["status"] or doc.get("status") or "awaiting_contact")
        cov_id = f"cv-{uuid4().hex[:16]}"
        cov_doc: dict[str, Any] = {
            "id": cov_id,
            "customerId": row["id"],
            "ownerUserId": owner_id,
            "ownerName": str(doc.get("owner") or ""),
            "status": status,
            "clientDept": "",
            "contacts": doc.get("contacts") if isinstance(doc.get("contacts"), list) else [],
            "notes": doc.get("notes") if isinstance(doc.get("notes"), list) else [],
            "attachments": doc.get("attachments") if isinstance(doc.get("attachments"), list) else [],
            "lastFollowAt": str(doc.get("lastFollowAt") or ""),
            "nextFollowAt": str(doc.get("nextFollowAt") or ""),
            "isKey": bool(doc.get("isKey") or False),
            "sourceLeadId": str(doc.get("sourceLeadId") or ""),
            "sdrName": str(doc.get("sdr") or ""),
            "sdrTransferDate": str(doc.get("sdrTransferDate") or ""),
            "isolationVersion": 1,
        }
        created = row["created_at"] or now
        updated = row["updated_at"] or now
        conn.execute(
            sa.text(
                """
                INSERT INTO crm_sales_coverages
                    (id, customer_id, owner_user_id, status, document, created_at, updated_at)
                VALUES
                    (:id, :customer_id, :owner_user_id, :status, CAST(:document AS JSON), :created_at, :updated_at)
                """
            ),
            {
                "id": cov_id,
                "customer_id": row["id"],
                "owner_user_id": owner_id,
                "status": status,
                "document": json.dumps(cov_doc, ensure_ascii=False),
                "created_at": created,
                "updated_at": updated,
            },
        )
        conn.execute(
            sa.text(
                """
                UPDATE crm_customers
                   SET document = JSON_SET(
                        CAST(document AS JSON),
                        '$.migrationStatus', 'legacy_shared',
                        '$.contacts', CAST('[]' AS JSON),
                        '$.notes', CAST('[]' AS JSON),
                        '$.attachments', CAST('[]' AS JSON),
                        '$.isKey', false,
                        '$.lastFollowAt', '',
                        '$.nextFollowAt', ''
                   )
                 WHERE id = :cid
                """
            ),
            {"cid": row["id"]},
        )


def downgrade() -> None:
    """回滚前先把各 coverage 的经营字段合并回主档，再删表——保证降级不丢数据。

    多池并集恢复（池边界信息在回滚后不再保留，可接受）；migrationStatus 移除。
    """
    conn = op.get_bind()
    if not _has_table("crm_sales_coverages"):
        return
    rows = conn.execute(
        sa.text("SELECT customer_id, document FROM crm_sales_coverages")
    ).mappings().all()
    merged: dict[str, dict[str, Any]] = {}
    for r in rows:
        doc = _parse_doc(r["document"])
        fields = merged.setdefault(
            r["customer_id"],
            {
                "contacts": [],
                "notes": [],
                "attachments": [],
                "isKey": False,
                "lastFollowAt": "",
                "nextFollowAt": "",
            },
        )
        for key in ("contacts", "notes", "attachments"):
            items = doc.get(key) if isinstance(doc.get(key), list) else []
            fields[key] = fields[key] + [i for i in items if isinstance(i, dict)]
        if not fields["isKey"] and doc.get("isKey"):
            fields["isKey"] = True
        if not fields["lastFollowAt"] and doc.get("lastFollowAt"):
            fields["lastFollowAt"] = str(doc["lastFollowAt"])
        if not fields["nextFollowAt"] and doc.get("nextFollowAt"):
            fields["nextFollowAt"] = str(doc["nextFollowAt"])
    for cid, fields in merged.items():
        conn.execute(
            sa.text(
                """
                UPDATE crm_customers
                   SET document = JSON_REMOVE(
                        JSON_SET(
                            CAST(document AS JSON),
                            '$.contacts', CAST(:contacts AS JSON),
                            '$.notes', CAST(:notes AS JSON),
                            '$.attachments', CAST(:attachments AS JSON),
                            '$.isKey', :is_key,
                            '$.lastFollowAt', :last_follow_at,
                            '$.nextFollowAt', :next_follow_at
                        ),
                        '$.migrationStatus'
                   )
                 WHERE id = :cid
                """
            ),
            {
                "cid": cid,
                "contacts": json.dumps(fields["contacts"], ensure_ascii=False),
                "notes": json.dumps(fields["notes"], ensure_ascii=False),
                "attachments": json.dumps(fields["attachments"], ensure_ascii=False),
                "is_key": "true" if fields["isKey"] else "false",
                "last_follow_at": fields["lastFollowAt"],
                "next_follow_at": fields["nextFollowAt"],
            },
        )
    # DDL（MySQL 隐式提交）在数据恢复事务之后再执行
    op.drop_table("crm_sales_coverages")
