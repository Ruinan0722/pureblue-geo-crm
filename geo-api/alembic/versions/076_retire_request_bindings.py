"""Archive and retire demand/opportunity associations, preserving effective GEO."""
from uuid import uuid4
from datetime import datetime
from alembic import op
import sqlalchemy as sa
from app.core.geo_scope import opportunity_geo_from_request_map, resolve_request_geo_source

revision='076_retire_request_bindings'
down_revision='075_unified_opportunities'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('retired_request_opportunity_links',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('source_side',sa.String(32),nullable=False),
        sa.Column('original_link_id',sa.String(64),nullable=True),
        sa.Column('request_id',sa.String(36),nullable=False),
        sa.Column('opportunity_id',sa.String(36),nullable=False),
        sa.Column('archived_at',sa.DateTime(),nullable=False))
    bind=op.get_bind();meta=sa.MetaData()
    tables={name:sa.Table(name,meta,autoload_with=bind) for name in ('requests','request_import_meta','crm_opportunities','opportunity_request_ids','retired_request_opportunity_links')}
    requests=list(bind.execute(sa.select(tables['requests'])).mappings())
    links=list(bind.execute(sa.select(tables['opportunity_request_ids'])).mappings())
    sources={row['request_id']:row['source'] for row in bind.execute(sa.select(tables['request_import_meta'])).mappings()}
    request_geo={row['id']:resolve_request_geo_source(code=row['code'],data={'importMeta':{'source':sources.get(row['id'])}}) for row in requests}
    by_opp={}
    now=datetime.now()
    for row in links:
        by_opp.setdefault(row['opportunity_id'],[]).append(row['request_id'])
        bind.execute(tables['retired_request_opportunity_links'].insert().values(id=str(uuid4()),source_side='opportunity',original_link_id=row['id'],request_id=row['request_id'],opportunity_id=row['opportunity_id'],archived_at=now))
    for row in requests:
        if row['opportunity_id']:
            bind.execute(tables['retired_request_opportunity_links'].insert().values(id=str(uuid4()),source_side='request',request_id=row['id'],opportunity_id=row['opportunity_id'],archived_at=now))
    # Persist exactly the old effective source before dropping the relationship.
    # Stages, owners, requests, notes, files and contract/project links are untouched.
    opps=tables['crm_opportunities']
    for row in bind.execute(sa.select(opps)).mappings():
        geo=opportunity_geo_from_request_map({'requestIds':by_opp.get(row['id'],[]),'geoSource':row['geo_source']},request_geo)
        bind.execute(opps.update().where(opps.c.id==row['id']).values(geo_source=geo))
    bind.execute(tables['requests'].update().values(opportunity_id=None))
    bind.execute(tables['opportunity_request_ids'].delete())

def downgrade():
    # Restoring old links into independently progressed records would change the
    # workflow and its visibility. Keep the archive and require explicit recovery.
    raise RuntimeError('Restore archived associations only with an explicit data recovery plan')
