from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache


FIXED_HOLIDAYS = (
    (1, 1),   # Nowy Rok
    (1, 6),   # Trzech Króli
    (5, 1),   # Święto Pracy
    (5, 3),   # Święto Konstytucji 3 Maja
    (8, 15),  # Wniebowzięcie Najświętszej Maryi Panny
    (11, 1),  # Wszystkich Świętych
    (11, 11), # Święto Niepodległości
    (12, 25), # Boże Narodzenie (pierwszy dzień)
    (12, 26), # Boże Narodzenie (drugi dzień)
)


@dataclass(frozen=True)
class WorkingDayConfig:
    weekend_days: tuple[int, int] = (5, 6)  # sobota=5, niedziela=6


def _calculate_easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


@lru_cache(maxsize=16)
def _polish_holidays(year: int) -> set[date]:
    holidays = {date(year, month, day) for month, day in FIXED_HOLIDAYS}
    easter = _calculate_easter_sunday(year)
    holidays.add(easter)  # Wielkanoc (niedziela) – rzadko biznesowo, ale zachowujemy
    holidays.add(easter + timedelta(days=1))  # Poniedziałek Wielkanocny
    holidays.add(easter + timedelta(days=49))  # Zesłanie Ducha Świętego
    holidays.add(easter + timedelta(days=60))  # Boże Ciało
    return holidays


def is_business_day(value: date, config: WorkingDayConfig | None = None) -> bool:
    cfg = config or WorkingDayConfig()
    if value.weekday() in cfg.weekend_days:
        return False
    return value not in _polish_holidays(value.year)


def shift_to_business_day(value: date, config: WorkingDayConfig | None = None) -> date:
    cfg = config or WorkingDayConfig()
    current = value
    # In the unlikely event of a full year of non-working days, cap iterations.
    for _ in range(370):
        if is_business_day(current, cfg):
            return current
        current += timedelta(days=1)
    return value
