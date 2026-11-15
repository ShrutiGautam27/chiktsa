"""Care tasks — the unit of responsibility used by all three engines.

Lifecycle: open (unassigned) → assigned (awaiting acceptance) → accepted → done; or cancelled.
Visibility: a task tied to an elderly profile is visible only to members who can see that profile
(scope + consent). Medication-check task details are redacted without medication consent.
"""
from __future__ import annotations

from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.rbac import P, ROLE_PERMISSIONS, Role
from ..core.timeutil import aware, now
from ..db import Store
from . import audit, notifications
from .access import Access, member_can_see
from .ids import new_id

OPEN_STATES = ("open", "assigned", "accepted")


def _path(hid: str, tid: str | None = None) -> str:
    return f"households/{hid}/tasks/{tid}" if tid else f"households/{hid}/tasks"


def task_out(acc: Access, tid: str, d: dict) -> dict:
    sid = d.get("seniorId")
    redact = d.get("kind") == "medication_check" and sid and not acc.allowed(sid, "medications")
    due = aware(d.get("dueAt"))
    return {"id": tid, "householdId": acc.hid, "seniorId": sid,
            "seniorName": (acc.senior(sid) or {}).get("fullName") if sid else None,
            "title": "Medication check (details restricted)" if redact else d["title"],
            "description": "" if redact else d.get("description", ""), "redacted": bool(redact),
            **{k: d.get(k) for k in ("kind", "priority", "status", "assigneeUid", "assigneeName", "createdBy",
                                     "createdByName", "completedAt", "completedByName", "coverNeeded", "createdAt",
                                     "updatedAt", "completionNote")},
            "dueAt": due, "overdue": bool(due and due < now() and d["status"] in OPEN_STATES)}


def eligible_assignee(store: Store, hid: str, uid: str, sid: str | None) -> dict:
    m = store.get(f"households/{hid}/members/{uid}")
    if not m or m.data.get("status") != "active":
        raise ValidationFailed("The assignee must be an active member of this household.")
    if P.TASKS_UPDATE_ASSIGNED not in ROLE_PERMISSIONS[Role(m.data["role"])]:
        raise ValidationFailed("That member's role can't take on tasks.")
    if sid and not member_can_see(store, hid, m.data, sid):
        raise ValidationFailed("That member doesn't have access to this elderly profile.")
    return m.data


def visible(acc: Access, d: dict) -> bool:
    return not d.get("seniorId") or acc.can_see(d["seniorId"])


def list_tasks(store: Store, actor: CurrentUser, hid: str, status: str | None = None, mine: bool = False,
               senior_id: str | None = None) -> list[dict]:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    out = []
    for d in store.query(_path(hid)):
        x = d.data
        if not visible(acc, x):
            continue
        if status == "open_all" and x["status"] not in OPEN_STATES:
            continue
        if status and status != "open_all" and x["status"] != status:
            continue
        if mine and x.get("assigneeUid") != actor.uid:
            continue
        if senior_id and x.get("seniorId") != senior_id:
            continue
        out.append(task_out(acc, d.id, x))
    rank = {"high": 0, "normal": 1, "low": 2}
    return sorted(out, key=lambda t: (t["status"] not in OPEN_STATES, t["dueAt"] is None, t["dueAt"] or now(),
                                      rank.get(t["priority"], 1)))


def _load(store: Store, acc: Access, tid: str):
    d = store.get(_path(acc.hid, tid))
    if not d or not visible(acc, d.data):
        raise NotFound("Task not found.")
    return d


def _notify_assignee(store: Store, hid: str, tid: str, uid: str, actor: CurrentUser) -> None:
    if uid != actor.uid:
        notifications.notify(store, uid, "task_assigned", "New care task for you",
                             f"{actor.display_name} assigned you a task. Please accept or decline it.", "/app/tasks",
                             f"task:{tid}:{uid}", hid)


def create(store: Store, actor: CurrentUser, hid: str, p: dict) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_MANAGE)
    sid = p.get("seniorId")
    if sid:
        acc.require(sid)
        if p.get("kind") == "medication_check":
            acc.require(sid, category="medications")
    assignee = eligible_assignee(store, hid, p["assigneeUid"], sid) if p.get("assigneeUid") else None
    tid, t = new_id(), now()
    status = "open" if not assignee else ("accepted" if assignee["uid"] == actor.uid else "assigned")
    data = {"title": p["title"], "description": p.get("description", ""), "seniorId": sid, "kind": p.get("kind", "general"),
            "priority": p.get("priority", "normal"), "dueAt": aware(p.get("dueAt")), "status": status,
            "assigneeUid": assignee["uid"] if assignee else None,
            "assigneeName": assignee["displayName"] if assignee else None, "createdBy": actor.uid,
            "createdByName": actor.display_name, "coverNeeded": False, "assignedAt": t if assignee else None,
            "createdAt": t, "updatedAt": t}
    store.set(_path(hid, tid), data)
    audit.record(store, hid, actor, "task.create", "task", tid, f"Created task '{data['title']}'", None,
                 {"assignee": data["assigneeName"], "status": status}, senior_id=sid)
    if assignee:
        _notify_assignee(store, hid, tid, assignee["uid"], actor)
    return task_out(acc, tid, data)


def update(store: Store, actor: CurrentUser, hid: str, tid: str, ch: dict) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_MANAGE)
    d = _load(store, acc, tid)
    if d.data["status"] not in OPEN_STATES:
        raise Conflict("Closed tasks can't be edited.")
    upd = {k: (aware(v) if k == "dueAt" else v) for k, v in ch.items() if v is not None}
    after = store.update(d.path, {**upd, "updatedAt": now()}).data
    audit.record(store, hid, actor, "task.update", "task", tid, f"Updated task '{after['title']}'",
                 {k: d.data.get(k) for k in upd}, {k: after.get(k) for k in upd}, senior_id=after.get("seniorId"))
    return task_out(acc, tid, after)


def _transition(store: Store, actor: CurrentUser, hid: str, tid: str, action: str, note: str = "",
                new_assignee: str | None = None) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    d = _load(store, acc, tid)
    x, st = d.data, d.data["status"]
    sid = x.get("seniorId")
    upd: dict = {}
    if action == "accept":
        if x.get("assigneeUid") != actor.uid or st != "assigned":
            raise Forbidden("Only the assigned person can accept this task.") if x.get("assigneeUid") != actor.uid \
                else Conflict("This task isn't waiting for acceptance.")
        upd = {"status": "accepted", "acceptedAt": now()}
    elif action == "decline":
        if x.get("assigneeUid") != actor.uid or st not in ("assigned", "accepted"):
            raise Forbidden("Only the assigned person can decline this task.")
        upd = {"status": "open", "assigneeUid": None, "assigneeName": None, "declinedBy": actor.uid}
        notifications.notify(store, x["createdBy"], "task_declined", "A task needs a new owner",
                             f"{actor.display_name} can't take on a task. It's now unassigned.", "/app/tasks",
                             f"decline:{tid}:{actor.uid}:{now().isoformat()[:16]}", hid)
    elif action == "claim":
        if st != "open":
            raise Conflict("This task already has an owner.")
        if not acc.can(P.TASKS_UPDATE_ASSIGNED):
            raise Forbidden("Your role can't take on tasks.")
        me = eligible_assignee(store, hid, actor.uid, sid)
        upd = {"status": "accepted", "assigneeUid": actor.uid, "assigneeName": me["displayName"], "acceptedAt": now(),
               "assignedAt": now()}
    elif action == "complete":
        if st not in OPEN_STATES:
            raise Conflict("This task is already closed.")
        if x.get("assigneeUid") != actor.uid and not acc.can(P.TASKS_MANAGE):
            raise Forbidden("Only the assignee or a coordinator can complete this task.")
        upd = {"status": "done", "completedAt": now(), "completedBy": actor.uid, "completedByName": actor.display_name,
               "completionNote": note, "coverNeeded": False}
    elif action == "cancel":
        if not acc.can(P.TASKS_MANAGE):
            raise Forbidden("Your role can't cancel tasks.")
        if st not in OPEN_STATES:
            raise Conflict("This task is already closed.")
        upd = {"status": "cancelled", "coverNeeded": False}
    elif action == "reassign":
        if not acc.can(P.TASKS_MANAGE):
            raise Forbidden("Your role can't reassign tasks.")
        if st not in OPEN_STATES:
            raise Conflict("Closed tasks can't be reassigned.")
        a = eligible_assignee(store, hid, new_assignee, sid)  # type: ignore[arg-type]
        upd = {"status": "accepted" if a["uid"] == actor.uid else "assigned", "assigneeUid": a["uid"],
               "assigneeName": a["displayName"], "assignedAt": now(), "coverNeeded": False}
        _notify_assignee(store, hid, tid, a["uid"], actor)
    else:  # pragma: no cover
        raise ValidationFailed("Unknown action.")
    after = store.update(d.path, {**upd, "updatedAt": now()}).data
    verbs = {"accept": "Accepted", "decline": "Declined", "claim": "Claimed", "complete": "Completed",
             "cancel": "Cancelled", "reassign": "Reassigned"}
    audit.record(store, hid, actor, f"task.{action}", "task", tid, f"{verbs[action]} task '{x['title']}'",
                 {k: x.get(k) for k in ("status", "assigneeName")}, {k: after.get(k) for k in ("status", "assigneeName")},
                 senior_id=sid)
    return task_out(acc, tid, after)


def accept(store, actor, hid, tid):
    return _transition(store, actor, hid, tid, "accept")


def decline(store, actor, hid, tid):
    return _transition(store, actor, hid, tid, "decline")


def claim(store, actor, hid, tid):
    return _transition(store, actor, hid, tid, "claim")


def complete(store, actor, hid, tid, note=""):
    return _transition(store, actor, hid, tid, "complete", note)


def cancel(store, actor, hid, tid):
    return _transition(store, actor, hid, tid, "cancel")


def reassign(store, actor, hid, tid, uid):
    return _transition(store, actor, hid, tid, "reassign", new_assignee=uid)
