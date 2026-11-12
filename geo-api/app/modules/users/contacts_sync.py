"""销售部通讯录辅助函数；定时同步已合并至 feishu_org_sync。"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.feishu.department_labels import resolve_department_display_path
from app.modules.users.role_resolver import get_sales_department_names


async def _resolve_department_names(db: AsyncSession, department_ids: Iterable[str]) -> list[str]:
    ids = [d for d in department_ids if d and d != "0"]
    if not ids:
        return list(await get_sales_department_names(db))
    # 实时优先：拉取部门记录（含父链）后用飞书 API 名称拼路径，配置仅作兜底
    from app.core.feishu.contact import _build_department_breadcrumb, _load_department_records

    cache = await _load_department_records(ids)
    names: list[str] = []
    for dept_id in ids:
        path = _build_department_breadcrumb(str(dept_id), cache) or resolve_department_display_path(
            str(dept_id)
        )
        if path and path not in names:
            names.append(path)
    return names or list(await get_sales_department_names(db))
