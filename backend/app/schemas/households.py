from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field, field_validator

from ..core.rbac import Role
from .common import APIModel, Name, TimeZone

SeniorScope = Literal["all"] | list[str]


class HouseholdCreate(APIModel):
    name: Name
    timezone: TimeZone = "Asia/Kolkata"


class HouseholdUpdate(APIModel):
    name: Name | None = None
    timezone: TimeZone | None = None


class HouseholdOut(APIModel):
    id: str
    name: str
    timezone: str
    ownerId: str
    seniorCount: int = 0
    memberCount: int = 0
    myRole: str | None = None
    createdAt: datetime | None = None


class MemberOut(APIModel):
    uid: str
    householdId: str
    displayName: str
    email: str
    role: str
    roleLabel: str
    status: str
    seniorScope: SeniorScope
    linkedSeniorId: str | None = None
    expiresAt: datetime | None = None
    joinedAt: datetime | None = None


class MemberUpdate(APIModel):
    role: Role | None = None
    seniorScope: SeniorScope | None = None
    linkedSeniorId: str | None = None
    expiresAt: datetime | None = None
    clearExpiry: bool = False
    status: Literal["active", "suspended"] | None = None


class InvitationCreate(APIModel):
    email: EmailStr
    role: Role
    seniorScope: SeniorScope = "all"
    linkedSeniorId: str | None = None
    accessExpiresAt: datetime | None = Field(None, description="Optional temporary access end")

    @field_validator("role")
    @classmethod
    def not_owner(cls, v: Role) -> Role:
        if v == Role.HOUSEHOLD_OWNER:
            raise ValueError("Ownership cannot be granted by invitation")
        return v


class InvitationOut(APIModel):
    id: str
    token: str | None = None   # raw token: returned ONLY once, to the inviter, at creation
    householdId: str
    householdName: str
    email: str
    role: str
    roleLabel: str
    seniorScope: SeniorScope
    linkedSeniorId: str | None = None
    status: str
    invitedByName: str
    expiresAt: datetime
    createdAt: datetime


class AuditLogOut(APIModel):
    id: str
    actorUid: str
    actorName: str
    action: str
    targetType: str
    targetId: str
    seniorId: str | None = None
    summary: str
    changes: dict | None = None
    at: datetime
