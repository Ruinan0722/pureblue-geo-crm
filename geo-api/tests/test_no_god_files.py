"""God 文件防线：核心模块单文件行数上限（防止 4000 行级 service 回归）。"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_LINES = 900
SCOPES = [
    "app/modules/crm/service",
    "app/modules/crm/repository",
    "app/modules/requests",
    "app/modules/projects",
]


def test_core_modules_have_no_god_files():
    offenders: list[str] = []
    for scope in SCOPES:
        base = ROOT / scope
        if not base.exists():
            continue
        for path in base.rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            lines = len(path.read_text(encoding="utf-8").splitlines())
            if lines > MAX_LINES:
                offenders.append(f"{path.relative_to(ROOT)}: {lines} 行")
    assert not offenders, "超过行数上限的模块文件（需继续拆分）：\n" + "\n".join(offenders)
