"""部门短名 / 组织路径解析。"""

from __future__ import annotations

from app.core.feishu.department_labels import (
    get_department_id_breadcrumbs,
    get_department_id_labels,
    resolve_department_breadcrumb,
    resolve_department_display_path,
    resolve_department_name,
    strip_company_root_prefix,
)


def test_resolve_department_breadcrumb_and_short_name():
    get_department_id_labels.cache_clear()
    get_department_id_breadcrumbs.cache_clear()

    assert strip_company_root_prefix("PureblueAI > 销售部 > 北一") == "销售部 > 北一"
    leaf = "od-25fca95d9240344c90975e9a7e6a053b"
    short = resolve_department_name(leaf)
    path = resolve_department_breadcrumb(leaf)
    assert short == "北一"
    assert path is not None
    assert "北一" in path
    assert ("销售" in path) or ("直销" in path)
    assert "PureblueAI" not in path
    assert resolve_department_display_path(leaf) == path
