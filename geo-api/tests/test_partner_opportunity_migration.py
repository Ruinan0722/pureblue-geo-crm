"""Run the actual Alembic migration against the previous SQL table shape."""
import importlib.util
from datetime import datetime
from pathlib import Path
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, MetaData, Table, select
from app.models.base import Base
import app.models

def test_migration_preserves_ids_stage_and_contract_references():
    path=Path(__file__).parents[1]/'alembic/versions/075_unified_partner_opportunities.py'
    spec=importlib.util.spec_from_file_location('partner_migration',path)
    migration=importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    omitted={
        'channel_partners': {name for name,_ in migration.PARTNER_COLUMNS},
        'channel_follow_ups': {'follow_type','contact_name','mentions_json'},
        'crm_opportunities': {'business_type','partner_id','partner_name'},
    }
    old=MetaData()
    for name in ('channel_partners','channel_follow_ups','channel_opportunities','crm_opportunities','opportunity_stage_history','channel_contracts'):
        Table(name,old,*(column._copy() for column in Base.metadata.tables[name].columns if column.name not in omitted.get(name,set())))
    engine=create_engine('sqlite:///:memory:')
    now=datetime(2026,10,19,10)
    with engine.begin() as conn:
        old.create_all(conn)
        for kind,stage in [('channel','签署中'),('strategic_ecosystem','赢单')]:
            conn.execute(old.tables['channel_partners'].insert().values(id=kind,name=kind,partner_type=kind,brand_name='品牌',owner_user_id='owner',owner_name='负责人',created_by_user_id='owner',created_by_name='负责人',created_at=now,updated_at=now))
            conn.execute(old.tables['channel_opportunities'].insert().values(id='opp-'+kind,partner_id=kind,name='商机',stage=stage,owner_user_id='owner',owner_name='负责人',created_at=now,updated_at=now))
        conn.execute(old.tables['channel_contracts'].insert().values(id='contract',partner_id='channel',opportunity_id='opp-channel',name='协议',status='准备签约',created_at=now,updated_at=now))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
        current=MetaData(); current.reflect(conn)
        rows={row['id']:row for row in conn.execute(select(current.tables['crm_opportunities'])).mappings()}
        assert set(rows)=={'opp-channel','opp-strategic_ecosystem'}
        assert rows['opp-channel']['stage']=='signing'
        assert rows['opp-strategic_ecosystem']['business_type']=='strategic_ecosystem'
        assert rows['opp-strategic_ecosystem']['stage']=='won'
        assert conn.execute(select(current.tables['channel_contracts'].c.opportunity_id)).scalar()=='opp-channel'
        assert len(conn.execute(select(current.tables['channel_opportunities'])).all())==2
        assert len(conn.execute(select(current.tables['opportunity_stage_history'])).all())==2
    engine.dispose()
