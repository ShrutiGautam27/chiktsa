"""Appointments with accompanying-person (escort) responsibility and postponement history."""
from __future__ import annotations

from datetime import timedelta

from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.rbac import P, Role
from ..core.timeutil import aware, now
from ..db import Store
from . import audit, notifications
from .access import Access, member_can_see
from .ids import new_id

CAT = "appointments"


def _path(hid: str, sid: str, aid: str | None = None) -> str:
    base = f"households/{hid}/seniors/{sid}/appointments"
    return f"{base}/{aid}" if aid else base


def _out(hid: str, sid: str, aid: str, d: dict, senior_name: str = "") -> dict:
    return {"id": aid, "householdId": hid, "seniorId": sid, "seniorName": senior_name,
            **{k: d.get(k) for k in ("title", "providerName", "location", "startsAt", "durationMinutes", "notes",
                                     "questions", "status", "escortUid", "escortName", "escortAccepted", "history",
                                     "visitNotes", "coverNeeded", "createdAt", "updatedAt")}}


def eligible_escort(store: Store, hid: str, sid: str, uid: str) -> dict:
    m = store.get(f"households/{hid}/members/{uid}")
    if not m or Role(m.data["role"]) == Role.SENIOR or not member_can_see(store, hid, m.data, sid):
        raise ValidationFailed("The accompanying person must be an active member with access to this profile.")
    return m.data


def _load(store: Store, acc: Access, sid: str, aid: str):
    d = store.get(_path(acc.hid, sid, aid))
    if not d:
        raise NotFound("Appointment not found.")
    return d


def list_for_senior(store: Store, actor: CurrentUser, hid: str, sid: str, include_past: bool = True) -> list[dict]:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    out = [_out(hid, sid, d.id, d.data, s["fullName"]) for d in store.query(_path(hid, sid))]
    if not include_past:
        out = [a for a in out if aware(a["startsAt"]) >= now() - timedelta(hours=2)]
    return sorted(out, key=lambda a: a["startsAt"])


def list_household(store: Store, actor: CurrentUser, hid: str, days: int = 14) -> list[dict]:
    """Upcoming appointments across every profile the caller may see (consent-aware)."""
    acc = Access(store, actor.uid, hid, P.SENIOR_MEDICAL_READ)
    horizon = now() + timedelta(days=days)
    out = []
    for sid in acc.visible_senior_ids():
        if not acc.allowed(sid, CAT):
            continue
        name = acc.senior(sid)["fullName"]  # type: ignore[index]
        for d in store.query(_path(hid, sid)):
            st = aware(d.data["startsAt"])
            if d.data.get("status") == "scheduled" and now() - timedelta(hours=2) <= st <= horizon:
                out.append(_out(hid, sid, d.id, d.data, name))
    return sorted(out, key=lambda a: a["startsAt"])


def create(store: Store, actor: CurrentUser, hid: str, sid: str, p: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    escort = eligible_escort(store, hid, sid, p["escortUid"]) if p.get("escortUid") else None
    aid, t = new_id(), now()
    data = {**{k: p.get(k) for k in ("title", "providerName", "location", "durationMinutes", "notes", "questions")},
            "startsAt": aware(p["startsAt"]), "status": "scheduled", "escortUid": escort["uid"] if escort else None,
            "escortName": escort["displayName"] if escort else None,
            "escortAccepted": bool(escort and escort["uid"] == actor.uid), "history": [], "visitNotes": "",
            "coverNeeded": False, "createdBy": actor.uid, "createdAt": t, "updatedAt": t}
    store.set(_path(hid, sid, aid), data)
    audit.record(store, hid, actor, "appointment.create", "appointment", aid,
                 f"Scheduled '{data['title']}' for {s['fullName']}", None,
                 {"startsAt": data["startsAt"].isoformat(), "escort": data["escortName"]}, senior_id=sid)
    if escort and escort["uid"] != actor.uid:
        _ask_escort(store, hid, sid, aid, escort["uid"], s["fullName"])
    return _out(hid, sid, aid, data, s["fullName"])


def _ask_escort(store: Store, hid: str, sid: str, aid: str, uid: str, senior_name: str) -> None:
    notifications.notify(store, uid, "escort_request", "Can you accompany an appointment?",
                         f"You've been asked to accompany {senior_name} to an appointment.", "/app/tasks",
                         f"escort:{aid}:{now().isoformat()[:16]}", hid)


def update(store: Store, actor: CurrentUser, hid: str, sid: str, aid: str, ch: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    d = _load(store, acc, sid, aid)
    if d.data["status"] != "scheduled":
        raise Conflict("Only scheduled appointments can be edited.")
    upd = {k: v for k, v in ch.items() if v is not None and k not in ("escortUid", "clearEscort")}
    if ch.get("clearEscort"):
        upd.update({"escortUid": None, "escortName": None, "escortAccepted": False})
    elif ch.get("escortUid") and ch["escortUid"] != d.data.get("escortUid"):
        e = eligible_escort(store, hid, sid, ch["escortUid"])
        upd.update({"escortUid": e["uid"], "escortName": e["displayName"], "escortAccepted": e["uid"] == actor.uid,
                    "coverNeeded": False})
        if e["uid"] != actor.uid:
            _ask_escort(store, hid, sid, aid, e["uid"], s["fullName"])
    after = store.update(d.path, {**upd, "updatedAt": now()}).data
    audit.record(store, hid, actor, "appointment.update", "appointment", aid, f"Updated '{after['title']}'",
                 {k: d.data.get(k) for k in upd}, {k: after.get(k) for k in upd}, senior_id=sid)
    return _out(hid, sid, aid, after, s["fullName"])


def escort_action(store: Store, actor: CurrentUser, hid: str, sid: str, aid: str, action: str) -> dict:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.TASKS_UPDATE_ASSIGNED)
    d = _load(store, acc, sid, aid)
    if d.data["status"] != "scheduled":
        raise Conflict("This appointment is no longer scheduled.")
    cur = d.data.get("escortUid")
    if action == "volunteer":
        if cur:
            raise Conflict("Someone is already accompanying this appointment.")
        e = eligible_escort(store, hid, sid, actor.uid)
        upd = {"escortUid": actor.uid, "escortName": e["displayName"], "escortAccepted": True, "coverNeeded": False}
    elif cur != actor.uid:
        raise Forbidden("Only the assigned person can respond to this request.")
    elif action == "accept":
        upd = {"escortAccepted": True}
    else:
        upd = {"escortUid": None, "escortName": None, "escortAccepted": False}
    after = store.update(d.path, {**upd, "updatedAt": now()}).data
    audit.record(store, hid, actor, f"appointment.escort_{action}", "appointment", aid,
                 f"{actor.display_name} {'volunteered to accompany' if action == 'volunteer' else action + 'ed accompanying'} '{after['title']}'",
                 {"escortUid": cur}, {"escortUid": after.get("escortUid")}, senior_id=sid)
    return _out(hid, sid, aid, after, s["fullName"])


def postpone(store: Store, actor: CurrentUser, hid: str, sid: str, aid: str, new_start, reason: str) -> dict:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    d = _load(store, acc, sid, aid)
    if d.data["status"] != "scheduled":
        raise Conflict("Only scheduled appointments can be postponed.")
    new_start = aware(new_start)
    if new_start <= now():
        raise ValidationFailed("The new time must be in the future.")
    old = aware(d.data["startsAt"])
    hist = (d.data.get("history") or []) + [{"from": old, "to": new_start, "reason": reason, "by": actor.display_name,
                                             "at": now()}]
    upd = {"startsAt": new_start, "history": hist, "escortAccepted": False}
    after = store.update(d.path, {**upd, "updatedAt": now()}).data
    audit.record(store, hid, actor, "appointment.postpone", "appointment", aid,
                 f"Postponed '{after['title']}'" + (f": {reason}" if reason else ""),
                 {"startsAt": old.isoformat()}, {"startsAt": new_start.isoformat()}, senior_id=sid)
    if after.get("escortUid") and after["escortUid"] != actor.uid:
        notifications.notify(store, after["escortUid"], "appointment_changed", "An appointment you're accompanying moved",
                             f"Please re-confirm you can still accompany {s['fullName']}.", "/app/tasks",
                             f"postpone:{aid}:{new_start.isoformat()}", hid)
    return _out(hid, sid, aid, after, s["fullName"])


def complete(store: Store, actor: CurrentUser, hid: str, sid: str, aid: str, notes: str, cancel: bool = False) -> dict:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    d = _load(store, acc, sid, aid)
    if d.data["status"] != "scheduled":
        raise Conflict("This appointment is already closed.")
    status = "cancelled" if cancel else "completed"
    after = store.update(d.path, {"status": status, "visitNotes": notes, "updatedAt": now()}).data
    audit.record(store, hid, actor, f"appointment.{status}", "appointment", aid, f"Marked '{after['title']}' {status}",
                 {"status": "scheduled"}, {"status": status}, senior_id=sid)
    return _out(hid, sid, aid, after, s["fullName"])
