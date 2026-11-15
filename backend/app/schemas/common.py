from datetime import datetime
from typing import Annotated
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

_TZ = available_timezones()


def _tz(v: str) -> str:
    if v not in _TZ:
        raise ValueError("Unknown IANA time zone")
    return v


TimeZone = Annotated[str, AfterValidator(_tz)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class APIModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class Timestamps(APIModel):
    createdAt: datetime | None = None
    updatedAt: datetime | None = None
