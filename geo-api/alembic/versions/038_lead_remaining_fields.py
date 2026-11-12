"""线索剩余单值字段列化（回填与索引）。

Revision ID: 038_lead_remaining
Revises: 037_opportunity_remaining
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "038_lead_remaining"
down_revision: Union[str, None] = "037_opportunity_remaining"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jstr(path: str) -> str:
    inner = f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT(document, '{path}')), '')"
    return f"NULLIF(NULLIF(LEFT({inner}, 255), 'null'), 'undefined')"


def upgrade() -> None:
    bind = op.get_bind()
    columns = [
        ("contact_title", sa.String(128)),
        ("contact_department", sa.String(128)),
        ("contact_phone", sa.String(64)),
        ("contact_wechat", sa.String(128)),
        ("email", sa.String(255)),
        ("website", sa.String(255)),
        ("city", sa.String(128)),
        ("invalid_reason", sa.String(255)),
        ("wechat_added", sa.Boolean()),
    ]
    for name, col_type in columns:
        op.add_column("crm_leads", sa.Column(name, col_type, nullable=True))
    camel = {
        "contact_title": "contactTitle",
        "contact_department": "contactDepartment",
        "contact_phone": "contactPhone",
        "contact_wechat": "contactWechat",
        "email": "email",
        "website": "website",
        "city": "city",
        "invalid_reason": "invalidReason",
    }
    assigns = ",\n".join(
        f"{name} = {_jstr('$.' + camel[name])}" for name, _ in columns if name != "wechat_added"
    )
    bind.execute(
        sa.text(
            "UPDATE crm_leads SET "
            f"{assigns}, "
            "wechat_added = CASE "
            "WHEN JSON_EXTRACT(document, '$.wechatAdded') IS NULL "
            "OR JSON_UNQUOTE(JSON_EXTRACT(document, '$.wechatAdded')) IN ('null', '') THEN NULL "
            "WHEN JSON_UNQUOTE(JSON_EXTRACT(document, '$.wechatAdded')) IN ('true', '1', 'True') THEN 1 "
            "ELSE 0 END"
        )
    )
    op.create_index("idx_crm_leads_city", "crm_leads", ["city"])
    op.create_index("idx_crm_leads_email", "crm_leads", ["email"])


def downgrade() -> None:
    op.drop_index("idx_crm_leads_email", table_name="crm_leads")
    op.drop_index("idx_crm_leads_city", table_name="crm_leads")
    for name in [
        "wechat_added",
        "invalid_reason",
        "city",
        "website",
        "email",
        "contact_wechat",
        "contact_phone",
        "contact_department",
        "contact_title",
    ]:
        op.drop_column("crm_leads", name)
