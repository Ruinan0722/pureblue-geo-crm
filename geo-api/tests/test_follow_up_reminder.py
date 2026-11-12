"""客户下次跟进到期提醒：幂等 id 与调度辅助。"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.follow_up_reminder_scheduler import _seconds_until_next_run
from app.modules.crm.service import CrmService

CHINA_TZ = ZoneInfo("Asia/Shanghai")


def test_follow_up_reminder_id_stable():
    a = CrmService.follow_up_reminder_id("c0123456789abcdef", "2026-07-20")
    b = CrmService.follow_up_reminder_id("c0123456789abcdef", "2026-07-20")
    c = CrmService.follow_up_reminder_id("c0123456789abcdef", "2026-07-21")
    assert a == b
    assert a != c
    assert a.startswith("ntf-fu-")
    assert len(a) <= 64


def test_opportunity_follow_up_reminder_id_stable():
    a = CrmService.opportunity_follow_up_reminder_id("o0123456789abcdef", "2026-07-20")
    b = CrmService.opportunity_follow_up_reminder_id("o0123456789abcdef", "2026-07-20")
    c = CrmService.opportunity_follow_up_reminder_id("o0123456789abcdef", "2026-07-21")
    assert a == b
    assert a != c
    assert a.startswith("ntf-fu-opp-")
    assert a != CrmService.follow_up_reminder_id("o0123456789abcdef", "2026-07-20")
    assert len(a) <= 64


def test_aggregate_opportunity_workbench_follow_due():
    from app.modules.crm.service import _aggregate_opportunity_workbench

    stats = _aggregate_opportunity_workbench(
        [
            {"stage": "contact", "nextFollowAt": "2026-07-20", "lastFollowAt": "2026-07-19", "amount": 1},
            {"stage": "signing", "nextFollowAt": "2026-07-18", "lastFollowAt": "2026-07-01", "amount": 2},
            {"stage": "contact", "nextFollowAt": "2026-07-25", "lastFollowAt": "2026-07-19", "amount": 3},
            {"stage": "won", "nextFollowAt": "2026-07-20", "lastFollowAt": "2026-07-19", "amount": 4},
            {"stage": "lost", "nextFollowAt": "2026-07-20", "lastFollowAt": "2026-07-19", "amount": 5},
        ],
        today="2026-07-20",
    )
    assert stats["opps_active"] == 3
    assert stats["opps_follow_due"] == 2
    assert stats["opps_won"] == 1
    assert stats["opps_lost"] == 1


def test_seconds_until_next_run_positive():
    wait = _seconds_until_next_run(hour=8)
    assert wait >= 1.0
    # 最长不超过约 24h + 缓冲
    assert wait <= 24 * 3600 + 60


def test_seconds_until_next_run_after_hour_targets_tomorrow(monkeypatch):
    fixed = datetime(2026, 7, 20, 9, 0, 0, tzinfo=CHINA_TZ)

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed.replace(tzinfo=None)
            return fixed.astimezone(tz)

    monkeypatch.setattr("app.core.follow_up_reminder_scheduler.datetime", _FixedDateTime)
    wait = _seconds_until_next_run(hour=8)
    # 9:00 → 次日 8:00 ≈ 23h
    assert 22 * 3600 <= wait <= 24 * 3600
    expected = datetime(2026, 7, 21, 8, 0, 0, tzinfo=CHINA_TZ)
    assert abs(wait - (expected - fixed).total_seconds()) < 2
