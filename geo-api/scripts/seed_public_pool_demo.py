#!/usr/bin/env python3
"""本地公海池验收数据：10 家客户，带联系人和跟进记录。

脚本只允许在非生产环境运行；如果已有本批 demo ID 则直接退出，不覆盖用户的验收操作。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymysql
from sqlalchemy.engine import make_url

from app.config import get_settings


DEMO_CUSTOMERS = [
    ("测试·北京星河智能科技有限公司", "华北区", "北京市", "人工智能", "企业服务", "自拓", ""),
    ("测试·天津海蓝新材料有限公司", "华北区", "天津市", "制造业", "新材料", "展会", "2026 中国制造展"),
    ("测试·石家庄远景医疗科技有限公司", "华北区", "石家庄市", "医疗健康", "医疗器械", "转介", "老客户转介"),
    ("测试·青岛云帆海洋装备有限公司", "华北区", "青岛市", "工业制造", "高端装备", "官网留资", "国内官网"),
    ("测试·上海浦江数字商业有限公司", "华东区", "上海市", "互联网", "企业 SaaS", "自拓", ""),
    ("测试·杭州青藤品牌管理有限公司", "华东区", "杭州市", "消费零售", "品牌服务", "沙龙", "GEO 品牌增长沙龙"),
    ("测试·苏州精工自动化有限公司", "华东区", "苏州市", "工业制造", "自动化", "市场活动", "智能制造交流会"),
    ("测试·深圳前海跨境科技有限公司", "华南区", "深圳市", "跨境电商", "电商服务", "自拓", ""),
    ("测试·广州粤创新能源有限公司", "华南区", "广州市", "新能源", "储能", "展会", "2026 粤港澳能源展"),
    ("测试·厦门鹭岛文旅集团有限公司", "华南区", "厦门市", "文旅", "旅游服务", "合作伙伴", "生态伙伴推荐"),
]


def main() -> None:
    settings = get_settings()
    if settings.app_env == "production":
        raise RuntimeError("禁止向生产环境写入 demo 公海池数据")

    url = make_url(settings.database_url)
    conn = pymysql.connect(
        host=url.host or "127.0.0.1",
        port=url.port or 3306,
        user=url.username or "",
        password=url.password or "",
        database=url.database or "",
        charset="utf8mb4",
        autocommit=False,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM crm_public_pool_entries WHERE id LIKE 'demo-pp-entry-%'"
            )
            if int(cur.fetchone()[0] or 0) > 0:
                print("本批公海池 demo 数据已存在，未重置已有操作。")
                return

            cur.execute(
                """
                SELECT id, name FROM users
                WHERE role = 'sales' AND role_source = 'dev'
                ORDER BY updated_at DESC LIMIT 1
                """
            )
            seller = cur.fetchone()
            if not seller:
                raise RuntimeError("请先在本地 CRM 使用任一销售测试身份登录一次")
            seller_id, seller_name = seller

            # 让当前已创建的本地销售身份可验收华北区认领。
            cur.execute(
                """
                UPDATE users
                SET department_names = %s, updated_at = UTC_TIMESTAMP()
                WHERE id = %s
                """,
                (json.dumps(["销售管理中心 > 直销华北 > 华北"], ensure_ascii=False), seller_id),
            )

            now = datetime.utcnow()
            for index, row in enumerate(DEMO_CUSTOMERS, start=1):
                company, region, city, industry_l1, industry_l2, source, source_detail = row
                customer_id = f"demo-pp-customer-{index:02d}"
                coverage_id = f"demo-pp-coverage-{index:02d}"
                contact_id = f"demo-pp-contact-{index:02d}"
                follow_id = f"demo-pp-follow-{index:02d}"
                entry_id = f"demo-pp-entry-{index:02d}"
                released_at = now - timedelta(hours=11 - index)
                founded_year = 2012 + index
                credit_code = f"91310000DEMO{index:06d}"

                cur.execute(
                    """
                    INSERT INTO crm_customers
                      (id, owner_user_id, status, company_name, created_at, updated_at,
                       credit_code, region, brand_name, owner, industry_l1, created_by_user_id,
                       company_uid, city, industry_l2, scale, nature, source, source_detail,
                       founded_date, registered_capital, annual_revenue, created_day, in_public_pool)
                    VALUES
                      (%s, NULL, 'potential', %s, %s, %s, %s, %s, %s, NULL, %s, %s,
                       %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
                    """,
                    (
                        customer_id, company, now - timedelta(days=30), now, credit_code,
                        region, company.replace("测试·", "").replace("有限公司", ""),
                        industry_l1, seller_id, f"DEMO-POOL-{index:03d}", city, industry_l2,
                        ["20-50 人", "50-100 人", "100-300 人"][index % 3],
                        "民营企业", source, source_detail,
                        f"{founded_year}-0{(index % 9) + 1}-15", 500 + index * 350,
                        1800 + index * 620, (now - timedelta(days=30)).date(),
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO crm_sales_coverages
                      (id, customer_id, owner_user_id, status, created_at, updated_at,
                       owner_name, last_follow_at, next_follow_at, is_key, client_dept)
                    VALUES (%s, %s, %s, 'connected', %s, %s, NULL, %s, NULL, 0, %s)
                    """,
                    (
                        coverage_id, customer_id, f"pool-{entry_id}", now - timedelta(days=30),
                        now, (now - timedelta(days=3)).date(), "市场部",
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO crm_contacts
                      (id, coverage_id, customer_id, name, title, phone, wechat, email,
                       status, is_primary, active, wechat_added, source, source_detail,
                       created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                            'connected', 1, 1, 1, %s, %s, %s, %s)
                    """,
                    (
                        contact_id, coverage_id, customer_id, f"测试联系人{index:02d}",
                        "市场负责人", f"1380000{1000 + index:04d}", f"demo_wechat_{index:02d}",
                        f"contact{index:02d}@example.test", source, source_detail,
                        now - timedelta(days=20), now,
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO crm_follow_ups
                      (id, coverage_id, customer_id, author, content, follow_type,
                       wechat_added, mentions, next_follow_at, created_at, updated_at,
                       contact_id, contact_name, origin)
                    VALUES (%s, %s, %s, %s, %s, 'wechat', 1, NULL, NULL, %s, %s, %s, %s, 'manual')
                    """,
                    (
                        follow_id, coverage_id, customer_id, seller_name,
                        "测试跟进记录：已初步了解 GEO 需求，暂时释放至公海等待后续认领。",
                        now - timedelta(days=3), now - timedelta(days=3), contact_id,
                        f"测试联系人{index:02d}",
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO crm_public_pool_entries
                      (id, customer_id, coverage_id, region, status, release_reason,
                       released_by_user_id, released_by, released_at, claimed_by_user_id,
                       claimed_by, claimed_at, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'available', %s, %s, %s, %s,
                            NULL, NULL, NULL, %s, %s)
                    """,
                    (
                        entry_id, customer_id, coverage_id, region,
                        "测试数据：暂无明确跟进计划，释放至公海。",
                        seller_id, seller_name, released_at, released_at, released_at,
                    ),
                )

            conn.commit()
            print("已新增 10 条公海池验收数据：华北 4、华东 3、华南 3。")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
