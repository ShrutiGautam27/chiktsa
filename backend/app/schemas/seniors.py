from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from .common import APIModel, Name, ShortText, TimeZone

Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9 ()-]{6,20}$")]


class EmergencyContact(APIModel):
    name: Name
    relationship: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""
    phone: Phone


class SeniorBase(APIModel):
    fullName: Name
    preferredName: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""
    dateOfBirth: date | None = None
    gender: Literal["female", "male", "other", "undisclosed"] = "undisclosed"
    primaryLanguage: Literal["en", "hi"] = "en"
    timezone: TimeZone | None = None
    notes: ShortText = ""
    emergencyContacts: list[EmergencyContact] = Field(default_factory=list, max_length=10)


class SeniorCreate(SeniorBase):
    pass


class SeniorUpdate(APIModel):
    fullName: Name | None = None
    preferredName: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    dateOfBirth: date | None = None
    gender: Literal["female", "male", "other", "undisclosed"] | None = None
    primaryLanguage: Literal["en", "hi"] | None = None
    timezone: TimeZone | None = None
    notes: ShortText | None = None
    emergencyContacts: list[EmergencyContact] | None = Field(None, max_length=10)


class SeniorOut(SeniorBase):
    id: str
    householdId: str
    status: str
    age: int | None = None
    createdAt: datetime | None = None
    updatedAt: datetime | None = None
