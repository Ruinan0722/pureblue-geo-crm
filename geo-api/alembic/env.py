from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.models.base import Base
from app.models import (  # noqa: F401
    CheckinRecord,
    ChannelContact,
    ChannelContract,
    ChannelFollowUp,
    ChannelHistory,
    ChannelOpportunity,
    ChannelPartner,
    CrmContract,
    CrmCustomer,
    CrmLead,
    LeadSourceOption,
    CrmOpportunity,
    FeishuSalesContact,
    FeishuSyncLog,
    Invite,
    ReleaseNote,
    Request,
    User,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _sync_database_url() -> str:
    url = get_settings().database_url
    return url.replace("mysql+asyncmy://", "mysql+pymysql://")


def run_migrations_offline() -> None:
    url = _sync_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = _sync_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
