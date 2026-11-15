"""Role-based + profile-scoped access control with tenant isolation.

Every service call that touches household data MUST go through `authorize()`. Effective access is:

    role permissions  ∩  senior scope  ∩  membership active  ∩  not expired

Non-members receive NotFound (we do not reveal that a household exists). Members lacking a
permission receive Forbidden. Platform administrators get NO implicit access to care records.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..db import Store
from .errors import Forbidden, NotFound
from .timeutil import aware, now


class Role(str, Enum):
    HOUSEHOLD_OWNER = "household_owner"
    FAMILY_ADMIN = "family_admin"
    FAMILY_MEMBER = "family_member"
    PRIMARY_CAREGIVER = "primary_caregiver"
    SECONDARY_CAREGIVER = "secondary_caregiver"
    ORG_ADMIN = "org_admin"
    SENIOR = "senior"


class P(str, Enum):
    HOUSEHOLD_READ = "household.read"
    HOUSEHOLD_MANAGE = "household.manage"
    MEMBERS_READ = "members.read"
    MEMBERS_MANAGE = "members.manage"
    SENIORS_MANAGE = "seniors.manage"          # create / edit / archive profiles
    SENIOR_READ = "senior.read"                # basic profile
    SENIOR_MEDICAL_READ = "senior.medical.read"
    SENIOR_MEDICAL_WRITE = "senior.medical.write"
    MEDS_VERIFY = "meds.verify"                # approve prescriptions into active schedules
    TASKS_READ = "tasks.read"
    TASKS_MANAGE = "tasks.manage"              # create / assign tasks
    TASKS_UPDATE_ASSIGNED = "tasks.update_assigned"
    HANDOVER_WRITE = "handover.write"
    CARE_LOG_WRITE = "care.log.write"
    AUDIT_READ = "audit.read"
    CONSENT_MANAGE = "consent.manage"


_ALL = set(P)
_VIEW = {P.HOUSEHOLD_READ, P.MEMBERS_READ, P.SENIOR_READ, P.SENIOR_MEDICAL_READ, P.TASKS_READ}

ROLE_PERMISSIONS: dict[Role, set[P]] = {
    Role.HOUSEHOLD_OWNER: _ALL,
    Role.FAMILY_ADMIN: _ALL,
    Role.FAMILY_MEMBER: _VIEW | {P.TASKS_UPDATE_ASSIGNED, P.CARE_LOG_WRITE},
    Role.PRIMARY_CAREGIVER: _VIEW | {P.SENIOR_MEDICAL_WRITE, P.MEDS_VERIFY, P.TASKS_MANAGE,
                                     P.TASKS_UPDATE_ASSIGNED, P.HANDOVER_WRITE, P.CARE_LOG_WRITE},
    Role.SECONDARY_CAREGIVER: _VIEW | {P.TASKS_UPDATE_ASSIGNED, P.HANDOVER_WRITE, P.CARE_LOG_WRITE},
    Role.ORG_ADMIN: _VIEW | {P.TASKS_MANAGE, P.HANDOVER_WRITE, P.AUDIT_READ},
    # A senior controls consent over THEIR OWN profile (scope is pinned to linkedSeniorId).
    Role.SENIOR: _VIEW | {P.TASKS_UPDATE_ASSIGNED, P.CARE_LOG_WRITE, P.CONSENT_MANAGE},
}

# Roles an actor may grant. Owner is never grantable (only transferable — future feature).
GRANTABLE_BY: dict[Role, set[Role]] = {
    Role.HOUSEHOLD_OWNER: set(Role) - {Role.HOUSEHOLD_OWNER},
    Role.FAMILY_ADMIN: set(Role) - {Role.HOUSEHOLD_OWNER, Role.FAMILY_ADMIN},
}

# Permissions that only make sense with respect to one senior and are therefore scope-checked.
SENIOR_SCOPED = {P.SENIOR_READ, P.SENIOR_MEDICAL_READ, P.SENIOR_MEDICAL_WRITE, P.MEDS_VERIFY, P.CONSENT_MANAGE}

# Permissions that require full-household scope when no specific senior is targeted.
FULL_SCOPE_REQUIRED = {P.SENIORS_MANAGE, P.MEMBERS_MANAGE, P.HOUSEHOLD_MANAGE}

ROLE_LABELS = {
    Role.HOUSEHOLD_OWNER: "Household owner",
    Role.FAMILY_ADMIN: "Family administrator",
    Role.FAMILY_MEMBER: "Family member",
    Role.PRIMARY_CAREGIVER: "Primary caregiver",
    Role.SECONDARY_CAREGIVER: "Secondary caregiver",
    Role.ORG_ADMIN: "Organisation administrator",
    Role.SENIOR: "Senior",
}


@dataclass
class Membership:
    uid: str
    household_id: str
    role: Role
    status: str
    senior_scope: str | list[str]
    linked_senior_id: str | None
    expires_at: Any
    raw: dict[str, Any]

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> "Membership":
        return cls(
            uid=data["uid"],
            household_id=data["householdId"],
            role=Role(data["role"]),
            status=data.get("status", "active"),
            senior_scope=data.get("seniorScope", "all"),
            linked_senior_id=data.get("linkedSeniorId"),
            expires_at=data.get("expiresAt"),
            raw=data,
        )

    @property
    def is_active(self) -> bool:
        if self.status != "active":
            return False
        exp = aware(self.expires_at)
        return exp is None or exp > now()

    @property
    def permissions(self) -> set[P]:
        return ROLE_PERMISSIONS[self.role]

    def can_see_senior(self, senior_id: str) -> bool:
        if self.role == Role.SENIOR:
            return self.linked_senior_id == senior_id
        return self.senior_scope == "all" or senior_id in (self.senior_scope or [])

    @property
    def has_full_scope(self) -> bool:
        return self.role != Role.SENIOR and self.senior_scope == "all"


def member_path(household_id: str, uid: str) -> str:
    return f"households/{household_id}/members/{uid}"


def get_membership(store: Store, household_id: str, uid: str) -> Membership | None:
    doc = store.get(member_path(household_id, uid))
    if not doc:
        return None
    m = Membership.from_doc(doc.data)
    return m if m.is_active else None


def authorize(store: Store, uid: str, household_id: str, permission: P | None = None,
              senior_id: str | None = None) -> Membership:
    """Raise unless `uid` may exercise `permission` in `household_id` (optionally for `senior_id`)."""
    m = get_membership(store, household_id, uid)
    if m is None:
        raise NotFound("Household not found.")
    if permission is not None and permission not in m.permissions:
        raise Forbidden("Your role does not allow this action.")
    if senior_id is not None:
        if not m.can_see_senior(senior_id):
            # Do not reveal profiles outside the caller's scope.
            raise NotFound("Profile not found.")
    elif permission in FULL_SCOPE_REQUIRED and not m.has_full_scope:
        raise Forbidden("This action requires access to the whole household.")
    return m


def can_grant(actor: Membership, role: Role) -> bool:
    return role in GRANTABLE_BY.get(actor.role, set())
