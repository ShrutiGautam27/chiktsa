"""ENGINE 1 (part) — Caregiver Handover Passport and Caregiver Absence Protocol."""
from __future__ import annotations

from datetime import timedelta

from ..core.auth import CurrentUser
from ..core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..core.rbac import P, ROLE_PERMISSIONS, Role
from ..core.timeutil import aware, now
from ..db import Store
from . import audit, notifications
from .access import Access, active_members, member_can_see
from .ids import new_id
from .tasks import OPEN_STATES

CAREGIVER_ROLES = {"primary_caregiver", "secondary_caregiver"}


# ================================================================ Handover Passport
def _snapshot(store: Store, acc: Access, sids: list[str], since) -> dict:
    """Auto-built from real records: what happened since the last handover and what is pending."""
    hid = acc.hid
    tasks = [(d.id, d.data) for d in store.query(f"households/{hid}/tasks") if d.data.get("seniorId") in sids]
    completed = [{"id": i, "title": t["title"], "seniorId": t["seniorId"], "completedByName": t.get("completedByName"),
                  "completedAt": t.get("completedAt")}
                 for i, t in tasks if t["status"] == "done" and aware(t.get("completedAt")) and aware(t["completedAt"]) >= since]
    pending = [{"id": i, "title": t["title"], "seniorId": t["seniorId"], "status": t["status"],
                "assigneeName": t.get("assigneeName"), "dueAt": t.get("dueAt")}
               for i, t in tasks if t["status"] in OPEN_STATES]
    appts, doses, med_changes = [], {"taken": 0, "skipped": 0}, []
    horizon = now() + timedelta(days=7)
    for sid in sids:
        if acc.allowed(sid, "appointments"):
            for d in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                a = d.data
                moved = any(aware(h["at"]) >= since for h in a.get("history") or [])
                if a["status"] == "scheduled" and (aware(a["startsAt"]) <= horizon or moved):
                    appts.append({"id": d.id, "seniorId": sid, "title": a["title"], "startsAt": a["startsAt"],
                                  "escortName": a.get("escortName"), "postponedSinceLastHandover": moved})
        if acc.allowed(sid, "medications"):
            for d in store.query(f"households/{hid}/seniors/{sid}/doseEvents"):
                if aware(d.data["recordedAt"]) >= since:
                    doses[d.data["status"]] = doses.get(d.data["status"], 0) + 1
            for log in audit.list_logs(store, hid, sid, limit=200):
                if log["targetType"] == "medication" and log["action"] != "dose.record" and aware(log["at"]) >= since:
                    med_changes.append({"at": log["at"], "summary": log["summary"], "by": log["actorName"]})
    return {"since": since, "completedTasks": completed, "pendingTasks": pending, "upcomingAppointments": appts,
            "dosesRecorded": doses, "medicationChanges": med_changes}


def _last_handover_time(store: Store, hid: str, sids: list[str]):
    times = [aware(d.data["createdAt"]) for d in store.query(f"households/{hid}/handovers")
             if set(d.data["seniorIds"]) & set(sids)]
    return max(times) if times else now() - timedelta(hours=24)


def create_handover(store: Store, actor: CurrentUser, hid: str, p: dict) -> dict:
    acc = Access(store, actor.uid, hid, P.HANDOVER_WRITE)
    sids = list(dict.fromkeys(p["seniorIds"]))
    for sid in sids:
        acc.require(sid)
    if p["toUid"] == actor.uid:
        raise ValidationFailed("Choose someone else to hand over to.")
    to = store.get(f"households/{hid}/members/{p['toUid']}")
    if not to or P.HANDOVER_WRITE not in ROLE_PERMISSIONS[Role(to.data["role"])] or \
            not all(member_can_see(store, hid, to.data, s) for s in sids):
        raise ValidationFailed("The incoming person must be an active caregiver or coordinator with access to every selected profile.")
    since = _last_handover_time(store, hid, sids)
    hoid, t = new_id(), now()
    data = {"fromUid": actor.uid, "fromName": actor.display_name, "toUid": to.data["uid"], "toName": to.data["displayName"],
            "seniorIds": sids, "observations": p.get("observations", ""), "instructions": p.get("instructions", []),
            "scheduleChanges": p.get("scheduleChanges", ""), "snapshot": _snapshot(store, acc, sids, since),
            "status": "pending", "createdAt": t, "acknowledgedAt": None, "acknowledgementNote": ""}
    store.set(f"households/{hid}/handovers/{hoid}", data)
    for sid in sids:
        audit.record(store, hid, actor, "handover.create", "handover", hoid,
                     f"Handed over care to {data['toName']}", senior_id=sid)
    notifications.notify(store, data["toUid"], "handover", "You have a care handover to review",
                         f"{actor.display_name} handed over care to you. Review and acknowledge it.", "/app/handover",
                         f"handover:{hoid}", hid)
    return handover_out(acc, hoid, data)


def handover_out(acc: Access, hoid: str, d: dict) -> dict:
    snap = dict(d.get("snapshot") or {})
    # Medication details only for viewers with medication consent for every profile involved.
    if not all(acc.allowed(s, "medications") for s in d["seniorIds"]):
        snap["medicationChanges"], snap["dosesRecorded"] = [], {}
        snap["medicationDetailsRestricted"] = True
    names = {s: (acc.senior(s) or {}).get("fullName", "Archived profile") for s in d["seniorIds"]}
    return {"id": hoid, **{k: d.get(k) for k in ("fromUid", "fromName", "toUid", "toName", "seniorIds", "observations",
                                                "instructions", "scheduleChanges", "status", "createdAt",
                                                "acknowledgedAt", "acknowledgementNote")},
            "seniorNames": names, "snapshot": snap}


def list_handovers(store: Store, actor: CurrentUser, hid: str) -> list[dict]:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    out = [handover_out(acc, d.id, d.data) for d in store.query(f"households/{hid}/handovers")
           if all(acc.can_see(s) for s in d.data["seniorIds"])
           and (acc.can(P.HANDOVER_WRITE) or actor.uid in (d.data["fromUid"], d.data["toUid"]))]
    return sorted(out, key=lambda h: h["createdAt"], reverse=True)


def acknowledge(store: Store, actor: CurrentUser, hid: str, hoid: str, note: str) -> dict:
    acc = Access(store, actor.uid, hid)
    d = store.get(f"households/{hid}/handovers/{hoid}")
    if not d or not all(acc.can_see(s) for s in d.data["seniorIds"]):
        raise NotFound("Handover not found.")
    if d.data["toUid"] != actor.uid:
        raise Forbidden("Only the incoming caregiver can acknowledge this handover.")
    if d.data["status"] != "pending":
        raise Conflict("This handover was already acknowledged.")
    after = store.update(d.path, {"status": "acknowledged", "acknowledgedAt": now(), "acknowledgementNote": note}).data
    for sid in d.data["seniorIds"]:
        audit.record(store, hid, actor, "handover.acknowledge", "handover", hoid,
                     f"{actor.display_name} acknowledged the handover from {d.data['fromName']}", senior_id=sid)
    notifications.notify(store, d.data["fromUid"], "handover_ack", "Handover acknowledged",
                         f"{actor.display_name} acknowledged your handover.", "/app/handover", f"handover-ack:{hoid}", hid)
    return handover_out(acc, hoid, after)


# ================================================================ Absence Protocol
def is_absent(store: Store, hid: str, uid: str, start, end) -> bool:
    for d in store.query(f"households/{hid}/absences"):
        a = d.data
        if a["uid"] == uid and a["status"] == "active" and aware(a["startsAt"]) < end and aware(a["endsAt"]) > start:
            return True
    return False


def backup_candidates(store: Store, hid: str, sid: str | None, exclude: str, start, end) -> list[dict]:
    """Authorised backups: active members who can take tasks, can see the profile and aren't absent.
    Caregivers are listed first."""
    out = []
    for m in active_members(store, hid):
        if m["uid"] == exclude or m["role"] == "senior":
            continue
        if P.TASKS_UPDATE_ASSIGNED not in ROLE_PERMISSIONS[Role(m["role"])]:
            continue
        if sid and not member_can_see(store, hid, m, sid):
            continue
        if is_absent(store, hid, m["uid"], start, end):
            continue
        out.append({"uid": m["uid"], "displayName": m["displayName"], "role": m["role"]})
    return sorted(out, key=lambda c: (c["role"] not in CAREGIVER_ROLES, c["displayName"].lower()))


def affected_items(store: Store, hid: str, uid: str, start, end) -> list[dict]:
    items = []
    for d in store.query(f"households/{hid}/tasks"):
        t = d.data
        due = aware(t.get("dueAt"))
        if t.get("assigneeUid") == uid and t["status"] in ("assigned", "accepted") and (due is None or start <= due <= end):
            items.append({"type": "task", "id": d.id, "seniorId": t.get("seniorId"), "title": t["title"], "dueAt": due})
    for s in store.query(f"households/{hid}/seniors"):
        for d in store.query(f"households/{hid}/seniors/{s.id}/appointments"):
            a = d.data
            if a.get("escortUid") == uid and a["status"] == "scheduled" and start <= aware(a["startsAt"]) <= end:
                items.append({"type": "appointment", "id": d.id, "seniorId": s.id, "title": f"Accompany: {a['title']}",
                              "dueAt": aware(a["startsAt"])})
    return items


def report_absence(store: Store, actor: CurrentUser, hid: str, p: dict) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_UPDATE_ASSIGNED)
    start, end = aware(p["startsAt"]), aware(p["endsAt"])
    if end <= now():
        raise ValidationFailed("The absence must end in the future.")
    items = affected_items(store, hid, actor.uid, start, end)
    candidates = {it["id"]: backup_candidates(store, hid, it["seniorId"], actor.uid, start, end) for it in items}
    aid, t = new_id(), now()
    data = {"uid": actor.uid, "name": actor.display_name, "startsAt": start, "endsAt": end, "reason": p.get("reason", ""),
            "status": "active", "items": [{**it, "coveredBy": None, "coveredByName": None} for it in items],
            "candidates": candidates, "createdAt": t}
    store.set(f"households/{hid}/absences/{aid}", data)
    for it in items:  # flag each affected responsibility so the gap detector surfaces it
        path = (f"households/{hid}/tasks/{it['id']}" if it["type"] == "task"
                else f"households/{hid}/seniors/{it['seniorId']}/appointments/{it['id']}")
        store.update(path, {"coverNeeded": True, "coverAbsenceId": aid})
        for c in candidates[it["id"]]:
            notifications.notify(store, c["uid"], "cover_request", "Can you cover a care responsibility?",
                                 f"{actor.display_name} is unavailable. A responsibility needs cover.", "/app/handover",
                                 f"cover:{aid}:{it['id']}", hid)
    admins = [m["uid"] for m in active_members(store, hid) if m["role"] in ("household_owner", "family_admin")]
    notifications.notify_many(store, admins, "absence", "A caregiver is unavailable",
                              f"{actor.display_name} is unavailable; {len(items)} responsibilit{'y' if len(items) == 1 else 'ies'} need cover.",
                              "/app/handover", f"absence:{aid}", hid, exclude=actor.uid)
    audit.record(store, hid, actor, "absence.report", "absence", aid,
                 f"{actor.display_name} marked themselves unavailable ({len(items)} responsibilities affected)",
                 None, {"startsAt": start.isoformat(), "endsAt": end.isoformat()})
    return absence_out(acc, aid, data)


def absence_out(acc: Access, aid: str, d: dict) -> dict:
    items = [{**it, "seniorName": (acc.senior(it["seniorId"]) or {}).get("fullName") if it.get("seniorId") else None,
              "candidates": d["candidates"].get(it["id"], [])}
             for it in d["items"] if not it.get("seniorId") or acc.can_see(it["seniorId"])]
    return {"id": aid, **{k: d.get(k) for k in ("uid", "name", "startsAt", "endsAt", "reason", "status", "createdAt")},
            "items": items, "uncovered": sum(1 for it in items if not it["coveredBy"])}


def list_absences(store: Store, actor: CurrentUser, hid: str) -> list[dict]:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    out = [absence_out(acc, d.id, d.data) for d in store.query(f"households/{hid}/absences")
           if aware(d.data["endsAt"]) >= now() - timedelta(days=7)]
    return sorted(out, key=lambda a: a["startsAt"])


def cover(store: Store, actor: CurrentUser, hid: str, aid: str, item_type: str, item_id: str) -> dict:
    """A backup accepts responsibility for an affected item (audited, everyone notified)."""
    acc = Access(store, actor.uid, hid, P.TASKS_UPDATE_ASSIGNED)
    d = store.get(f"households/{hid}/absences/{aid}")
    if not d or d.data["status"] != "active":
        raise NotFound("Absence not found or no longer active.")
    items = d.data["items"]
    it = next((i for i in items if i["id"] == item_id and i["type"] == item_type), None)
    if not it:
        raise NotFound("That responsibility isn't part of this absence.")
    if it["coveredBy"]:
        raise Conflict(f"{it['coveredByName']} is already covering this.")
    if actor.uid not in [c["uid"] for c in backup_candidates(store, hid, it.get("seniorId"), d.data["uid"],
                                                             aware(d.data["startsAt"]), aware(d.data["endsAt"]))]:
        raise Forbidden("You aren't an authorised backup for this responsibility.")
    if item_type == "task":
        store.update(f"households/{hid}/tasks/{item_id}", {"assigneeUid": actor.uid, "assigneeName": actor.display_name,
                                                          "status": "accepted", "coverNeeded": False, "updatedAt": now()})
    else:
        store.update(f"households/{hid}/seniors/{it['seniorId']}/appointments/{item_id}",
                     {"escortUid": actor.uid, "escortName": actor.display_name, "escortAccepted": True,
                      "coverNeeded": False, "updatedAt": now()})
    it.update({"coveredBy": actor.uid, "coveredByName": actor.display_name})
    store.update(d.path, {"items": items})
    audit.record(store, hid, actor, "absence.cover", item_type, item_id,
                 f"{actor.display_name} accepted responsibility for '{it['title']}' while {d.data['name']} is away",
                 {"responsible": d.data["name"]}, {"responsible": actor.display_name}, senior_id=it.get("seniorId"))
    admins = [m["uid"] for m in active_members(store, hid) if m["role"] in ("household_owner", "family_admin")]
    notifications.notify_many(store, admins + [d.data["uid"]], "cover_accepted", "Cover arranged",
                              f"{actor.display_name} is covering a responsibility.", "/app/handover",
                              f"covered:{aid}:{item_id}", hid, exclude=actor.uid)
    return absence_out(acc, aid, store.get(d.path).data)


def cancel_absence(store: Store, actor: CurrentUser, hid: str, aid: str) -> None:
    acc = Access(store, actor.uid, hid)
    d = store.get(f"households/{hid}/absences/{aid}")
    if not d:
        raise NotFound("Absence not found.")
    if d.data["uid"] != actor.uid and not acc.can(P.MEMBERS_MANAGE):
        raise Forbidden("Only the person who reported the absence or an administrator can cancel it.")
    for it in d.data["items"]:
        if not it["coveredBy"]:
            path = (f"households/{hid}/tasks/{it['id']}" if it["type"] == "task"
                    else f"households/{hid}/seniors/{it['seniorId']}/appointments/{it['id']}")
            if store.get(path):
                store.update(path, {"coverNeeded": False})
    store.update(d.path, {"status": "cancelled"})
    audit.record(store, hid, actor, "absence.cancel", "absence", aid, "Cancelled an absence")
