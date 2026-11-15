"""Time helpers. All persisted timestamps are timezone-aware UTC.

`set_clock()` lets tests freeze time; production never calls it.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

_frozen: datetime | None = None


def now() -> datetime:
    return _frozen if _frozen is not None else datetime.now(timezone.utc)


def set_clock(dt: datetime | None) -> None:
    global _frozen
    _frozen = aware(dt) if dt else None


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def local_to_utc(day: date, hhmm: str, tz: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.combine(day, time(h, m), tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)


def local_date(dt: datetime, tz: str) -> date:
    return aware(dt).astimezone(ZoneInfo(tz)).date()


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)
