"""Per-request access context: role permissions + profile scope + senior-controlled consent.

Consent (Consent Expiry Manager) can only NARROW access:
  * no consent record            -> access as granted by role and scope
  * record with categories       -> only those record categories are visible
  * record revoked or expired    -> the member loses access to that elderly profile entirely
The household owner cannot be restricted (keeps the household administrable).
"""
from __future__ import annotations

from ..core.errors import Forbidden, NotFound
from ..core.rbac import Membership, P, Role, authorize
from ..core.timeutil import aware, now
from ..db import Store

CATEGORIES = ("medications", "appointments", "care_notes", "documents")


def consent_path(hid: str, sid: str, grantee: str) -> str:
    return f"households/{hid}/seniors/{sid}/consents/{grantee}"


def consent_state(doc: dict | None) -> str:
    if doc is None:
        return "full"
    if doc.get("revokedAt"):
        return "revoked"
    exp = aware(doc.get("expiresAt"))
    if exp is not None and exp <= now():
        return "expired"
    return "limited"


class Access:
    def __init__(self, store: Store, uid: str, hid: str, permission: P | None = None):
        self.store = store
        self.uid = uid
        self.hid = hid
        self.m: Membership = authorize(store, uid, hid, permission)
        self._consents: dict[str, dict | None] = {}
        self._seniors: dict[str, dict | None] = {}

    # -- data helpers -----------------------------------------------------
    def senior(self, sid: str) -> dict | None:
        if sid not in self._seniors:
            d = self.store.get(f"households/{self.hid}/seniors/{sid}")
            self._seniors[sid] = d.data if d and d.data.get("status") == "active" else None
        return self._seniors[sid]

    def consent(self, sid: str) -> dict | None:
        if self.m.role in (Role.HOUSEHOLD_OWNER, Role.SENIOR):
            return None
        if sid not in self._consents:
            d = self.store.get(consent_path(self.hid, sid, self.uid))
            self._consents[sid] = d.data if d else None
        return self._consents[sid]

    # -- checks -------------------------------------------------------------
    def can(self, permission: P) -> bool:
        return permission in self.m.permissions

    def can_see(self, sid: str) -> bool:
        return (self.m.can_see_senior(sid) and self.senior(sid) is not None
                and consent_state(self.consent(sid)) in ("full", "limited"))

    def allowed(self, sid: str, category: str) -> bool:
        if not self.can_see(sid):
            return False
        c = self.consent(sid)
        return c is None or category in c.get("categories", [])

    def require(self, sid: str, permission: P | None = None, category: str | None = None) -> dict:
        """Return the senior doc or raise. Out-of-scope / revoked → 404, missing perm/category → 403."""
        if not self.can_see(sid):
            raise NotFound("Profile not found.")
        if permission is not None and permission not in self.m.permissions:
            raise Forbidden("Your role does not allow this action.")
        if category is not None and not self.allowed(sid, category):
            raise Forbidden(f"The senior has not shared their {category.replace('_', ' ')} with you.")
        return self.senior(sid)  # type: ignore[return-value]

    def visible_senior_ids(self) -> list[str]:
        docs = self.store.query(f"households/{self.hid}/seniors")
        out = []
        for d in docs:
            self._seniors.setdefault(d.id, d.data if d.data.get("status") == "active" else None)
            if self.can_see(d.id):
                out.append(d.id)
        return out


def member_can_see(store: Store, hid: str, member: dict, sid: str) -> bool:
    """Eligibility check for assigning work to ANOTHER member (scope + consent)."""
    from ..core.rbac import Membership

    m = Membership.from_doc(member)
    if not m.is_active or not m.can_see_senior(sid):
        return False
    if m.role in (Role.HOUSEHOLD_OWNER, Role.SENIOR):
        return True
    c = store.get(consent_path(hid, sid, m.uid))
    return consent_state(c.data if c else None) in ("full", "limited")


def active_members(store: Store, hid: str) -> list[dict]:
    from ..core.rbac import Membership
    from ..db import Filter

    return [d.data for d in store.query(f"households/{hid}/members", [Filter("status", "==", "active")])
            if Membership.from_doc(d.data).is_active]
