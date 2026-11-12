"""前端进程禁止直连 MySQL/Redis：鉴权与数据一律经 geo-api。"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN = ("mysql2", "ioredis", "createConnection", "createPool", "new Redis(")


def _scan_frontend(root: Path) -> list[str]:
    offenders: list[str] = []
    for path in root.rglob("*"):
        if any(part in path.parts for part in ("node_modules", ".next", "out", "build")):
            continue
        if path.suffix not in (".ts", ".tsx", ".mjs", ".js"):
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if any(token in line for token in FORBIDDEN):
                offenders.append(f"{path.relative_to(ROOT)}:{i}")
    return offenders


def test_geo_admin_has_no_direct_db_access():
    assert not _scan_frontend(ROOT / "geo-admin/modules"), "geo-admin 源码禁止直连 MySQL/Redis"
    assert not _scan_frontend(ROOT / "geo-admin/app"), "geo-admin API 路由禁止直连 MySQL/Redis"


def test_geo_intake_has_no_direct_db_access():
    assert not _scan_frontend(ROOT / "geo-intake/modules"), "geo-intake 源码禁止直连 MySQL/Redis"
    assert not _scan_frontend(ROOT / "geo-intake/app"), "geo-intake API 路由禁止直连 MySQL/Redis"


def test_next_config_keeps_typecheck_enabled():
    for root in (ROOT / "geo-admin", ROOT / "geo-intake"):
        cfg = (root / "next.config.mjs").read_text(encoding="utf-8")
        assert "ignoreBuildErrors" not in cfg
        assert "ignoreDuringBuilds" not in cfg
