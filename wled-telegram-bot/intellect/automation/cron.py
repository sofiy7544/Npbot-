"""
cron.py — минимальный разбор 5-польного cron без внешних зависимостей.

Поля: минута час день-месяца месяц день-недели.
Поддержка: *, списки (1,2,3), диапазоны (1-5), шаги (*/5, 10-20/2).
День недели: 0 и 7 = воскресенье.
"""
from __future__ import annotations

from datetime import datetime, timedelta


def _parse_field(field: str, lo: int, hi: int) -> set[int]:
    values: set[int] = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = int(step_s)
        if part in ("*", ""):
            start, end = lo, hi
        elif "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
        else:
            start = end = int(part)
        for v in range(start, end + 1, step):
            if lo <= v <= hi:
                values.add(v)
    return values


def cron_matches(cron: str, dt: datetime) -> bool:
    """Совпадает ли момент dt с cron-выражением (с точностью до минуты)."""
    try:
        minute, hour, dom, month, dow = cron.split()
    except ValueError:
        return False
    m = _parse_field(minute, 0, 59)
    h = _parse_field(hour, 0, 23)
    d = _parse_field(dom, 1, 31)
    mo = _parse_field(month, 1, 12)
    wd = _parse_field(dow, 0, 7)
    # 0 и 7 — воскресенье
    weekday = (dt.weekday() + 1) % 7  # Python: Пн=0 → cron: Вс=0
    if 7 in wd:
        wd.add(0)
    return (dt.minute in m and dt.hour in h and dt.month in mo
            and dt.day in d and weekday in wd)


def next_run_after(cron: str, after: datetime, *, horizon_minutes: int = 366 * 24 * 60):
    """Ближайший момент после `after`, когда сработает cron (или None)."""
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(horizon_minutes):
        if cron_matches(cron, t):
            return t
        t += timedelta(minutes=1)
    return None
