"""Personal Wishes & Care Preferences, Wellness Check-ins, Emergency Care Snapshot.

* Preferences and wishes are the senior's own words; the senior (or an administrator) edits them.
* Wellness check-ins are VOLUNTARY self-reports. They are never interpreted clinically; the only
  automation is that "I'd like someone to call me" notifies the family.
* The emergency snapshot is senior-approved. Any edit returns it to draft. It can be shared through
  an expiring, revocable, view-logged link that reveals ONLY the approved card.
"""
from __future__ import annotations

from datetime import timedelta

from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.passwords import sha256
from ..core.rbac import P, Role
from ..core.timeutil import aware, local_date, now
from ..db import Store
from . import audit, notifications
from .access import Access, active_members
from .ids import new_token

PREF_FIELDS = ("preferredLanguage", "communicationStyle", "dailyRoutine", "foodPreferences", "faithAndCulture",
               "likes", "dislikes", "careWishes", "trustedContactsNote")
EMERGENCY_FIELDS = ("bloodGroup", "allergies", "conditions", "mobilityNeeds", "communicationNeeds", "preferredHospital",
                    "doctorName", "doctorPhone", "additionalNotes")


def _senior_login(store: Store, hid: str, sid: str) -> str | None:
    return next((m["uid"] for m in active_members(store, hid) if m["role"] == "senior" and m.get("linkedSeniorId") == sid), None)


def _is_self(acc: Access, sid: str) -> bool:
    return acc.m.role == Role.SENIOR and acc.m.linked_senior_id == sid


def _can_edit_personal(store: Store, acc: Access, sid: str) -> bool:
    return _is_self(acc, sid) or acc.can(P.SENIORS_MANAGE)


# ================================================================ preferences
def get_preferences(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_READ, "care_notes")
    d = store.get(f"households/{hid}/seniors/{sid}/profile/preferences")
    data = d.data if d else {}
    return {**{k: data.get(k, "") for k in PREF_FIELDS}, "updatedByName": data.get("updatedByName"),
            "updatedAt": data.get("updatedAt"), "canEdit": _can_edit_personal(store, acc, sid)}


def set_preferences(store: Store, actor: CurrentUser, hid: str, sid: str, changes: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid)
    if not _can_edit_personal(store, acc, sid):
        raise Forbidden("Only the senior or a household administrator can edit personal wishes.")
    path = f"households/{hid}/seniors/{sid}/profile/preferences"
    before = (store.get(path).data if store.get(path) else {})
    after = {**before, **{k: v for k, v in changes.items() if k in PREF_FIELDS and v is not None},
             "updatedBy": actor.uid, "updatedByName": actor.display_name, "updatedAt": now()}
    store.set(path, after)
    audit.record(store, hid, actor, "preferences.update", "preferences", sid, "Updated personal wishes and care preferences",
                 {k: before.get(k) for k in changes if k in PREF_FIELDS}, {k: after.get(k) for k in changes if k in PREF_FIELDS},
                 senior_id=sid)
    return get_preferences(store, actor, hid, sid)


# ================================================================ wellness check-ins
def checkin(store: Store, actor: CurrentUser, hid: str, sid: str, p: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid)
    if not (_is_self(acc, sid) or acc.can(P.CARE_LOG_WRITE)):
        raise Forbidden("Your role can't record check-ins.")
    acc.require(sid, category="care_notes") if not _is_self(acc, sid) else None
    tz = senior.get("timezone") or "UTC"
    day = local_date(now(), tz).isoformat()
    path = f"households/{hid}/seniors/{sid}/wellness/{day}"
    prev = store.get(path)
    data = {"date": day, **{k: p.get(k) for k in ("mood", "sleep", "energy", "pain")}, "note": (p.get("note") or "")[:500],
            "wantsCall": bool(p.get("wantsCall")), "reportedBy": "self" if _is_self(acc, sid) else "caregiver",
            "recordedBy": actor.uid, "recordedByName": actor.display_name, "updatedAt": now()}
    store.set(path, data)
    if data["wantsCall"] and not (prev and prev.data.get("wantsCall")):
        family = [m["uid"] for m in active_members(store, hid)
                  if m["role"] in ("household_owner", "family_admin", "family_member", "primary_caregiver") and m["uid"] != actor.uid]
        notifications.notify_many(store, family, "wants_call", f"{senior['fullName']} would like a call",
                                  f"{senior['fullName']} asked for someone to call them today.", f"/app/households/{hid}/profiles/{sid}",
                                  f"wants-call:{hid}:{sid}:{day}", hid)
    audit.record(store, hid, actor, "wellness.checkin", "wellness", day, "Recorded a wellness check-in", senior_id=sid)
    return data


def wellness_history(store: Store, actor: CurrentUser, hid: str, sid: str, days: int = 30) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_READ, "care_notes") if not _is_self(acc, sid) else acc.require(sid)
    cutoff = (local_date(now(), (acc.senior(sid) or {}).get("timezone") or "UTC") - timedelta(days=days - 1)).isoformat()
    entries = sorted([d.data for d in store.query(f"households/{hid}/seniors/{sid}/wellness") if d.data["date"] >= cutoff],
                     key=lambda e: e["date"])

    def avg(k):
        vals = [e[k] for e in entries if isinstance(e.get(k), int)]
        return round(sum(vals) / len(vals), 1) if vals else None

    return {"entries": entries, "averages": {k: avg(k) for k in ("mood", "sleep", "energy")}, "days": days,
            "note": "Self-reported and voluntary. Not used to diagnose anything — talk to a doctor about health concerns."}


# ================================================================ emergency snapshot
def _epath(hid, sid):
    return f"households/{hid}/seniors/{sid}/profile/emergency"


def _approver_ok(store: Store, acc: Access, sid: str) -> str:
    if _is_self(acc, sid):
        return "senior"
    if acc.m.role in (Role.HOUSEHOLD_OWNER, Role.FAMILY_ADMIN) and not _senior_login(store, acc.hid, sid):
        return "admin_on_behalf"
    raise Forbidden("The senior approves their own emergency card (an administrator may approve only if the senior has no login).")


def _card(store: Store, hid: str, sid: str, senior: dict, d: dict) -> dict:
    inc = d.get("include") or {}
    card = {"fullName": senior["fullName"], "preferredName": senior.get("preferredName"), "dateOfBirth": senior.get("dateOfBirth"),
            "primaryLanguage": senior.get("primaryLanguage"),
            **{k: (d.get("fields") or {}).get(k, "") for k in EMERGENCY_FIELDS}}
    if not inc.get("conditions", True):
        card["conditions"] = ""
    card["contacts"] = senior.get("emergencyContacts", []) if inc.get("contacts", True) else []
    card["medications"] = ([{"name": m.data["name"], "strength": m.data.get("strength"), "dose": f"{m.data.get('doseQuantity')} {m.data.get('doseUnit')}",
                             "times": m.data.get("times")}
                            for m in store.query(f"households/{hid}/seniors/{sid}/medications") if m.data["status"] == "active"]
                           if inc.get("medications", True) else [])
    return card


def get_emergency(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid, P.SENIOR_READ)
    d = store.get(_epath(hid, sid))
    data = d.data if d else {"fields": {}, "include": {"medications": True, "contacts": True, "conditions": True}, "status": "draft"}
    try:
        approver = _approver_ok(store, acc, sid)
    except Forbidden:
        approver = None
    shares = [{"id": s.id, "expiresAt": s.data["expiresAt"], "views": s.data.get("views", 0), "lastViewedAt": s.data.get("lastViewedAt"),
               "createdByName": s.data.get("createdByName")}
              for s in store.query("emergencyShares") if s.data["householdId"] == hid and s.data["seniorId"] == sid
              and not s.data.get("revokedAt") and aware(s.data["expiresAt"]) > now()]
    return {"status": data.get("status", "draft"), "fields": {k: (data.get("fields") or {}).get(k, "") for k in EMERGENCY_FIELDS},
            "include": data.get("include") or {}, "approvedByName": data.get("approvedByName"), "approvedAt": data.get("approvedAt"),
            "approvedAs": data.get("approvedAs"), "card": _card(store, hid, sid, senior, data), "canEdit": _can_edit_personal(store, acc, sid),
            "canApprove": approver is not None, "shares": shares if acc.can(P.SENIOR_MEDICAL_READ) or _is_self(acc, sid) else []}


def set_emergency(store: Store, actor: CurrentUser, hid: str, sid: str, fields: dict, include: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid)
    if not _can_edit_personal(store, acc, sid):
        raise Forbidden("Only the senior or a household administrator can edit the emergency card.")
    prev = store.get(_epath(hid, sid))
    store.set(_epath(hid, sid), {"fields": {k: (fields.get(k) or "")[:500] for k in EMERGENCY_FIELDS},
                                 "include": {k: bool(include.get(k, True)) for k in ("medications", "contacts", "conditions")},
                                 "status": "draft", "updatedBy": actor.uid, "updatedAt": now()})
    audit.record(store, hid, actor, "emergency.update", "emergency", sid,
                 "Updated the emergency card" + (" — needs re-approval" if prev and prev.data.get("status") == "approved" else ""), senior_id=sid)
    return get_emergency(store, actor, hid, sid)


def approve_emergency(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid)
    as_ = _approver_ok(store, acc, sid)
    d = store.get(_epath(hid, sid))
    if not d:
        raise ValidationFailed("Fill in the emergency card before approving it.")
    store.update(d.path, {"status": "approved", "approvedBy": actor.uid, "approvedByName": actor.display_name, "approvedAt": now(),
                          "approvedAs": as_})
    audit.record(store, hid, actor, "emergency.approve", "emergency", sid,
                 "Approved the emergency card" + (" on the senior's behalf" if as_ == "admin_on_behalf" else ""), senior_id=sid)
    return get_emergency(store, actor, hid, sid)


def create_share(store: Store, actor: CurrentUser, hid: str, sid: str, hours: int) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid)
    if not (_is_self(acc, sid) or acc.can(P.SENIOR_MEDICAL_READ)):
        raise Forbidden("Your role can't share the emergency card.")
    d = store.get(_epath(hid, sid))
    if not d or d.data.get("status") != "approved":
        raise Conflict("Only an approved emergency card can be shared.")
    if not 1 <= hours <= 72:
        raise ValidationFailed("Links last between 1 and 72 hours.")
    token = new_token()
    exp = now() + timedelta(hours=hours)
    store.set(f"emergencyShares/{sha256(token)}", {"householdId": hid, "seniorId": sid, "expiresAt": exp, "createdBy": actor.uid,
                                                    "createdByName": actor.display_name, "createdAt": now(), "views": 0})
    audit.record(store, hid, actor, "emergency.share", "emergency", sid, f"Created a {hours}-hour emergency card link", senior_id=sid)
    return {"token": token, "expiresAt": exp}


def revoke_share(store: Store, actor: CurrentUser, hid: str, sid: str, share_id: str) -> None:
    acc = Access(store, actor.uid, hid)
    acc.require(sid)
    s = store.get(f"emergencyShares/{share_id}")
    if not s or s.data["householdId"] != hid or s.data["seniorId"] != sid:
        raise NotFound("Link not found.")
    if not (_is_self(acc, sid) or acc.can(P.SENIOR_MEDICAL_READ)):
        raise Forbidden("Your role can't manage emergency links.")
    store.update(s.path, {"revokedAt": now()})
    audit.record(store, hid, actor, "emergency.unshare", "emergency", sid, "Revoked an emergency card link", senior_id=sid)


def public_card(store: Store, token: str) -> dict:
    """Unauthenticated, token-gated view: returns ONLY the approved card. Every view is logged."""
    s = store.get(f"emergencyShares/{sha256(token)}")
    if not s or s.data.get("revokedAt") or aware(s.data["expiresAt"]) <= now():
        raise NotFound("This emergency link has expired or was revoked.")
    hid, sid = s.data["householdId"], s.data["seniorId"]
    senior = store.get(f"households/{hid}/seniors/{sid}")
    d = store.get(_epath(hid, sid))
    if not senior or senior.data.get("status") != "active" or not d or d.data.get("status") != "approved":
        raise NotFound("This emergency card is no longer available.")
    store.update(s.path, {"views": s.data.get("views", 0) + 1, "lastViewedAt": now()})
    from ..core.auth import CurrentUser as CU

    audit.record(store, hid, CU(uid="public-link", email="", display_name="Emergency link"), "emergency.view", "emergency", sid,
                 "Emergency card viewed through a shared link", senior_id=sid)
    return {"card": _card(store, hid, sid, senior.data, d.data), "approvedAt": d.data.get("approvedAt"),
            "expiresAt": s.data["expiresAt"], "notice": "Shared by the family for emergency use. Information is family-provided; confirm with medical staff."}
