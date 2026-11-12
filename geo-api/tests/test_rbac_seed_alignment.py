"""Assert geo-api hardcoded ROLE_PERMISSIONS stays aligned with seed_rbac.py.

geo-admin 另有 rbac-seed-data.ts，发版改矩阵时须三处一起改；本测试兜住 API 侧两份漂移。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.modules.auth.permissions import (
    PERMISSION_CATALOG,
    ROLE_DATA_SCOPE,
    ROLE_PERMISSIONS,
)
from app.modules.users.role_resolver import _resolve_role_from_departments


def _load_seed_rbac():
    path = Path(__file__).resolve().parents[1] / "scripts" / "seed_rbac.py"
    spec = importlib.util.spec_from_file_location("seed_rbac", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_seed_rbac_matches_permissions_py():
    seed = _load_seed_rbac()
    by_code = {code: set(perms) for (_id, code, _name, _desc, _scope, perms) in seed.ROLES}

    assert set(by_code) == set(ROLE_PERMISSIONS), (
        f"角色集合不一致: seed={sorted(by_code)} permissions={sorted(ROLE_PERMISSIONS)}"
    )

    for code, expected in ROLE_PERMISSIONS.items():
        got = by_code[code]
        assert got == set(expected), (
            f"角色 {code} 权限不一致:\n"
            f"  仅 seed: {sorted(got - set(expected))}\n"
            f"  仅 permissions.py: {sorted(set(expected) - got)}"
        )


def test_seed_rbac_data_scope_matches_permissions_py():
    seed = _load_seed_rbac()
    by_code = {code: scope for (_id, code, _name, _desc, scope, _perms) in seed.ROLES}

    assert set(by_code) == set(ROLE_DATA_SCOPE)
    for code, expected in ROLE_DATA_SCOPE.items():
        assert by_code[code] == expected, f"{code} data_scope: seed={by_code[code]} vs {expected}"


def test_admin_and_super_admin_have_full_permission_catalog():
    """管理员/超级管理员必须拥有权限目录全部权限，目录新增时不得漏配。"""
    seed = _load_seed_rbac()
    catalog = set(seed.PERMISSIONS.keys())
    assert len(catalog) > 20  # 目录完整性自检
    for code in ("admin", "super_admin"):
        perms = set(ROLE_PERMISSIONS[code])
        assert perms == catalog, (
            f"{code} 与权限目录不一致:\n"
            f"  缺失: {sorted(catalog - perms)}\n"
            f"  多余: {sorted(perms - catalog)}"
        )


def test_permission_catalog_matches_seed_catalog():
    """权限目录（管理员回退来源）必须与 seed 目录一致：新增细码时三处同步。"""
    seed = _load_seed_rbac()
    catalog = set(PERMISSION_CATALOG)
    seed_codes = set(seed.PERMISSIONS.keys())
    assert catalog == seed_codes, (
        "权限目录不一致:\n"
        f"  仅 permissions.py: {sorted(catalog - seed_codes)}\n"
        f"  仅 seed: {sorted(seed_codes - catalog)}"
    )


def test_sales_and_admin_have_intake_cn_split():
    """国内填报拆权后，销售/Leader/管理员须同时持有 intake + intake_cn。"""
    for code in ("sales", "leader", "admin", "super_admin"):
        perms = set(ROLE_PERMISSIONS[code])
        assert "section:intake" in perms
        assert "section:intake_cn" in perms
    assert "section:intake_cn" not in set(ROLE_PERMISSIONS["overseas"])
    assert "section:intake" in set(ROLE_PERMISSIONS["overseas"])


def test_sdr_has_dashboard_without_customer_management():
    perms = set(ROLE_PERMISSIONS["sdr"])
    assert "section:leads" in perms
    assert "section:dashboard" in perms
    assert "section:customers" not in perms


def test_overseas_role_isolation_contract():
    """海外运营：全量 data_scope + 无国内填报，隔离靠 forced_geo。"""
    assert ROLE_DATA_SCOPE["overseas"] == "all"
    perms = set(ROLE_PERMISSIONS["overseas"])
    assert "section:requests" in perms
    assert "section:opportunities" in perms
    assert "section:contracts" in perms
    assert "section:projects" in perms
    assert "section:intake" in perms
    assert "section:intake_cn" not in perms
    assert "section:leads" not in perms
    assert "section:customers" not in perms


def test_marketing_role_contract():
    """市场成员只读；市场负责人仅增加线索写权限（细码）。"""
    assert ROLE_DATA_SCOPE["marketing"] == "all"
    assert set(ROLE_PERMISSIONS["marketing"]) == {
        "section:notifications",
        "section:home",
        "section:leads",
        "section:customers",
        "section:dashboard",
    }


def test_presales_role_contract():
    """售前顾问：全量商机只读 + 顾问反馈 + 数据看板；无需求模块。"""
    assert ROLE_DATA_SCOPE["presales"] == "all"
    perms = set(ROLE_PERMISSIONS["presales"])
    assert "section:opportunities" in perms
    assert "opportunities:advisor" in perms
    assert "section:dashboard" in perms
    assert "section:requests" not in perms
    assert "request:view" not in perms
    assert "section:leads" not in perms
    assert "section:customers" not in perms
    assert "section:contracts" not in perms
    assert "section:projects" not in perms

    leader = set(ROLE_PERMISSIONS["marketing_leader"])
    assert ROLE_DATA_SCOPE["marketing_leader"] == "all"
    assert {"leads:create", "leads:edit", "leads:convert", "leads:invalid"} <= leader
    assert "leads:write" not in leader
    assert "section:notifications" in leader
    assert "request:view" in leader
    assert "customers:write" not in leader
    assert "opportunities:write" not in leader
    assert "contracts:write" not in leader
    assert "projects:write" not in leader
    assert "lead_source_options:manage" not in leader


def test_lead_source_option_management_is_admin_or_user_override_only():
    assert "lead_source_options:manage" in set(ROLE_PERMISSIONS["admin"])
    assert "lead_source_options:manage" in set(ROLE_PERMISSIONS["super_admin"])
    assert "lead_source_options:manage" not in set(ROLE_PERMISSIONS["marketing"])
    assert "leads:write" not in set(ROLE_PERMISSIONS["marketing"])


def test_public_pool_role_contract():
    sales = set(ROLE_PERMISSIONS["sales"])
    leader = set(ROLE_PERMISSIONS["leader"])
    ops = set(ROLE_PERMISSIONS["ops"])
    for perms in (sales, leader):
        assert {"section:public_pool", "public_pool:claim", "public_pool:release"} <= perms
        assert "public_pool:review" not in perms
    assert {"section:public_pool", "public_pool:review"} <= ops
    assert "public_pool:claim" not in ops
    assert "public_pool:release" not in ops
    for role in ("admin", "super_admin"):
        assert {
            "section:public_pool",
            "public_pool:claim",
            "public_pool:review",
            "public_pool:release",
        } <= set(ROLE_PERMISSIONS[role])


def test_marketing_department_rule_only_matches_leaf_department():
    rules = [("市场", "marketing")]
    assert _resolve_role_from_departments(["市场"], rules) == "marketing"
    assert _resolve_role_from_departments(["PureblueAI > 市场及营销方案中心 > 市场"], rules) == "marketing"
    assert _resolve_role_from_departments(["市场及营销方案中心"], rules) is None


def test_department_rules_include_solution_and_business_ops():
    """解决方案部 → presales、业务运营部 → ops 必须存在于种子目录，避免销售树回退误配。"""
    seed = _load_seed_rbac()
    by_name = {name: code for name, code, _order in seed.DEPARTMENT_RULES}
    assert by_name["解决方案部"] == "presales"
    assert by_name["业务运营部"] == "ops"


def test_resolver_maps_solution_and_business_ops_departments():
    seed = _load_seed_rbac()
    rules = [(name, code) for name, code, _order in seed.DEPARTMENT_RULES]
    # 完整部门路径（含子树）也应按子串命中
    assert _resolve_role_from_departments(["销售管理中心 > 解决方案部"], rules) == "presales"
    assert _resolve_role_from_departments(["销售管理中心 > 解决方案部 > 华北"], rules) == "presales"
    assert _resolve_role_from_departments(["销售管理中心 > 业务运营部"], rules) == "ops"
