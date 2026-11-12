"""Add the ecosystem liaison department without rewriting existing data."""
from alembic import op
import sqlalchemy as sa

revision = "077_ecosystem_department"
down_revision = "076_retire_request_bindings"

def upgrade():
    op.add_column("channel_partners", sa.Column("ecosystem_department", sa.String(128), nullable=True))

def downgrade():
    op.drop_column("channel_partners", "ecosystem_department")
