#!/usr/bin/env python3
"""向本地测试库写入一套可联调的 CRM 假数据（幂等：固定 ID，可重复执行）。

覆盖：测试成员、部门 ID/名称（组织结构）、通讯录快照、线索、客户、商机、
需求、合同、项目，以及 RBAC 角色绑定。

用法（需已 alembic upgrade head + seed_rbac）：
  MYSQL_DATABASE=geo_crm_dev MYSQL_PASSWORD=... \\
    geo-api/.venv/bin/python geo-api/scripts/seed_dev_crm.py
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta
from typing import Any

import pymysql

NOW = datetime.utcnow().replace(microsecond=0)
TODAY = date.today()
TODAY_ISO = TODAY.isoformat()


def uid(suffix: str) -> str:
    """稳定伪 UUID（非标准，但满足 CHAR(36)）。"""
    raw = f"dev-{suffix}"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, raw))


# ---- 部门树（假 open_department_id；配合 labels 文件做中文名兜底）----
DEPTS = {
    "root": ("od-dev-root", "纯蓝测试科技"),
    "sales": ("od-dev-sales", "销售部"),
    "sdr": ("od-dev-sdr", "SDR组"),
    "overseas": ("od-dev-overseas", "海外销售"),
    "presales": ("od-dev-presales", "售前顾问"),
    "cs": ("od-dev-cs", "客户成功"),
    "ops": ("od-dev-ops", "销售运营"),
}


def dept_id(key: str) -> str:
    return DEPTS[key][0]


def dept_name(key: str) -> str:
    return DEPTS[key][1]


# ---- 测试成员 ----
USERS: list[dict[str, Any]] = [
    {
        "key": "admin",
        "name": "测试管理员",
        "role": "admin",
        "depts": ["ops"],
        "title": "系统管理员",
        "led": [],
    },
    {
        "key": "leader",
        "name": "测试销售Leader",
        "role": "leader",
        "depts": ["sales"],
        "title": "销售负责人",
        "led": ["sales", "sdr"],
    },
    {
        "key": "sales1",
        "name": "测试销售甲",
        "role": "sales",
        "depts": ["sales"],
        "title": "客户经理",
        "led": [],
    },
    {
        "key": "sales2",
        "name": "测试销售乙",
        "role": "sales",
        "depts": ["overseas"],
        "title": "海外销售",
        "led": [],
    },
    {
        "key": "sdr",
        "name": "测试SDR",
        "role": "sdr",
        "depts": ["sdr"],
        "title": "SDR",
        "led": [],
    },
    {
        "key": "presales",
        "name": "测试售前",
        "role": "presales",
        "depts": ["presales"],
        "title": "售前顾问",
        "led": [],
    },
    {
        "key": "cs",
        "name": "测试客户成功",
        "role": "viewer",
        "depts": ["cs"],
        "title": "客户成功经理",
        "led": [],
    },
    {
        "key": "ops",
        "name": "测试运营",
        "role": "ops",
        "depts": ["ops"],
        "title": "销售运营",
        "led": [],
    },
]


def user_id(key: str) -> str:
    return uid(f"user-{key}")


def open_id(key: str) -> str:
    return f"ou-dev-{key}"


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def connect():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "geo_app"),
        password=os.environ.get("MYSQL_PASSWORD", "geo_dev_local"),
        database=os.environ.get("MYSQL_DATABASE", "geo_crm_dev"),
        charset="utf8mb4",
        autocommit=False,
    )


def upsert_users(cur) -> None:
    has_led = False
    cur.execute("SHOW COLUMNS FROM users LIKE 'feishu_led_department_ids'")
    has_led = cur.fetchone() is not None

    for u in USERS:
        dids = [dept_id(k) for k in u["depts"]]
        dnames = [dept_name(k) for k in u["depts"]]
        led = [dept_id(k) for k in u["led"]]
        primary = u["depts"][0]
        cols = [
            "id",
            "feishu_open_id",
            "name",
            "avatar_url",
            "role",
            "role_source",
            "role_locked",
            "data_scope_override",
            "department_names",
            "department_ids",
            "employment_status",
            "left_at",
            "created_at",
            "updated_at",
            "manual_department_open_id",
            "manual_department_name",
            "manual_department_note",
            "manual_department_leader",
        ]
        vals: list[Any] = [
            user_id(u["key"]),
            open_id(u["key"]),
            u["name"],
            None,
            u["role"],
            "manual",
            1,
            None,
            dumps(dnames),
            dumps(dids),
            "active",
            None,
            NOW,
            NOW,
            dept_id(primary),
            dept_name(primary),
            "本地测试数据",
            1 if u["led"] else 0,
        ]
        if has_led:
            cols.append("feishu_led_department_ids")
            vals.append(dumps(led) if led else None)

        placeholders = ", ".join(["%s"] * len(cols))
        updates = ", ".join(f"{c}=VALUES({c})" for c in cols if c not in ("id", "feishu_open_id", "created_at"))
        cur.execute(
            f"INSERT INTO users ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE {updates}",
            vals,
        )

        # 通讯录快照（跟进人下拉）
        cur.execute(
            """
            INSERT INTO feishu_sales_contacts
              (feishu_open_id, name, job_title, department_ids, department_names,
               is_active, synced_at, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              name=VALUES(name), job_title=VALUES(job_title),
              department_ids=VALUES(department_ids),
              department_names=VALUES(department_names),
              is_active=1, synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)
            """,
            (
                open_id(u["key"]),
                u["name"],
                u["title"],
                dumps(dids),
                dumps(dnames),
                NOW,
                NOW,
                NOW,
            ),
        )


def bind_roles(cur) -> None:
    for u in USERS:
        cur.execute("SELECT id FROM rbac_roles WHERE code=%s", (u["role"],))
        row = cur.fetchone()
        if not row:
            continue
        role_row_id = row[0]
        cur.execute(
            """
            INSERT INTO user_role_assignments (user_id, role_id, is_primary, assigned_at)
            VALUES (%s, %s, 1, %s)
            ON DUPLICATE KEY UPDATE is_primary=1, assigned_at=VALUES(assigned_at)
            """,
            (user_id(u["key"]), role_row_id, NOW),
        )


def seed_crm(cur) -> None:
    sdr = user_id("sdr")
    sales1 = user_id("sales1")
    sales2 = user_id("sales2")
    leader = user_id("leader")
    cs = user_id("cs")
    presales = user_id("presales")

    # --- 线索 ---
    leads = [
        {
            "id": uid("lead-untouched"),
            "owner": sdr,
            "status": "untouched",
            "company": "测试未触达科技有限公司",
            "doc": {
                "id": uid("lead-untouched"),
                "companyName": "测试未触达科技有限公司",
                "brandName": "未触达科技",
                "status": "untouched",
                "followState": "untouched",
                "level": "B",
                "source": "展会",
                "sourceDetail": "本地种子",
                "region": "华东",
                "city": "上海",
                "contactName": "王线索",
                "contactTitle": "市场经理",
                "contactPhone": "13800000001",
                "contactDepartment": "市场部",
                "email": "lead1@example.test",
                "website": "https://untouched.example.test",
                "sdr": "测试SDR",
                "sales": "未分配",
                "createdAt": TODAY_ISO,
                "notes": [],
                "attachments": [],
                "wechatAdded": False,
            },
        },
        {
            "id": uid("lead-touched"),
            "owner": sdr,
            "status": "touched",
            "company": "测试已触达信息有限公司",
            "doc": {
                "id": uid("lead-touched"),
                "companyName": "测试已触达信息有限公司",
                "brandName": "已触达信息",
                "status": "touched",
                "followState": "touched",
                "level": "A",
                "source": "转介绍",
                "region": "华北",
                "city": "北京",
                "contactName": "李触达",
                "contactTitle": "采购总监",
                "contactPhone": "13800000002",
                "email": "lead2@example.test",
                "sdr": "测试SDR",
                "sales": "测试销售甲",
                "createdAt": (TODAY - timedelta(days=5)).isoformat(),
                "firstContactDate": (TODAY - timedelta(days=3)).isoformat(),
                "notes": [
                    {
                        "id": uid("ln-1"),
                        "date": (TODAY - timedelta(days=3)).isoformat(),
                        "content": "已电话沟通，有 GEO 需求意向",
                        "author": "测试SDR",
                        "wechatAdded": True,
                    }
                ],
                "attachments": [],
                "wechatAdded": True,
            },
        },
    ]

    # 转客户链路：线索 → 客户
    lead_conv_id = uid("lead-converted")
    cust_from_lead = uid("cust-from-lead")
    leads.append(
        {
            "id": lead_conv_id,
            "owner": sdr,
            "status": "converted",
            "company": "测试转化客户股份有限公司",
            "doc": {
                "id": lead_conv_id,
                "companyName": "测试转化客户股份有限公司",
                "brandName": "转化客户",
                "status": "converted",
                "followState": "converted",
                "level": "A",
                "source": "官网留资",
                "region": "华南",
                "city": "深圳",
                "contactName": "赵转化",
                "contactTitle": "CEO",
                "contactPhone": "13800000003",
                "email": "converted@example.test",
                "sdr": "测试SDR",
                "sales": "测试销售甲",
                "convertedCustomerId": cust_from_lead,
                "transferDate": (TODAY - timedelta(days=10)).isoformat(),
                "createdAt": (TODAY - timedelta(days=20)).isoformat(),
                "notes": [],
                "attachments": [],
            },
        }
    )

    for lead in leads:
        cur.execute(
            """
            INSERT INTO crm_leads
              (id, owner_user_id, status, company_name, document, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              owner_user_id=VALUES(owner_user_id), status=VALUES(status),
              company_name=VALUES(company_name), document=VALUES(document),
              updated_at=VALUES(updated_at)
            """,
            (
                lead["id"],
                lead["owner"],
                lead["status"],
                lead["company"],
                dumps(lead["doc"]),
                NOW - timedelta(days=20),
                NOW,
            ),
        )

    # --- 客户 ---
    # 区域对齐前端 REGIONS：华东区 / 华南区 / 华北区 / 海外
    # 多条挂销售甲，便于 Leader 测「批量分配负责人」
    customers = [
        {
            "id": cust_from_lead,
            "owner": sales1,
            "status": "connected",
            "company": "测试转化客户股份有限公司",
            "doc": {
                "id": cust_from_lead,
                "companyUid": "CUS-TEST-0001",
                "companyName": "测试转化客户股份有限公司",
                "brandName": "转化客户",
                "region": "华南区",
                "city": "深圳",
                "industryL1": "科技互联网",
                "industryL2": "企业服务",
                "status": "connected",
                "owner": "测试销售甲",
                "sdr": "测试SDR",
                "sdrUserId": sdr,
                "createdByUserId": sdr,
                "sourceLeadId": lead_conv_id,
                "source": "官网留资",
                "isKey": True,
                "createdAt": (TODAY - timedelta(days=10)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=2)).isoformat(),
                "nextFollowAt": (TODAY + timedelta(days=3)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-conv-1"),
                        "name": "赵转化",
                        "title": "CEO",
                        "phone": "13800000003",
                        "email": "converted@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "subsidiaries": [],
                "notes": [
                    {
                        "id": uid("cn-1"),
                        "date": (TODAY - timedelta(days=2)).isoformat(),
                        "content": "客户确认本季度启动 GEO 试点",
                        "author": "测试销售甲",
                    }
                ],
                "attachments": [],
            },
        },
        {
            "id": uid("cust-following"),
            "owner": sales1,
            "status": "opportunity_following",
            "company": "测试跟进中贸易有限公司",
            "doc": {
                "id": uid("cust-following"),
                "companyUid": "CUS-TEST-0002",
                "companyName": "测试跟进中贸易有限公司",
                "brandName": "跟进贸易",
                "region": "华东区",
                "city": "杭州",
                "industryL1": "商贸零售",
                "industryL2": "电商",
                "status": "opportunity_following",
                "owner": "测试销售甲",
                "isKey": False,
                "createdAt": (TODAY - timedelta(days=30)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=1)).isoformat(),
                "nextFollowAt": (TODAY + timedelta(days=5)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-follow-1"),
                        "name": "钱跟进",
                        "title": "品牌总监",
                        "phone": "13800000004",
                        "email": "follow@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": False,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-signed"),
            "owner": sales2,
            "status": "cooperating",
            "company": "测试已签约出海有限公司",
            "doc": {
                "id": uid("cust-signed"),
                "companyUid": "CUS-TEST-0003",
                "companyName": "测试已签约出海有限公司",
                "brandName": "出海签约",
                "region": "海外",
                "city": "新加坡",
                "industryL1": "科技互联网",
                "industryL2": "互联网服务",
                "status": "cooperating",
                "owner": "测试销售乙",
                "isKey": True,
                "createdAt": (TODAY - timedelta(days=60)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=7)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-signed-1"),
                        "name": "孙出海",
                        "title": "VP Marketing",
                        "phone": "+65-80000005",
                        "email": "signed@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-awaiting"),
            "owner": sales2,
            "status": "awaiting_contact",
            "company": "测试待联系新客户",
            "doc": {
                "id": uid("cust-awaiting"),
                "companyUid": "CUS-TEST-0004",
                "companyName": "测试待联系新客户",
                "brandName": "待联系",
                "region": "华北区",
                "city": "成都",
                "industryL1": "工业制造",
                "industryL2": "机械 / 设备",
                "status": "awaiting_contact",
                "owner": "测试销售乙",
                "isKey": False,
                "createdAt": TODAY_ISO,
                "contacts": [],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-a"),
            "owner": sales1,
            "status": "connected",
            "company": "批量测试甲科技有限公司",
            "doc": {
                "id": uid("cust-batch-a"),
                "companyUid": "CUS-TEST-0005",
                "companyName": "批量测试甲科技有限公司",
                "brandName": "批量甲",
                "region": "华北区",
                "city": "北京",
                "industryL1": "科技互联网",
                "industryL2": "SaaS",
                "status": "connected",
                "owner": "测试销售甲",
                "isKey": False,
                "source": "转介绍",
                "createdAt": (TODAY - timedelta(days=8)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=3)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-a"),
                        "name": "周批量甲",
                        "title": "市场经理",
                        "phone": "13800001001",
                        "email": "batch-a@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-b"),
            "owner": sales1,
            "status": "awaiting_contact",
            "company": "批量测试乙教育有限公司",
            "doc": {
                "id": uid("cust-batch-b"),
                "companyUid": "CUS-TEST-0006",
                "companyName": "批量测试乙教育有限公司",
                "brandName": "批量乙",
                "region": "华东区",
                "city": "上海",
                "industryL1": "教育",
                "industryL2": "在线教育",
                "status": "awaiting_contact",
                "owner": "测试销售甲",
                "isKey": True,
                "source": "内容营销",
                "createdAt": (TODAY - timedelta(days=4)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-b"),
                        "name": "吴批量乙",
                        "title": "增长负责人",
                        "phone": "13800001002",
                        "email": "batch-b@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": False,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-c"),
            "owner": sales1,
            "status": "opportunity_following",
            "company": "批量测试丙医疗有限公司",
            "doc": {
                "id": uid("cust-batch-c"),
                "companyUid": "CUS-TEST-0007",
                "companyName": "批量测试丙医疗有限公司",
                "brandName": "批量丙",
                "region": "华南区",
                "city": "广州",
                "industryL1": "医疗健康",
                "industryL2": "医疗器械",
                "status": "opportunity_following",
                "owner": "测试销售甲",
                "isKey": False,
                "createdAt": (TODAY - timedelta(days=18)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=1)).isoformat(),
                "nextFollowAt": (TODAY + timedelta(days=2)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-c"),
                        "name": "郑批量丙",
                        "title": "采购主管",
                        "phone": "13800001003",
                        "email": "batch-c@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "notes": [
                    {
                        "id": uid("cn-batch-c"),
                        "date": (TODAY - timedelta(days=1)).isoformat(),
                        "content": "已约下周需求诊断会",
                        "author": "测试销售甲",
                    }
                ],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-d"),
            "owner": sales1,
            "status": "cooperating",
            "company": "批量测试丁金融有限公司",
            "doc": {
                "id": uid("cust-batch-d"),
                "companyUid": "CUS-TEST-0008",
                "companyName": "批量测试丁金融有限公司",
                "brandName": "批量丁",
                "region": "华北区",
                "city": "天津",
                "industryL1": "金融",
                "industryL2": "FinTech",
                "status": "cooperating",
                "owner": "测试销售甲",
                "isKey": True,
                "createdAt": (TODAY - timedelta(days=90)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=14)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-d"),
                        "name": "王批量丁",
                        "title": "数字化总监",
                        "phone": "13800001004",
                        "email": "batch-d@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [
                    {
                        "id": uid("sub-batch-d"),
                        "name": "批量丁（上海）信息科技有限公司",
                        "shortName": "批量丁上海",
                        "creditCode": "91310000MA1TEST001",
                        "city": "上海",
                    }
                ],
            },
        },
        {
            "id": uid("cust-stopped"),
            "owner": sales1,
            "status": "stopped",
            "company": "测试停止跟进客户有限公司",
            "doc": {
                "id": uid("cust-stopped"),
                "companyUid": "CUS-TEST-0009",
                "companyName": "测试停止跟进客户有限公司",
                "brandName": "停跟客户",
                "region": "华东区",
                "city": "南京",
                "industryL1": "地产建筑",
                "industryL2": "装修",
                "status": "stopped",
                "owner": "测试销售甲",
                "isKey": False,
                "createdAt": (TODAY - timedelta(days=120)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=40)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-stopped"),
                        "name": "冯停跟",
                        "title": "运营",
                        "phone": "13800001005",
                        "email": "stopped@example.test",
                        "isPrimary": True,
                        "active": False,
                        "wechatAdded": False,
                    }
                ],
                "notes": [
                    {
                        "id": uid("cn-stopped"),
                        "date": (TODAY - timedelta(days=40)).isoformat(),
                        "content": "预算冻结，本季度不再跟进",
                        "author": "测试销售甲",
                    }
                ],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-leader-own"),
            "owner": leader,
            "status": "connected",
            "company": "测试Leader自跟客户有限公司",
            "doc": {
                "id": uid("cust-leader-own"),
                "companyUid": "CUS-TEST-0010",
                "companyName": "测试Leader自跟客户有限公司",
                "brandName": "Leader自跟",
                "region": "华南区",
                "city": "深圳",
                "industryL1": "文旅餐饮",
                "industryL2": "传媒广告",
                "status": "connected",
                "owner": "测试销售Leader",
                "isKey": True,
                "createdAt": (TODAY - timedelta(days=12)).isoformat(),
                "lastFollowAt": TODAY_ISO,
                "nextFollowAt": (TODAY + timedelta(days=7)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-leader"),
                        "name": "陈自跟",
                        "title": "品牌 VP",
                        "phone": "13800001006",
                        "email": "leader-own@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": True,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-e"),
            "owner": sales1,
            "status": "connected",
            "company": "批量测试戊制造有限公司",
            "doc": {
                "id": uid("cust-batch-e"),
                "companyUid": "CUS-TEST-0011",
                "companyName": "批量测试戊制造有限公司",
                "brandName": "批量戊",
                "region": "华东区",
                "city": "苏州",
                "industryL1": "工业制造",
                "industryL2": "电子",
                "status": "connected",
                "owner": "测试销售甲",
                "isKey": False,
                "createdAt": (TODAY - timedelta(days=6)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=2)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-e"),
                        "name": "褚批量戊",
                        "title": "市场部经理",
                        "phone": "13800001007",
                        "email": "batch-e@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": False,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
        {
            "id": uid("cust-batch-f"),
            "owner": sales1,
            "status": "awaiting_contact",
            "company": "批量测试己零售有限公司",
            "doc": {
                "id": uid("cust-batch-f"),
                "companyUid": "CUS-TEST-0012",
                "companyName": "批量测试己零售有限公司",
                "brandName": "批量己",
                "region": "华南区",
                "city": "佛山",
                "industryL1": "商贸零售",
                "industryL2": "美妆",
                "status": "awaiting_contact",
                "owner": "测试销售甲",
                "isKey": False,
                "createdAt": (TODAY - timedelta(days=2)).isoformat(),
                "contacts": [
                    {
                        "id": uid("ct-batch-f"),
                        "name": "卫批量己",
                        "title": "电商运营",
                        "phone": "13800001008",
                        "email": "batch-f@example.test",
                        "isPrimary": True,
                        "active": True,
                        "wechatAdded": False,
                    }
                ],
                "notes": [],
                "attachments": [],
                "subsidiaries": [],
            },
        },
    ]

    for c in customers:
        cur.execute(
            """
            INSERT INTO crm_customers
              (id, owner_user_id, status, company_name, document, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              owner_user_id=VALUES(owner_user_id), status=VALUES(status),
              company_name=VALUES(company_name), document=VALUES(document),
              updated_at=VALUES(updated_at)
            """,
            (c["id"], c["owner"], c["status"], c["company"], dumps(c["doc"]), NOW - timedelta(days=40), NOW),
        )

    # --- 商机 + 需求 ---
    opp_research = uid("opp-research")
    opp_signing = uid("opp-signing")
    opp_won = uid("opp-won")
    req_bound = uid("req-bound")
    req_draft = uid("req-draft")

    opportunities = [
        {
            "id": opp_research,
            "owner": sales1,
            "customer_id": uid("cust-following"),
            "stage": "demand_research",
            "doc": {
                "id": opp_research,
                "name": "跟进贸易-GEO 诊断",
                "customerId": uid("cust-following"),
                "brandName": "跟进贸易",
                "owner": "测试销售甲",
                "stage": "demand_research",
                "amount": 180000,
                "probability": 40,
                "region": "华东",
                "platform": ["ChatGPT", "Perplexity"],
                "projectTypes": ["品牌GEO"],
                "goal": "提升 AI 搜索可见度",
                "advisor": "测试售前",
                "requestIds": [req_bound],
                "createdAt": (TODAY - timedelta(days=15)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=1)).isoformat(),
                "nextFollowAt": TODAY_ISO,
                "expectedSignDate": (TODAY + timedelta(days=45)).isoformat(),
                "stageHistory": [
                    {"stage": "contact", "at": (TODAY - timedelta(days=15)).isoformat()},
                    {"stage": "demand_research", "at": (TODAY - timedelta(days=10)).isoformat()},
                ],
                "notes": [],
                "attachments": [],
                "advisorNotes": [],
            },
        },
        {
            "id": opp_signing,
            "owner": sales1,
            "customer_id": cust_from_lead,
            "stage": "signing",
            "doc": {
                "id": opp_signing,
                "name": "转化客户-GEO 签约中",
                "customerId": cust_from_lead,
                "brandName": "转化客户",
                "owner": "测试销售甲",
                "stage": "signing",
                "amount": 260000,
                "probability": 80,
                "region": "华南",
                "requestIds": [],
                "createdAt": (TODAY - timedelta(days=25)).isoformat(),
                "lastFollowAt": (TODAY - timedelta(days=2)).isoformat(),
                "nextFollowAt": (TODAY + timedelta(days=3)).isoformat(),
                "expectedSignDate": (TODAY + timedelta(days=7)).isoformat(),
                "stageHistory": [
                    {"stage": "contact", "at": (TODAY - timedelta(days=25)).isoformat()},
                    {"stage": "signing", "at": (TODAY - timedelta(days=3)).isoformat()},
                ],
                "notes": [],
                "attachments": [],
                "advisorNotes": [],
                "projectTypes": ["监测"],
            },
        },
        {
            "id": opp_won,
            "owner": sales2,
            "customer_id": uid("cust-signed"),
            "stage": "won",
            "doc": {
                "id": opp_won,
                "name": "出海签约-年度 GEO",
                "customerId": uid("cust-signed"),
                "brandName": "出海签约",
                "owner": "测试销售乙",
                "stage": "won",
                "amount": 420000,
                "probability": 100,
                "region": "海外",
                "requestIds": [],
                "createdAt": (TODAY - timedelta(days=50)).isoformat(),
                "stageHistory": [
                    {"stage": "contact", "at": (TODAY - timedelta(days=50)).isoformat()},
                    {"stage": "won", "at": (TODAY - timedelta(days=20)).isoformat()},
                ],
                "notes": [],
                "attachments": [],
                "advisorNotes": [],
                "projectTypes": ["品牌GEO"],
            },
        },
    ]

    for o in opportunities:
        cur.execute(
            """
            INSERT INTO crm_opportunities
              (id, owner_user_id, customer_id, stage, document, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              owner_user_id=VALUES(owner_user_id), customer_id=VALUES(customer_id),
              stage=VALUES(stage), document=VALUES(document), updated_at=VALUES(updated_at)
            """,
            (o["id"], o["owner"], o["customer_id"], o["stage"], dumps(o["doc"]), NOW - timedelta(days=30), NOW),
        )

    request_data_base = {
        "companyName": "测试跟进中贸易有限公司",
        "brandName": "跟进贸易",
        "contactName": "钱跟进",
        "contactTitle": "品牌总监",
        "contactPhone": "13800000004",
        "goal": "提升品牌在 AI 引擎的引用率",
        "goals": ["品牌可见度", "内容权威性"],
        "platforms": ["ChatGPT", "Perplexity"],
        "regions": ["中国", "东南亚"],
        "products": ["核心产品线 A"],
        "scopeType": "brand",
        "intentType": "brand",
        "intentRough": "希望 3 个月内看到引用提升",
        "brandAliases": ["跟进贸易", "FollowTrade"],
        "hasOverseasSite": True,
        "overseasSiteUrl": "https://follow.example.test",
        "expectedStartDate": (TODAY + timedelta(days=14)).isoformat(),
        "optimizePeriod": "3个月",
        "optimizeBackground": "本地种子需求单",
        "strengthBrand": "中",
        "strengthMarket": "中",
        "strengthTech": "弱",
        "strengthEcosystem": "中",
        "strengthOther": "",
        "intentQuestions": [],
        "intentRoughItems": [],
    }

    requests_rows = [
        {
            "id": req_bound,
            "code": "GEO-TEST-2026-0001",
            "status": "confirmed",
            "owner": "测试销售甲",
            "staff": sales1,
            "opp": opp_research,
            "submitted": NOW - timedelta(days=8),
            "data": {**request_data_base},
        },
        {
            "id": req_draft,
            "code": "GEO-TEST-2026-0002",
            "status": "draft",
            "owner": "测试销售乙",
            "staff": sales2,
            "opp": None,
            "submitted": None,
            "data": {
                **request_data_base,
                "companyName": "测试已签约出海有限公司",
                "brandName": "出海签约",
                "contactName": "孙出海",
            },
        },
        {
            "id": uid("req-submitted"),
            "code": "GEO-TEST-2026-0003",
            "status": "submitted",
            "owner": "测试销售甲",
            "staff": sales1,
            "opp": None,
            "submitted": NOW - timedelta(days=1),
            "data": {
                **request_data_base,
                "companyName": "测试转化客户股份有限公司",
                "brandName": "转化客户",
                "contactName": "赵转化",
            },
        },
    ]

    for r in requests_rows:
        cur.execute(
            """
            INSERT INTO requests
              (id, code, status, submitted_at, updated_at, owner, staff_user_id,
               invite_id, opportunity_id, data, notes, attachments)
            VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              status=VALUES(status), submitted_at=VALUES(submitted_at),
              updated_at=VALUES(updated_at), owner=VALUES(owner),
              staff_user_id=VALUES(staff_user_id), opportunity_id=VALUES(opportunity_id),
              data=VALUES(data)
            """,
            (
                r["id"],
                r["code"],
                r["status"],
                r["submitted"],
                NOW,
                r["owner"],
                r["staff"],
                r["opp"],
                dumps(r["data"]),
                dumps([]),
                dumps([]),
            ),
        )

    # --- 合同 ---
    ct_pending = uid("ct-pending")
    ct_signed = uid("ct-signed")
    contracts = [
        {
            "id": ct_pending,
            "owner": sales1,
            "customer_id": cust_from_lead,
            "status": "pending",
            "doc": {
                "id": ct_pending,
                "code": "CT-TEST-2026-0001",
                "name": "转化客户 GEO 服务合同",
                "customerId": cust_from_lead,
                "opportunityId": opp_signing,
                "company": "测试转化客户股份有限公司",
                "owner": "测试销售甲",
                "owners": ["测试销售甲"],
                "amount": 260000,
                "status": "pending",
                "type": "服务合同",
                "signType": "电子签",
                "region": "华南",
                "city": "深圳",
                "dept": "销售部",
                "source": "商机转化",
                "projectStatus": "not_started",
                "validMonths": 12,
                "createdAt": (TODAY - timedelta(days=2)).isoformat(),
                "paymentPlans": [],
                "attachments": [],
            },
        },
        {
            "id": ct_signed,
            "owner": sales2,
            "customer_id": uid("cust-signed"),
            "status": "signed",
            "doc": {
                "id": ct_signed,
                "code": "CT-TEST-2026-0002",
                "name": "出海签约年度 GEO 合同",
                "customerId": uid("cust-signed"),
                "opportunityId": opp_won,
                "company": "测试已签约出海有限公司",
                "owner": "测试销售乙",
                "owners": ["测试销售乙"],
                "amount": 420000,
                "status": "signed",
                "type": "服务合同",
                "signType": "电子签",
                "region": "海外",
                "city": "新加坡",
                "dept": "海外销售",
                "source": "商机转化",
                "projectStatus": "active",
                "validMonths": 12,
                "dualSignDate": (TODAY - timedelta(days=18)).isoformat(),
                "effectiveDate": (TODAY - timedelta(days=18)).isoformat(),
                "endDate": (TODAY + timedelta(days=347)).isoformat(),
                "createdAt": (TODAY - timedelta(days=20)).isoformat(),
                "signer": "孙出海",
                "ourSignSubject": "纯蓝测试科技",
                "customerSignSubject": "测试已签约出海有限公司",
                "paymentPlans": [
                    {"name": "首款", "ratio": 50, "amount": 210000, "dueDate": (TODAY - timedelta(days=10)).isoformat()}
                ],
                "attachments": [],
            },
        },
    ]

    for c in contracts:
        cur.execute(
            """
            INSERT INTO crm_contracts
              (id, owner_user_id, customer_id, status, document, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              owner_user_id=VALUES(owner_user_id), customer_id=VALUES(customer_id),
              status=VALUES(status), document=VALUES(document), updated_at=VALUES(updated_at)
            """,
            (c["id"], c["owner"], c["customer_id"], c["status"], dumps(c["doc"]), NOW - timedelta(days=25), NOW),
        )

    # --- 项目（对应已签约合同）---
    proj_id = uid("proj-active")
    cur.execute(
        """
        INSERT INTO projects
          (id, name, customer_id, customer_name, source_contract_id, opportunity_id,
           stage, health, risk_level,
           biz_owner, biz_owner_user_id, project_manager, project_manager_user_id,
           executor, executor_user_id, content_ops, content_ops_user_id,
           contract_amount, customer_industry, customer_type, customer_region,
           project_types, intent_brand, intent_content, intent_search, platforms,
           kpi_notes, start_date, sow_end_date, delay_reason,
           created_at, updated_at, created_by, updated_by, archived_at)
        VALUES
          (%s,%s,%s,%s,%s,%s,
           %s,%s,%s,
           %s,%s,%s,%s,
           %s,%s,%s,%s,
           %s,%s,%s,%s,
           %s,%s,%s,%s,%s,
           %s,%s,%s,%s,
           %s,%s,%s,%s,NULL)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name), stage=VALUES(stage), health=VALUES(health),
          updated_at=VALUES(updated_at), contract_amount=VALUES(contract_amount)
        """,
        (
            proj_id,
            "出海签约-年度 GEO 交付",
            uid("cust-signed"),
            "测试已签约出海有限公司",
            ct_signed,
            opp_won,
            "active",
            "healthy",
            "low",
            "测试销售乙",
            sales2,
            "测试客户成功",
            cs,
            "测试客户成功",
            cs,
            "测试运营",
            user_id("ops"),
            420000.00,
            "科技互联网",
            "企业服务",
            "海外",
            dumps(["品牌GEO", "内容GEO"]),
            80,
            60,
            40,
            dumps(["ChatGPT", "Gemini", "Perplexity"]),
            "本地种子：关注品牌引用率与内容收录",
            TODAY - timedelta(days=15),
            TODAY + timedelta(days=250),
            "",
            NOW - timedelta(days=18),
            NOW,
            "测试销售乙",
            "测试客户成功",
        ),
    )

    note_id = uid("pnote-1")
    cur.execute(
        """
        INSERT INTO project_notes
          (id, project_id, kind, content, created_at, created_by, created_by_user_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE content=VALUES(content)
        """,
        (
            note_id,
            proj_id,
            "weekly",
            "本周完成站点诊断与关键词基线；下周进入内容试点。",
            NOW - timedelta(days=2),
            "测试客户成功",
            cs,
        ),
    )

    # 邀请链接（销售甲）
    invite_id = uid("invite-sales1")
    cur.execute(
        """
        INSERT INTO invites (id, token, staff_user_id, label, revoked_at, visit_count, created_at)
        VALUES (%s,%s,%s,%s,NULL,3,%s)
        ON DUPLICATE KEY UPDATE label=VALUES(label), visit_count=VALUES(visit_count)
        """,
        (invite_id, "dev-invite-sales1-token", sales1, "测试销售甲邀请链接", NOW - timedelta(days=7)),
    )

    # 轻量审计
    cur.execute(
        """
        INSERT INTO crm_audit_records
          (id, module, entity_type, entity_id, related_entity_ids, entity_name,
           action, actor, actor_user_id, timestamp_at, changes, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE action=VALUES(action)
        """,
        (
            "audit-dev-seed-1",
            "customers",
            "customer",
            cust_from_lead,
            dumps([lead_conv_id]),
            "测试转化客户股份有限公司",
            "seed.create",
            "测试管理员",
            user_id("admin"),
            NOW,
            dumps([{"field": "status", "to": "connected"}]),
            NOW,
        ),
    )

    # 通知
    cur.execute(
        """
        INSERT INTO crm_notifications
          (id, target_name, target_user_id, actor, actor_user_id, message, href, is_read, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s)
        ON DUPLICATE KEY UPDATE message=VALUES(message)
        """,
        (
            "ntf-dev-seed-1",
            "测试销售甲",
            sales1,
            "测试SDR",
            sdr,
            "【测试】已将「测试转化客户」转交给你跟进",
            f"/customers/{cust_from_lead}",
            NOW - timedelta(hours=6),
        ),
    )

    _ = (leader, presales)  # reserved for future expansions / lint


def write_department_labels(repo_root: str) -> str:
    """写入测试部门中文名映射，供 API 本地兜底。"""
    path = os.path.join(repo_root, "config", "feishu-department-labels.dev.json")
    labels = {dept_id(k): name for k, (_id, name) in DEPTS.items()}
    breadcrumbs = {
        dept_id("root"): "纯蓝测试科技",
        dept_id("sales"): "纯蓝测试科技 > 销售部",
        dept_id("sdr"): "纯蓝测试科技 > 销售部 > SDR组",
        dept_id("overseas"): "纯蓝测试科技 > 海外销售",
        dept_id("presales"): "纯蓝测试科技 > 售前顾问",
        dept_id("cs"): "纯蓝测试科技 > 客户成功",
        dept_id("ops"): "纯蓝测试科技 > 销售运营",
    }
    payload = {
        "_comment": "本地 geo_crm_dev 测试部门树；由 seed_dev_crm.py 生成",
        "labels": labels,
        "breadcrumbs": breadcrumbs,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return path


def bind_my_open_id(cur) -> str | None:
    """可选：把真实飞书 open_id 绑到某个测试账号，便于 OAuth 登录后直接看到种子数据。

    SEED_BIND_OPEN_ID=ou-xxxx
    SEED_BIND_USER_KEY=admin   # 默认 admin（data_scope=all）
    """
    real_open = (os.environ.get("SEED_BIND_OPEN_ID") or "").strip()
    key = (os.environ.get("SEED_BIND_USER_KEY") or "admin").strip()
    if not real_open:
        return None
    if not any(u["key"] == key for u in USERS):
        raise SystemExit(f"SEED_BIND_USER_KEY 无效: {key}")

    target_id = user_id(key)
    old_open = open_id(key)
    # 若真实 open_id 已被其他行占用，先挪走
    cur.execute("SELECT id FROM users WHERE feishu_open_id=%s AND id<>%s", (real_open, target_id))
    clash = cur.fetchone()
    if clash:
        cur.execute(
            "UPDATE users SET feishu_open_id=%s, updated_at=%s WHERE id=%s",
            (f"ou-dev-displaced-{clash[0][:8]}", NOW, clash[0]),
        )

    cur.execute(
        "UPDATE users SET feishu_open_id=%s, updated_at=%s WHERE id=%s",
        (real_open, NOW, target_id),
    )
    # 通讯录主键是 open_id：删旧插新
    cur.execute("SELECT name, job_title, department_ids, department_names FROM feishu_sales_contacts WHERE feishu_open_id=%s", (old_open,))
    row = cur.fetchone()
    cur.execute("DELETE FROM feishu_sales_contacts WHERE feishu_open_id IN (%s, %s)", (old_open, real_open))
    if row:
        cur.execute(
            """
            INSERT INTO feishu_sales_contacts
              (feishu_open_id, name, job_title, department_ids, department_names,
               is_active, synced_at, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s)
            """,
            (real_open, row[0], row[1], row[2], row[3], NOW, NOW, NOW),
        )
    return f"{key} → {real_open}"


def main() -> None:
    conn = connect()
    bound = None
    try:
        with conn.cursor() as cur:
            upsert_users(cur)
            bind_roles(cur)
            seed_crm(cur)
            bound = bind_my_open_id(cur)
        conn.commit()
    finally:
        conn.close()

    api_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    labels_path = write_department_labels(api_root)
    db = os.environ.get("MYSQL_DATABASE", "geo_crm_dev")
    print(f"seed_dev_crm OK → database={db}")
    print(f"  users={len(USERS)} leads/customers/opps/contracts/projects seeded")
    print("  客户样例含：多状态 / 多行业 / 销售甲批量分配素材 / Leader 自跟")
    print(f"  department labels → {labels_path}")
    if bound:
        print(f"  已绑定登录账号: {bound}")
    else:
        print("  提示: 设置 SEED_BIND_OPEN_ID=你的飞书open_id 可把「测试管理员」绑到你的登录身份")


if __name__ == "__main__":
    main()
