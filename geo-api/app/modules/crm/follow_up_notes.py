"""飞书跟进记录按日期拆条。

有明确跟进日期的段落拆成多条；无日期则保持一条。
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any
from uuid import uuid4

# 完整年月日（优先匹配）
_RE_FULL = re.compile(
    r"(?P<y>20\d{2})\s*[-/.年]\s*(?P<m>\d{1,2})\s*[-/.月]\s*(?P<d>\d{1,2})\s*日?"
)
# 中文月日
_RE_MD_CN = re.compile(r"(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*[日号]")
# M.D / M.D日（避免 1.5万 等金额）
_RE_MD_DOT = re.compile(
    r"(?<![\d.])(?P<m>0?[1-9]|1[0-2])\.(?P<d>0?[1-9]|[12]\d|3[01])日?"
    r"(?!(?:[万千亿%％]|月))"
    r"(?=(?:[，,、：:\s]|[\u4e00-\u9fff]))"
)
# MMDD：0114 / 0526- / 0612：/ 0605已…（飞书常见简写）
_RE_MMDD = re.compile(
    r"(?<!\d)(?P<m>0[1-9]|1[0-2])(?P<d>0[1-9]|[12]\d|3[01])(?!\d)"
    r"(?=(?:[-—–：:\s]|[\u4e00-\u9fff]))"
)

# 日期前不应是这些词（避免「预计5月7日」误拆）
_BAD_PREFIX = ("预计", "计划", "约到", "等到", "截至", "截止", "延至", "改到", "到", "至", "从", "前", "后")


def _valid_ymd(y: int, m: int, d: int) -> bool:
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def _fallback_year(fallback_date: str | None) -> int:
    text = (fallback_date or "").strip()
    if len(text) >= 4 and text[:4].isdigit():
        y = int(text[:4])
        if 2000 <= y <= 2100:
            return y
    return datetime.now().year


def _is_bad_prefix(text: str, start: int) -> bool:
    before = text[max(0, start - 4) : start]
    return any(before.endswith(p) for p in _BAD_PREFIX)


def _find_date_spans(text: str) -> list[tuple[int, int, int, int, int]]:
    """返回 (start, end, year_or_0, month, day)，year_or_0=0 表示仅月日。"""
    hits: list[tuple[int, int, int, int, int]] = []
    occupied: list[tuple[int, int]] = []

    def overlaps(a: int, b: int) -> bool:
        return any(not (b <= s or a >= e) for s, e in occupied)

    for rx, has_year in (
        (_RE_FULL, True),
        (_RE_MD_CN, False),
        (_RE_MD_DOT, False),
        (_RE_MMDD, False),
    ):
        for m in rx.finditer(text):
            if overlaps(m.start(), m.end()):
                continue
            if _is_bad_prefix(text, m.start()):
                continue
            # 行首 / 文首 / 空白换行后，或单行多段跟进中的日期锚点
            if (
                m.start() > 0
                and (prev := text[m.start() - 1]) not in "\n\r\t ，,、；;。"
                # 允许紧贴中文后的月日/MMDD（如 跟进6.3 / 沟通0225-）
                and not (prev >= "\u4e00" and prev <= "\u9fff" and not has_year)
                and prev not in " "
                and not (prev >= "\u4e00" and prev <= "\u9fff")
            ):
                continue
            y = int(m.group("y")) if has_year else 0
            mo = int(m.group("m"))
            d = int(m.group("d"))
            if has_year and not _valid_ymd(y, mo, d):
                continue
            if not has_year and not (1 <= mo <= 12 and 1 <= d <= 31):
                continue
            # 排除 0231 等非法月日（用闰年无关的 2001 更稳）
            if not has_year and not _valid_ymd(2000, mo, d) and not _valid_ymd(2001, mo, d):
                continue
            hits.append((m.start(), m.end(), y, mo, d))
            occupied.append((m.start(), m.end()))

    hits.sort(key=lambda x: x[0])
    return hits


def _resolve_years(
    hits: list[tuple[int, int, int, int, int]],
    *,
    default_year: int,
) -> list[tuple[int, int, int, int, int]]:
    """为仅有月日的命中补年份；文本多为新→旧，月变大时年份减一。"""
    out: list[tuple[int, int, int, int, int]] = []
    last_y: int | None = None
    last_m: int | None = None
    for start, end, y, m, d in hits:
        if y:
            year = y
        else:
            year = last_y if last_y is not None else default_year
            if last_y is not None and last_m is not None and m > last_m + 2:
                # 例如上条 4 月、本条 12 月（继续往旧翻）→ 年份 -1
                year = last_y - 1
            if not _valid_ymd(year, m, d) and _valid_ymd(default_year, m, d):
                year = default_year
        if not _valid_ymd(year, m, d):
            # 跳过非法日（如 2月31）
            continue
        out.append((start, end, year, m, d))
        last_y, last_m = year, m
    return out


def split_follow_up_text(
    text: str,
    *,
    fallback_date: str | None = None,
) -> list[dict[str, str]]:
    """将跟进原文拆成 [{date, content}, ...]。

    - 无日期锚点：整段一条，date=fallback_date
    - 有日期：每个日期起一段；文首无日期前缀单独成条（用 fallback_date）
    """
    raw = (text or "").strip()
    if not raw:
        return []

    default_year = _fallback_year(fallback_date)
    fb = (fallback_date or "").strip()[:10] or date.today().isoformat()

    hits = _resolve_years(_find_date_spans(raw), default_year=default_year)
    if not hits:
        return [{"date": fb, "content": raw}]

    parts: list[dict[str, str]] = []
    first_start = hits[0][0]
    if first_start > 0:
        preface = raw[:first_start].strip()
        if preface:
            parts.append({"date": fb, "content": preface})

    for i, (start, _end, y, m, d) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(raw)
        content = raw[start:end].strip()
        if not content:
            continue
        parts.append({"date": f"{y:04d}-{m:02d}-{d:02d}", "content": content})

    return parts or [{"date": fb, "content": raw}]


def build_follow_up_notes(
    text: str,
    *,
    author: str,
    fallback_date: str | None = None,
    id_prefix: str = "n",
    origin: str | None = None,
    extra: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """拆条并生成 CRM note 文档列表。"""
    segments = split_follow_up_text(text, fallback_date=fallback_date)
    notes: list[dict[str, Any]] = []
    for i, seg in enumerate(segments):
        note: dict[str, Any] = {
            "id": f"{id_prefix}-{uuid4().hex[:12]}",
            "author": author or "飞书导入",
            "content": seg["content"],
            "date": seg["date"],
            "mentions": [],
        }
        if origin:
            note["origin"] = origin
        if extra:
            for k, v in extra.items():
                if v is not None and k not in note:
                    note[k] = v
        notes.append(note)
    return notes
