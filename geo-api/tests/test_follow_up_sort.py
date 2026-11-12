"""客户跟进统一时间线排序。"""

from app.modules.crm.service.helpers_common import _sort_follow_ups_newest_first


def test_sort_follow_ups_newest_first_handles_mixed_formats_and_invalid_dates():
    notes = [
        {"id": "invalid", "date": "未知"},
        {"id": "date-only", "date": "2026-08-10"},
        {"id": "newest", "date": "2026-08-11T09:30:00"},
        {"id": "older", "date": "2026/08/09 18:00"},
    ]

    result = _sort_follow_ups_newest_first(notes)

    assert [note["id"] for note in result] == ["newest", "date-only", "older", "invalid"]
    assert notes[0]["id"] == "invalid"


def test_sort_follow_ups_uses_id_as_stable_tie_breaker():
    notes = [
        {"id": "a", "date": "2026-08-11"},
        {"id": "b", "date": "2026-08-11"},
    ]

    assert [note["id"] for note in _sort_follow_ups_newest_first(notes)] == ["b", "a"]
