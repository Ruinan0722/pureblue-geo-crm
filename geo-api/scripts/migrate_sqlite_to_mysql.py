#!/usr/bin/env python3
"""One-off: import missing rows from legacy SQLite geo.db into MySQL geo_crm.

Safe to re-run: skips existing users (by feishu_open_id), invites (by token),
requests (by code). Does not delete or update existing MySQL rows.

Usage:
  python scripts/migrate_sqlite_to_mysql.py --sqlite /path/to/geo.db --dry-run
  python scripts/migrate_sqlite_to_mysql.py --sqlite /path/to/geo.db \\
    --mysql-host geo-mysql --mysql-password 123456
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime
from typing import Any

try:
    import pymysql
except ImportError:
    pymysql = None  # type: ignore

INVALID_DT = {"无", "", "null", "None"}


def parse_dt(raw: str | None) -> datetime | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in INVALID_DT:
        return None
    s = s.replace("/", "-")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$", s)
    if not m:
        return None
    y, mo, d, hh, mm, ss = m.groups()
    return datetime(
        int(y),
        int(mo),
        int(d),
        int(hh or 0),
        int(mm or 0),
        int(ss or 0),
    )


def json_col(raw: Any, default: str = "{}") -> str:
    if isinstance(raw, (dict, list)):
        return json.dumps(raw, ensure_ascii=False)
    if raw is None or raw == "":
        return default
    try:
        json.loads(raw)
        return raw
    except json.JSONDecodeError:
        return json.dumps({"_raw": raw}, ensure_ascii=False)


def dept_names(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, str):
        try:
            json.loads(raw)
            return raw
        except json.JSONDecodeError:
            return json.dumps([raw], ensure_ascii=False)
    return json.dumps(raw, ensure_ascii=False)


def connect_mysql(host: str, port: int, user: str, password: str, database: str):
    if pymysql is None:
        raise RuntimeError("pymysql not installed")
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_sqlite_users(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT id, feishu_open_id, name, avatar_url, role, department_names, created_at, updated_at FROM users"
    )
    return cur.fetchall()


def fetch_sqlite_invites(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    cur = conn.cursor()
    cur.execute(
        "SELECT id, token, staff_user_id, label, revoked_at, visit_count, created_at FROM invites"
    )
    return cur.fetchall()


def fetch_sqlite_requests(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    cur = conn.cursor()
    cur.execute(
        "SELECT id, code, status, submitted_at, updated_at, owner, staff_user_id, invite_id, data, notes FROM requests"
    )
    return cur.fetchall()


def migrate(dry_run: bool, sqlite_path: str, mysql_host: str, mysql_port: int, mysql_user: str, mysql_password: str) -> int:
    sq = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    sq.row_factory = sqlite3.Row

    my = connect_mysql(mysql_host, mysql_port, mysql_user, mysql_password, "geo_crm")
    cur = my.cursor()

    stats = {"users_inserted": 0, "invites_inserted": 0, "requests_inserted": 0, "skipped": 0}

    # --- users: map sqlite user id -> mysql user id ---
    user_id_map: dict[str, str] = {}
    cur.execute("SELECT id, feishu_open_id FROM users")
    mysql_by_open_id = {r["feishu_open_id"]: r["id"] for r in cur.fetchall()}

    for row in fetch_sqlite_users(sq):
        sid = row["id"]
        open_id = row["feishu_open_id"]
        if open_id in mysql_by_open_id:
            user_id_map[sid] = mysql_by_open_id[open_id]
            continue
        new_id = sid if len(str(sid)) == 36 else str(uuid.uuid4())
        user_id_map[sid] = new_id
        created = parse_dt(row["created_at"]) or datetime.now()
        updated = parse_dt(row["updated_at"]) or created
        print(f"[user+] {row['name']} ({open_id}) -> {new_id}")
        if not dry_run:
            cur.execute(
                """
                INSERT INTO users (id, feishu_open_id, name, avatar_url, role, department_names, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, CAST(%s AS JSON), %s, %s)
                """,
                (
                    new_id,
                    open_id,
                    row["name"],
                    row["avatar_url"],
                    row["role"] or "sales",
                    dept_names(row["department_names"]),
                    created,
                    updated,
                ),
            )
        stats["users_inserted"] += 1
        mysql_by_open_id[open_id] = new_id

    # --- invites ---
    invite_id_map: dict[str, str] = {}
    cur.execute("SELECT id, token FROM invites")
    mysql_by_token = {r["token"]: r["id"] for r in cur.fetchall()}

    for row in fetch_sqlite_invites(sq):
        token = row["token"]
        if token in mysql_by_token:
            invite_id_map[row["id"]] = mysql_by_token[token]
            continue
        staff_mysql = user_id_map.get(row["staff_user_id"])
        if not staff_mysql:
            print(f"[invite skip] token={token[:8]}... unknown staff {row['staff_user_id']}", file=sys.stderr)
            stats["skipped"] += 1
            continue
        new_id = row["id"]
        created = parse_dt(row["created_at"]) or datetime.now()
        revoked = parse_dt(row["revoked_at"])
        print(f"[invite+] {token[:12]}... staff={staff_mysql}")
        if not dry_run:
            cur.execute(
                """
                INSERT INTO invites (id, token, staff_user_id, label, revoked_at, visit_count, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (new_id, token, staff_mysql, row["label"], revoked, row["visit_count"] or 0, created),
            )
        invite_id_map[row["id"]] = new_id
        mysql_by_token[token] = new_id
        stats["invites_inserted"] += 1

    # --- requests ---
    cur.execute("SELECT code FROM requests")
    mysql_codes = {r["code"] for r in cur.fetchall()}

    for row in fetch_sqlite_requests(sq):
        code = row["code"]
        if code in mysql_codes:
            stats["skipped"] += 1
            continue
        submitted = parse_dt(row["submitted_at"])
        updated = parse_dt(row["updated_at"]) or submitted or datetime.now()
        staff_mysql = user_id_map.get(row["staff_user_id"]) if row["staff_user_id"] else None
        invite_mysql = invite_id_map.get(row["invite_id"]) if row["invite_id"] else None
        req_id = row["id"] if len(str(row["id"])) >= 32 else str(uuid.uuid4())
        print(f"[request+] {code} | {row['status']} | owner={row['owner']} | submitted={submitted}")
        if not dry_run:
            cur.execute(
                """
                INSERT INTO requests (id, code, status, submitted_at, updated_at, owner, staff_user_id, invite_id, data, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CAST(%s AS JSON), CAST(%s AS JSON))
                """,
                (
                    req_id,
                    code,
                    row["status"],
                    submitted,
                    updated,
                    row["owner"],
                    staff_mysql,
                    invite_mysql,
                    json_col(row["data"], "{}"),
                    json_col(row["notes"], "[]"),
                ),
            )
        stats["requests_inserted"] += 1
        mysql_codes.add(code)

    if dry_run:
        my.rollback()
        print("\n[DRY RUN] No changes committed.")
    else:
        my.commit()
        print("\n[OK] Committed to MySQL.")

    print(
        f"Summary: users+={stats['users_inserted']}, invites+={stats['invites_inserted']}, "
        f"requests+={stats['requests_inserted']}, skipped={stats['skipped']}"
    )
    sq.close()
    my.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate legacy SQLite geo.db into MySQL")
    parser.add_argument("--sqlite", required=True, help="Path to geo.db (read-only)")
    parser.add_argument("--mysql-host", default="127.0.0.1")
    parser.add_argument("--mysql-port", type=int, default=3306)
    parser.add_argument("--mysql-user", default="geo_app")
    parser.add_argument("--mysql-password", default="123456")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    args = parser.parse_args()
    return migrate(
        dry_run=args.dry_run,
        sqlite_path=args.sqlite,
        mysql_host=args.mysql_host,
        mysql_port=args.mysql_port,
        mysql_user=args.mysql_user,
        mysql_password=args.mysql_password,
    )


if __name__ == "__main__":
    raise SystemExit(main())
