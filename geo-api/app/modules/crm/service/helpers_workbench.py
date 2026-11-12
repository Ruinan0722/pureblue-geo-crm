from __future__ import annotations

from typing import Any

from app.modules.crm.service.helpers_common import (
    _as_amount,
    _china_today_iso,
    _days_since,
    _follow_date_iso,
)


def _aggregate_lead_workbench(leads: list[dict[str, Any]]) -> dict[str, Any]:
    need = untouched = to_transfer = converted = invalid = 0
    for lead in leads:
        status = str(lead.get("status") or "")
        if status == "untouched":
            untouched += 1
        elif status == "converted":
            converted += 1
        elif status == "invalid":
            invalid += 1
        if status not in ("converted", "invalid") and str(lead.get("followState") or "") == "need":
            need += 1
        if status == "touched" and str(lead.get("level") or "") != "D":
            to_transfer += 1
    total = len(leads)
    return {
        "leads_total": total,
        "leads_need": need,
        "leads_untouched": untouched,
        "leads_to_transfer": to_transfer,
        "leads_converted": converted,
        "leads_invalid": invalid,
        "lead_rate": round((converted / total) * 100) if total else 0,
    }

def _aggregate_customer_workbench(
    customers: list[dict[str, Any]],
    *,
    today: str | None = None,
) -> dict[str, Any]:
    """
    customers_active：今日待跟进客户 = 下次计划跟进日 ≤ 今天（含逾期），且未流失。
    与提醒任务、客户详情里的 nextFollowAt（中国时区自然日）对齐。
    """
    day = (today or _china_today_iso()).strip()[:10]
    due = stale = cooperating = 0
    for customer in customers:
        status = str(customer.get("status") or "")
        if status == "cooperating":
            cooperating += 1
        if status in ("stopped", "lost"):
            continue
        follow_day = _follow_date_iso(customer.get("nextFollowAt"))
        if follow_day and follow_day <= day:
            due += 1
        if _days_since(customer.get("lastFollowAt")) > 14:
            stale += 1
    return {
        "customers_total": len(customers),
        "customers_active": due,
        "customers_stale": stale,
        "customers_cooperating": cooperating,
    }

def _aggregate_opportunity_workbench(
    opportunities: list[dict[str, Any]],
    *,
    today: str | None = None,
) -> dict[str, Any]:
    day = (today or _china_today_iso()).strip()[:10]
    active = follow_due = stale = lost_no_reason = signing = won = lost = 0
    month_expected = 0.0
    won_amount = 0.0
    for opp in opportunities:
        stage = str(opp.get("stage") or "")
        amount = _as_amount(opp.get("amount"))
        if stage not in ("won", "lost"):
            active += 1
            follow_day = _follow_date_iso(opp.get("nextFollowAt"))
            if follow_day and follow_day <= day:
                follow_due += 1
            if _days_since(opp.get("lastFollowAt")) > 7:
                stale += 1
        if stage == "lost":
            lost += 1
            if not str(opp.get("lostReason") or "").strip():
                lost_no_reason += 1
        elif stage == "signing":
            signing += 1
            month_expected += amount
        elif stage == "won":
            won += 1
            won_amount += amount
    return {
        "opps_total": len(opportunities),
        "opps_active": active,
        "opps_follow_due": follow_due,
        "opps_stale": stale,
        "opps_lost_no_reason": lost_no_reason,
        "opps_signing": signing,
        "opps_won": won,
        "opps_lost": lost,
        "month_expected": month_expected,
        "won_amount": won_amount,
    }

def _aggregate_contract_workbench(contracts: list[dict[str, Any]]) -> dict[str, Any]:
    signing = signed = pending = 0
    contract_amount = 0.0
    for contract in contracts:
        status = str(contract.get("status") or "")
        amount = _as_amount(contract.get("amount"))
        if status in ("signing", "pending"):
            signing += 1
        if status == "pending":
            pending += 1
        if status == "signed":
            signed += 1
            contract_amount += amount
    return {
        "signing_contracts": signing,
        "signed_contracts": signed,
        "contracts_total": len(contracts),
        "contracts_pending": pending,
        "contract_amount": contract_amount,
    }

def _aggregate_request_workbench(statuses: list[str]) -> dict[str, int]:
    pending = supplement = confirmed = 0
    for status in statuses:
        if status in ("submitted", "pending_review"):
            pending += 1
        elif status == "supplement":
            supplement += 1
        elif status in ("confirmed", "in_project"):
            confirmed += 1
    return {
        "req_pending": pending,
        "req_supplement": supplement,
        "req_confirmed": confirmed,
    }
