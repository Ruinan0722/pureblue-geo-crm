"""运行时零 SQL JSON 函数：防止 document/data JSON 列回归后引入 JSON_EXTRACT 等。"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

SQL_JSON_FUNCTIONS = re.compile(
    r"\b(JSON_EXTRACT|JSON_UNQUOTE|JSON_QUOTE|JSON_SEARCH|JSON_CONTAINS|JSON_LENGTH|JSON_TABLE|JSON_TYPE|JSON_KEYS|JSON_OBJECT|JSON_ARRAY)\s*\("
)

# auth 目录域已知债务：users/feishu_sales_contacts 的部门快照 JSON 列仍在，
# 仅允许这两处 SQL JSON 使用；新增任何其它 SQL JSON 都会被拦截。
ALLOWED = {
    ("app/modules/users/feishu_org_sync.py", 840),  # JSON_LENGTH(department_names)
    ("app/modules/users/repository.py", 603),  # JSON_LENGTH(feishu_led_department_ids)
}


def test_app_has_no_sql_json_functions():
    offenders: list[str] = []
    for path in APP.rglob("*.py"):
        if "alembic" in path.parts or "/migrations/" in str(path):
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if SQL_JSON_FUNCTIONS.search(line):
                rel = path.relative_to(ROOT).as_posix()
                if (rel, i) not in ALLOWED:
                    offenders.append(f"{rel}:{i}")
    assert not offenders, "运行时禁止 SQL JSON 函数（业务数据已落列/子表）：\n" + "\n".join(offenders[:10])
