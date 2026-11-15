"""Elderly (senior) profiles. Each profile is an independent care record within a household."""
from datetime import date

from ..core.auth import CurrentUser
from ..core.errors import NotFound
from ..core.rbac import P, authorize
from ..core.timeutil import now
from ..db import Store
from . import audit, households
from .access import Access
from .ids import new_id


def _path(hid: str, sid: str) -> str:
    return f"households/{hid}/seniors/{sid}"


def _age(dob: str | None) -> int | None:
    if not dob:
        return None
    d = date.fromisoformat(dob)
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def _out(hid: str, sid: str, d: dict) -> dict:
    return {"id": sid, "householdId": hid, "fullName": d["fullName"], "preferredName": d.get("preferredName", ""),
            "dateOfBirth": d.get("dateOfBirth"), "gender": d.get("gender", "undisclosed"),
            "primaryLanguage": d.get("primaryLanguage", "en"), "timezone": d.get("timezone"),
            "notes": d.get("notes", ""), "emergencyContacts": d.get("emergencyContacts", []),
            "status": d.get("status", "active"), "age": _age(d.get("dateOfBirth")),
            "createdAt": d.get("createdAt"), "updatedAt": d.get("updatedAt")}


def _serialise(payload: dict) -> dict:
    """Pydantic `date` -> ISO string (Firestore has no date-only type)."""
    out = dict(payload)
    if isinstance(out.get("dateOfBirth"), date):
        out["dateOfBirth"] = out["dateOfBirth"].isoformat()
    return out


def list_seniors(store: Store, actor: CurrentUser, hid: str, include_archived: bool = False) -> list[dict]:
    acc = Access(store, actor.uid, hid, P.SENIOR_READ)
    docs = store.query(f"households/{hid}/seniors")
    # Consent-aware: a senior who revoked a member's access disappears from that member's list.
    out = [_out(hid, d.id, d.data) for d in docs
           if acc.m.can_see_senior(d.id) and (include_archived or d.data.get("status") == "active")
           and (d.data.get("status") != "active" or acc.can_see(d.id))]
    return sorted(out, key=lambda s: s["fullName"].lower())


def create(store: Store, actor: CurrentUser, hid: str, payload: dict) -> dict:
    authorize(store, actor.uid, hid, P.SENIORS_MANAGE)
    sid = new_id()
    t = now()
    house = store.get(f"households/{hid}").data
    data = {**_serialise(payload), "timezone": payload.get("timezone") or house["timezone"], "status": "active",
            "createdBy": actor.uid, "createdAt": t, "updatedAt": t}
    store.set(_path(hid, sid), data)
    households.bump(store, hid, "seniorCount", 1)
    audit.record(store, hid, actor, "senior.create", "senior", sid, f"Added profile for {data['fullName']}",
                 senior_id=sid)
    return _out(hid, sid, data)


def get(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid, P.SENIOR_READ)
    d = store.get(_path(hid, sid))
    if not d or not acc.m.can_see_senior(sid) or (d.data.get("status") == "active" and not acc.can_see(sid)):
        raise NotFound("Profile not found.")
    out = _out(hid, sid, d.data)
    if not acc.allowed(sid, "care_notes"):
        out["notes"] = ""
    return out


def update(store: Store, actor: CurrentUser, hid: str, sid: str, changes: dict) -> dict:
    authorize(store, actor.uid, hid, P.SENIORS_MANAGE, senior_id=sid)
    d = store.get(_path(hid, sid))
    if not d or d.data.get("status") != "active":
        raise NotFound("Profile not found.")
    changes = _serialise({k: v for k, v in changes.items() if v is not None})
    after = store.update(_path(hid, sid), {**changes, "updatedAt": now()}).data
    audit.record(store, hid, actor, "senior.update", "senior", sid, f"Updated profile of {after['fullName']}",
                 {k: d.data.get(k) for k in changes}, {k: after.get(k) for k in changes}, senior_id=sid)
    return _out(hid, sid, after)


def archive(store: Store, actor: CurrentUser, hid: str, sid: str) -> None:
    """Profiles are archived, never hard-deleted: care history must remain auditable."""
    authorize(store, actor.uid, hid, P.SENIORS_MANAGE, senior_id=sid)
    d = store.get(_path(hid, sid))
    if not d or d.data.get("status") != "active":
        raise NotFound("Profile not found.")
    store.update(_path(hid, sid), {"status": "archived", "archivedAt": now(), "updatedAt": now()})
    households.bump(store, hid, "seniorCount", -1)
    audit.record(store, hid, actor, "senior.archive", "senior", sid, f"Archived profile of {d.data['fullName']}",
                 {"status": "active"}, {"status": "archived"}, senior_id=sid)
