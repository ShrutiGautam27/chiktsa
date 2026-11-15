from typing import Literal

from pydantic import Field

from .common import APIModel, Name, TimeZone


class Accessibility(APIModel):
    fontScale: float = Field(1.0, ge=0.875, le=1.75)
    highContrast: bool = False
    simplifiedNav: bool = False
    voiceRate: float = Field(1.0, ge=0.5, le=1.5)
    reduceMotion: bool = False


class UserOut(APIModel):
    uid: str
    email: str
    displayName: str
    timezone: str
    locale: str
    platformRole: str = "user"
    accessibility: Accessibility = Accessibility()


class UserUpdate(APIModel):
    displayName: Name | None = None
    timezone: TimeZone | None = None
    locale: Literal["en", "hi"] | None = None
    accessibility: Accessibility | None = None


class MembershipSummary(APIModel):
    householdId: str
    householdName: str
    role: str
    roleLabel: str
    seniorScope: str | list[str]
    linkedSeniorId: str | None = None
    permissions: list[str]


class MeOut(APIModel):
    user: UserOut
    memberships: list[MembershipSummary]
