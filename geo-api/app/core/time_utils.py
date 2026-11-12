from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

CHINA_TZ = ZoneInfo("Asia/Shanghai")


def china_now() -> datetime:
    """当前中国时区时间（naive，与 Next.js 库表字符串一致）。"""
    return datetime.now(CHINA_TZ).replace(tzinfo=None)


def utc_now() -> datetime:
    """兼容旧调用方；新写入统一使用中国时区。"""
    return china_now()


def format_legacy_time(dt: datetime | None = None) -> str:
    """与现有 Next.js 库兼容的时间字符串（中国时区）。"""
    value = dt or china_now()
    return value.strftime("%Y-%m-%d %H:%M:%S")
