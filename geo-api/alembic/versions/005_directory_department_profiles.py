from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "005_dir_profiles"
down_revision = "004_feishu_contact_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 手动目录信息：用于构造部门树并给每个用户指定「主部门 / 备注 / 负责人」
    op.add_column(
        "users",
        sa.Column("manual_department_open_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("manual_department_name", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("manual_department_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "manual_department_leader",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "manual_department_leader")
    op.drop_column("users", "manual_department_note")
    op.drop_column("users", "manual_department_name")
    op.drop_column("users", "manual_department_open_id")

