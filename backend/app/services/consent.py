"""ENGINE 3 (part) — Consent Expiry Manager. Senior-controlled, time-boxed, revocable access."""
from __future__ import annotations

from datetime import timedelta

from ..core.auth import CurrentUser
from ..core.errors import Forbidden, NotFound, ValidationFailed
from ..core.rbac import ROLE_LABELS, Role
from ..core.timeutil import aware, now
from ..db import Store
from . import audit, notifications
from .access import CATEGORIES, Access, active_members, consent_path, consent_state


def _manager_check(store: Store, acc: Access, sid: str) -> None:
    """The senior themself decides. Owners/family admins may act on the senior's behalf ONLY when the
    senior has no Chiktsa login of their own."""
    acc.require(sid)
    if acc.m.role == Role.SENIOR and acc.m.linked_senior_id == sid:
        return
    if acc.m.role in (Role.HOUSEHOLD_OWNER, Role.FAMILY_ADMIN):
        has_own_login = any(m["role"] == "senior" and m.get("linkedSeniorId") == sid for m in active_members(store, acc.hid))
        if has_own_login:
            raise Forbidden("This senior manages their own consent.")
        return
    raise Forbidden("Only the senior (or an administrator on their behalf) can manage consent.")


def list_access(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    _manager_check(store, acc, sid)
    rows = []
    t = now()
    for m in active_members(store, hid):
        if m["role"] in ("senior",) or m["uid"] == actor.uid:
            continue
        from ..core.rbac import Membership

        if not Membership.from_doc(m).can_see_senior(sid):
            continue
        c = store.get(consent_path(hid, sid, m["uid"]))
        cd = c.data if c else None
        state = "owner" if m["role"] == "household_owner" else consent_state(cd)
        exp = aware(cd.get("expiresAt")) if cd else None
        rows.append({"uid": m["uid"], "displayName": m["displayName"], "role": m["role"],
                     "roleLabel": ROLE_LABELS[Role(m["role"])], "state": state,
                     "categories": list(CATEGORIES) if state in ("full", "owner") else (cd or {}).get("categories", []) if state == "limited" else [],
                     "expiresAt": exp, "expiringSoon": bool(exp and state == "limited" and exp - t <= timedelta(days=7)),
                     "restrictable": m["role"] != "household_owner"})
    history = [{"at": entry["at"], "summary": entry["summary"], "actorName": entry["actorName"]}
               for entry in audit.list_logs(store, hid, sid, limit=200) if entry["targetType"] == "consent"]
    return {"seniorId": sid, "categories": list(CATEGORIES), "members": sorted(rows, key=lambda r: r["displayName"].lower()),
            "history": history}


def _target(store: Store, hid: str, uid: str) -> dict:
    m = store.get(f"households/{hid}/members/{uid}")
    if not m or m.data.get("status") != "active":
        raise NotFound("Member not found.")
    if m.data["role"] == "household_owner":
        raise ValidationFailed("The household owner's access can't be restricted.")
    return m.data


def upsert(store: Store, actor: CurrentUser, hid: str, sid: str, uid: str, categories: list[str], expires_at) -> dict:
    acc = Access(store, actor.uid, hid)
    _manager_check(store, acc, sid)
    target = _target(store, hid, uid)
    exp = aware(expires_at)
    if exp is not None and exp <= now():
        raise ValidationFailed("The access end date must be in the future.")
    path = consent_path(hid, sid, uid)
    before = store.get(path)
    data = {"granteeUid": uid, "categories": sorted(set(categories)), "expiresAt": exp, "revokedAt": None,
            "grantedBy": actor.uid, "updatedAt": now()}
    store.set(path, data)
    cats = ", ".join(c.replace("_", " ") for c in data["categories"]) or "profile basics only"
    audit.record(store, hid, actor, "consent.grant", "consent", uid,
                 f"Set {target['displayName']}'s access to: {cats}" + (f" until {exp:%d %b %Y}" if exp else ""),
                 {"categories": (before.data if before else {}).get("categories", list(CATEGORIES))},
                 {"categories": data["categories"], "expiresAt": exp.isoformat() if exp else None}, senior_id=sid)
    notifications.notify(store, uid, "consent_changed", "Your access was updated",
                         "A senior updated what you can see in their care profile.", "/app",
                         f"consent:{sid}:{uid}:{now().isoformat()}", hid)
    return list_access(store, actor, hid, sid)


def revoke(store: Store, actor: CurrentUser, hid: str, sid: str, uid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    _manager_check(store, acc, sid)
    target = _target(store, hid, uid)
    path = consent_path(hid, sid, uid)
    cur = store.get(path)
    store.set(path, {**(cur.data if cur else {"categories": []}), "granteeUid": uid, "revokedAt": now(),
                     "grantedBy": actor.uid, "updatedAt": now()})
    audit.record(store, hid, actor, "consent.revoke", "consent", uid,
                 f"Revoked {target['displayName']}'s access to this profile", senior_id=sid)
    notifications.notify(store, uid, "consent_changed", "Your access was updated",
                         "A senior changed who can see their care profile.", "/app",
                         f"consent:{sid}:{uid}:{now().isoformat()}", hid)
    return list_access(store, actor, hid, sid)


def restore(store: Store, actor: CurrentUser, hid: str, sid: str, uid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    _manager_check(store, acc, sid)
    target = _target(store, hid, uid)
    store.delete(consent_path(hid, sid, uid))
    audit.record(store, hid, actor, "consent.restore", "consent", uid,
                 f"Restored {target['displayName']}'s standard access", senior_id=sid)
    return list_access(store, actor, hid, sid)
