#!/usr/bin/env python3
"""数据看板验收数据（幂等、固定 demo-dash-* ID、仅允许非生产环境）。"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymysql
from sqlalchemy.engine import make_url

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    if settings.app_env == "production":
        raise RuntimeError("禁止向生产环境写入看板演示数据")
    url = make_url(settings.database_url)
    conn = pymysql.connect(
        host=url.host or "127.0.0.1", port=url.port or 3306, user=url.username or "",
        password=url.password or "", database=url.database or "", charset="utf8mb4", autocommit=False,
    )
    now = datetime.now().replace(microsecond=0)
    month_start = now.replace(day=1, hour=9, minute=0, second=0)
    today = date.today()
    owners = ["项目验证管理员", "演示成员06", "演示成员11", "演示成员16", "演示成员01"]
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id,name FROM users WHERE name IN (%s,%s,%s,%s,%s)", owners)
            user_ids = {name: user_id for user_id, name in cur.fetchall()}
            fallback = next(iter(user_ids.values()), None)
            if not fallback:
                raise RuntimeError("请先使用任一内部测试身份登录 CRM")

            sources = ["自拓", "官网注册", "内容营销", "机构引荐"]
            regions = ["华北区", "华东区", "华南区"]
            companies = [
                "看板演示·北辰智能科技", "看板演示·东海数字商业", "看板演示·南方新能源",
                "看板演示·云峰医疗", "看板演示·远航制造", "看板演示·青藤消费",
                "看板演示·星河软件", "看板演示·蓝湾文旅", "看板演示·锐智机器人",
                "看板演示·澄明咨询", "看板演示·未来材料", "看板演示·海岳汽车",
            ]
            customer_ids: list[str] = []
            lead_ids: list[str] = []
            for i, company in enumerate(companies, 1):
                owner = owners[(i - 1) % len(owners)]
                owner_id = user_ids.get(owner, fallback)
                created = month_start + timedelta(days=min(i * 2 - 1, max(today.day - 1, 1)), hours=i % 7)
                lead_id = f"demo-dash-lead-{i:02d}"
                customer_id = f"demo-dash-customer-{i:02d}"
                coverage_id = f"demo-dash-coverage-{i:02d}"
                lead_ids.append(lead_id); customer_ids.append(customer_id)
                lead_status = "converted" if i <= 8 else ("invalid" if i == 12 else "touched")
                cur.execute(
                    """INSERT INTO crm_leads
                    (id,owner_user_id,status,company_name,source,source_detail,level,region,contact_name,follow_state,
                     brand_name,sdr,sales,created_day,first_contact_date,contact_title,contact_phone,email,city,
                     converted_customer_id,created_at,updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE owner_user_id=VALUES(owner_user_id),status=VALUES(status),source=VALUES(source),
                    region=VALUES(region),sales=VALUES(sales),created_day=VALUES(created_day),created_at=VALUES(created_at),
                    converted_customer_id=VALUES(converted_customer_id),updated_at=VALUES(updated_at)""",
                    (lead_id, owner_id, lead_status, company, sources[(i - 1) % 4], f"看板渠道-{i}", ["A", "B", "C"][i % 3],
                     regions[(i - 1) % 3], f"联系人{i}", "converted" if i <= 8 else "need", company.replace("看板演示·", ""),
                     "演示成员04", owner, created.date(), created.date(), "市场负责人", f"1380000{i:04d}", f"dash{i}@example.com",
                     ["北京", "上海", "深圳"][(i - 1) % 3], customer_id if i <= 8 else None, created, now),
                )
                cur.execute(
                    """INSERT INTO lead_notes
                    (id,lead_id,author,content,date,follow_type,wechat_added,sort_order)
                    VALUES (%s,%s,%s,%s,%s,'phone',0,0)
                    ON DUPLICATE KEY UPDATE author=VALUES(author),content=VALUES(content),date=VALUES(date)""",
                    (f"demo-dash-lead-note-{i:02d}", lead_id, owner, "看板演示跟进：已完成首次需求沟通", created + timedelta(days=1)),
                )
                if i <= 8:
                    status = ["awaiting_contact", "connected", "opportunity_following", "cooperating"][i % 4]
                    cur.execute(
                        """INSERT INTO crm_customers
                        (id,owner_user_id,status,company_name,company_uid,region,brand_name,city,industry_l1,industry_l2,
                         scale,nature,source,owner,created_by_user_id,created_day,created_at,updated_at,in_public_pool)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)
                        ON DUPLICATE KEY UPDATE owner_user_id=VALUES(owner_user_id),status=VALUES(status),region=VALUES(region),
                        source=VALUES(source),owner=VALUES(owner),created_day=VALUES(created_day),created_at=VALUES(created_at),updated_at=VALUES(updated_at)""",
                        (customer_id, owner_id, status, company, f"DASH-{i:03d}", regions[(i - 1) % 3], company.replace("看板演示·", ""),
                         ["北京", "上海", "深圳"][(i - 1) % 3], ["人工智能", "企业服务", "新能源"][i % 3], "看板演示",
                         "100-300 人", "民营企业", sources[(i - 1) % 4], owner, owner_id, created.date(), created, now),
                    )
                    cur.execute(
                        """INSERT INTO crm_sales_coverages
                        (id,customer_id,owner_user_id,status,owner_name,client_dept,last_follow_at,next_follow_at,is_key,created_at,updated_at)
                        VALUES (%s,%s,%s,%s,%s,'市场部',%s,%s,%s,%s,%s)
                        ON DUPLICATE KEY UPDATE status=VALUES(status),owner_name=VALUES(owner_name),last_follow_at=VALUES(last_follow_at),updated_at=VALUES(updated_at)""",
                        (coverage_id, customer_id, owner_id, status, owner, (created + timedelta(days=2)).date(),
                         (created + timedelta(days=8)).date(), i in {1, 4, 7}, created, now),
                    )
                    cur.execute(
                        """INSERT INTO crm_follow_ups
                        (id,coverage_id,customer_id,author,content,follow_type,wechat_added,created_at,updated_at)
                        VALUES (%s,%s,%s,%s,%s,'meeting',0,%s,%s)
                        ON DUPLICATE KEY UPDATE author=VALUES(author),content=VALUES(content),created_at=VALUES(created_at),updated_at=VALUES(updated_at)""",
                        (f"demo-dash-follow-{i:02d}", coverage_id, customer_id, owner, "看板演示跟进：完成方案沟通并确认下一步", created + timedelta(days=2), now),
                    )

            stages = ["contact", "demand_research", "demand_diagnosis", "solution_confirm", "business_negotiation", "bidding", "signing", "won", "lost", "won", "business_negotiation", "solution_confirm"]
            opp_ids: list[str] = []
            for i, stage in enumerate(stages, 1):
                owner = owners[(i - 1) % len(owners)]; owner_id = user_ids.get(owner, fallback)
                created = month_start + timedelta(days=min(i * 2 - 1, max(today.day - 1, 1)), hours=1)
                opp_id = f"demo-dash-opp-{i:02d}"; opp_ids.append(opp_id)
                customer_id = customer_ids[(i - 1) % 8]
                cur.execute(
                    """INSERT INTO crm_opportunities
                    (id,owner_user_id,customer_id,stage,amount,expected_sign_date,last_follow_at,name,brand_name,region,
                     geo_source,goal,platform,period,probability,owner,created_day,created_at,updated_at,lost_reason,lost_reason_l1)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'domestic','品牌增长','DeepSeek / 豆包','3个月',%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE owner_user_id=VALUES(owner_user_id),stage=VALUES(stage),amount=VALUES(amount),
                    owner=VALUES(owner),region=VALUES(region),created_day=VALUES(created_day),created_at=VALUES(created_at),updated_at=VALUES(updated_at)""",
                    (opp_id, owner_id, customer_id, stage, 80000 + i * 25000, today + timedelta(days=20),
                     (created + timedelta(days=3)).date(), f"看板演示商机 {i:02d}", f"演示品牌{i}", regions[(i - 1) % 3],
                     min(15 + i * 7, 95), owner, created.date(), created, now,
                     "客户预算调整" if stage == "lost" else None, "预算原因" if stage == "lost" else None),
                )
                history_stages = ["contact", "demand_research", "demand_diagnosis", "solution_confirm", "business_negotiation", "bidding", "signing", "won"]
                final_index = history_stages.index(stage) if stage in history_stages else min(i % 5, 4)
                for j, hist_stage in enumerate(history_stages[: final_index + 1]):
                    entered = created + timedelta(days=j * 2)
                    left = entered + timedelta(days=2) if j < final_index else None
                    cur.execute(
                        """INSERT INTO opportunity_stage_history
                        (id,opportunity_id,stage,entered_at,left_at,reason,change_type,sort_order)
                        VALUES (%s,%s,%s,%s,%s,'看板演示阶段推进','advance',%s)
                        ON DUPLICATE KEY UPDATE stage=VALUES(stage),entered_at=VALUES(entered_at),left_at=VALUES(left_at),reason=VALUES(reason)""",
                        (f"demo-dash-hist-{i:02d}-{j:02d}", opp_id, hist_stage, entered, left, j),
                    )
                cur.execute(
                    """INSERT INTO opportunity_notes
                    (id,opportunity_id,kind,author,content,date,follow_type,wechat_added,sort_order)
                    VALUES (%s,%s,'sales',%s,'看板演示跟进：客户已确认方案方向',%s,'meeting',0,0)
                    ON DUPLICATE KEY UPDATE author=VALUES(author),content=VALUES(content),date=VALUES(date)""",
                    (f"demo-dash-opp-note-{i:02d}", opp_id, owner, created + timedelta(days=3)),
                )

            contract_ids: list[str] = []
            for i in range(1, 9):
                owner = owners[(i - 1) % len(owners)]; owner_id = user_ids.get(owner, fallback)
                signed = i <= 6; status = "signed" if signed else ("pending" if i == 7 else "terminated")
                signed_at = month_start + timedelta(days=min(i * 3, max(today.day - 1, 1)), hours=2)
                contract_id = f"demo-dash-contract-{i:02d}"; contract_ids.append(contract_id)
                amount = 120000 + i * 60000
                cur.execute(
                    """INSERT INTO crm_contracts
                    (id,owner_user_id,customer_id,status,amount,project_status,type,sign_type,source,code,name,company,region,city,
                     geo_source,signer,sign_subject,our_sign_subject,customer_sign_subject,signer_manager,dept,valid_months,
                     effective_date,dual_sign_date,end_date,opportunity_id,owner,created_day,created_at,updated_at)
                    VALUES (%s,%s,%s,%s,%s,'not_started','销售合同','新签','商机转合同',%s,%s,%s,%s,%s,'domestic',%s,%s,'纯蓝科技',%s,'测试销售Leader','销售部',12,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE owner_user_id=VALUES(owner_user_id),status=VALUES(status),amount=VALUES(amount),
                    region=VALUES(region),owner=VALUES(owner),effective_date=VALUES(effective_date),dual_sign_date=VALUES(dual_sign_date),
                    end_date=VALUES(end_date),created_day=VALUES(created_day),created_at=VALUES(created_at),updated_at=VALUES(updated_at)""",
                    (contract_id, owner_id, customer_ids[(i - 1) % 8], status, amount, f"DASH-202608-{i:03d}",
                     f"看板演示合同 {i:02d}", companies[(i - 1) % 8], regions[(i - 1) % 3], ["北京", "上海", "深圳"][(i - 1) % 3],
                     owner, companies[(i - 1) % 8], companies[(i - 1) % 8], signed_at.date(), signed_at.date(),
                     (today + timedelta(days=(i - 4) * 3)) if i in {4, 5, 6} else (today + timedelta(days=180 + i)),
                     opp_ids[(i + 6) % len(opp_ids)], owner, signed_at.date(), signed_at, now),
                )
                if signed:
                    for period in (1, 2):
                        planned = amount / 2
                        planned_date = today - timedelta(days=20 - i * 2) if period == 1 else today + timedelta(days=8 + i)
                        if period == 1 and i <= 3: actual = planned
                        elif period == 1: actual = planned * 0.4
                        else: actual = 0
                        cur.execute(
                            """INSERT INTO crm_payment_plans
                            (id,contract_id,period_index,period_name,planned_amount,planned_date,invoice_status,invoice_date,
                             invoice_amount,actual_payment_date,actual_amount,created_by_user_id,created_by,updated_by,created_at,updated_at)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'看板演示','看板演示',%s,%s)
                            ON DUPLICATE KEY UPDATE planned_amount=VALUES(planned_amount),planned_date=VALUES(planned_date),
                            invoice_status=VALUES(invoice_status),invoice_date=VALUES(invoice_date),invoice_amount=VALUES(invoice_amount),
                            actual_payment_date=VALUES(actual_payment_date),actual_amount=VALUES(actual_amount),updated_at=VALUES(updated_at)""",
                            (f"demo-dash-plan-{i:02d}-{period:02d}", contract_id, period, f"第{period}期", planned, planned_date,
                             "invoiced" if period == 1 else "uninvoiced", planned_date - timedelta(days=3) if period == 1 else None,
                             planned if period == 1 else None, planned_date if actual > 0 else None, actual, owner_id, signed_at, now),
                        )
            conn.commit()
            print(f"seed_dashboard_demo OK leads={len(companies)} customers=8 opportunities={len(stages)} contracts=8 payment_plans=12")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
