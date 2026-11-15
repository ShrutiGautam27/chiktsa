"""Notifications (users/{uid}/notifications) with multi-channel delivery records.

* Idempotent and race-safe: the document ID derives from a caller-supplied key and is written with
  an atomic create, so concurrent job runs on several instances never duplicate a notification.
* Data-minimised: bodies never contain medicine names or clinical detail.
* Each notification records per-channel delivery status and, for reminders, acknowledgement.
"""
from __future__ import annotations

from ..core.errors import NotFound
from ..core.passwords import sha256
from ..core.timeutil import now
from ..db import Store
from . import delivery

DEFAULT_PREFS = {"email": False, "push": False}


def nid_for(uid: str, key: str) -> str:
    return sha256(f"{uid}|{key}")[:32]


def notify(store: Store, uid: str, kind: str, title: str, body: str, link: str, key: str,
           household_id: str | None = None, meta: dict | None = None, ack_required: bool = False,
           reminder_id: str | None = None) -> bool:
    path = f"users/{uid}/notifications/{nid_for(uid, key)}"
    doc = {"kind": kind, "title": title, "body": body, "link": link, "householdId": household_id,
           "meta": meta or {}, "ackRequired": ack_required, "reminderId": reminder_id, "read": False,
           "acknowledgedAt": None, "createdAt": now(), "deliveries": [{"channel": "in_app", "status": "delivered", "at": now()}]}
    if not store.create(path, doc):
        return False  # already sent — duplicate suppressed
    user = store.get(f"users/{uid}")
    prefs = {**DEFAULT_PREFS, **((user.data.get("notificationPrefs") if user else None) or {})}
    extra = []
    if prefs.get("email") and user:
        extra.append(delivery.send_email(user.data["email"], title, body, link))
    if prefs.get("push") and user:
        extra.append(delivery.send_push(user.data.get("pushTokens") or [], title, body, link))
    if extra:
        store.update(path, {"deliveries": doc["deliveries"] + extra})
    return True


def notify_many(store: Store, uids, kind: str, title: str, body: str, link: str, key: str,
                household_id: str | None = None, exclude: str | None = None, **kw) -> int:
    return sum(notify(store, u, kind, title, body, link, key, household_id, **kw) for u in set(uids) if u and u != exclude)


def list_for(store: Store, uid: str, limit: int = 50) -> list[dict]:
    docs = store.query(f"users/{uid}/notifications", order_by="createdAt", descending=True, limit=limit)
    return [{"id": d.id, **d.data} for d in docs]


def mark_read(store: Store, uid: str, nid: str | None = None) -> int:
    if nid:
        d = store.get(f"users/{uid}/notifications/{nid}")
        if not d:
            raise NotFound("Notification not found.")
        store.update(d.path, {"read": True, "readAt": now()})
        return 1
    n = 0
    for d in store.query(f"users/{uid}/notifications"):
        if not d.data.get("read"):
            store.update(d.path, {"read": True, "readAt": now()})
            n += 1
    return n


def acknowledge(store: Store, uid: str, display_name: str, nid: str) -> dict:
    """'I've seen this and I'm on it.' Stops further escalation of the linked reminder.
    Acknowledging a dose reminder does NOT record the dose as taken."""
    d = store.get(f"users/{uid}/notifications/{nid}")
    if not d:
        raise NotFound("Notification not found.")
    t = now()
    store.update(d.path, {"read": True, "readAt": t, "acknowledgedAt": t})
    rid, hid = d.data.get("reminderId"), d.data.get("householdId")
    if rid and hid:
        r = store.get(f"households/{hid}/reminders/{rid}")
        if r and r.data.get("status") in ("sent", "escalated"):
            store.update(r.path, {"status": "acknowledged", "acknowledgedAt": t, "acknowledgedBy": uid,
                                  "acknowledgedByName": display_name})
    return {"id": nid, "acknowledgedAt": t}


def get_prefs(store: Store, uid: str) -> dict:
    user = store.get(f"users/{uid}")
    prefs = {**DEFAULT_PREFS, **((user.data.get("notificationPrefs") if user else None) or {})}
    return {"prefs": prefs, "channels": delivery.channel_status(),
            "devices": len((user.data.get("pushTokens") if user else None) or [])}


def set_prefs(store: Store, uid: str, email: bool | None, push: bool | None) -> dict:
    cur = get_prefs(store, uid)["prefs"]
    if email is not None:
        cur["email"] = email
    if push is not None:
        cur["push"] = push
    store.update(f"users/{uid}", {"notificationPrefs": cur})
    return get_prefs(store, uid)


def register_device(store: Store, uid: str, token: str) -> dict:
    user = store.get(f"users/{uid}")
    tokens = [t for t in ((user.data.get("pushTokens") if user else None) or []) if t != token][-4:] + [token]
    store.update(f"users/{uid}", {"pushTokens": tokens})
    return get_prefs(store, uid)
