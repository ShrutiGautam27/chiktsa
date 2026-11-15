"""ENGINE 1 — Care Continuity Intelligence: Invisible Care Gap Detector + What-If Simulator.

Deterministic, explainable rules over real records. Gaps are about RESPONSIBILITY (who is doing
what), never about health: missing data is not treated as an emergency and nothing is diagnosed.
The Phase 4 AI layer will only phrase/summarise these rule outputs, not replace them.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from ..core.auth import CurrentUser
from ..core.errors import NotFound, ValidationFailed
from ..core.rbac import P
from ..core.timeutil import aware, local_date, now
from ..db import Store
from . import medications as meds
from .access import Access
from .handovers import backup_candidates, is_absent
from .tasks import OPEN_STATES

SEV = {"high": 0, "medium": 1, "low": 2}


def _gap(gtype, severity, title, detail, target_type, target_id, sid=None, sname=None, link="", action=""):
    return {"id": f"{gtype}:{target_id}", "type": gtype, "severity": severity, "title": title, "detail": detail,
            "targetType": target_type, "targetId": target_id, "seniorId": sid, "seniorName": sname,
            "link": link, "action": action}


def detect_gaps(store: Store, actor: CurrentUser, hid: str, senior_id: str | None = None) -> dict:
    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    t = now()
    gaps: list[dict] = []
    members = {d.id: d.data for d in store.query(f"households/{hid}/members")}

    def active(uid):
        m = members.get(uid)
        if not m or m.get("status") != "active":
            return False
        exp = aware(m.get("expiresAt"))
        return exp is None or exp > t

    sids = [senior_id] if senior_id else acc.visible_senior_ids()
    if senior_id:
        acc.require(senior_id)

    for sid in sids:
        s = acc.senior(sid)
        name, tz = s["fullName"], s.get("timezone") or "UTC"  # type: ignore[index]
        # ---- appointments
        if acc.allowed(sid, "appointments"):
            for d in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                a = d.data
                st = aware(a["startsAt"])
                if a["status"] != "scheduled" or st < t or st > t + timedelta(days=7):
                    continue
                hours = (st - t).total_seconds() / 3600
                when = f"in {math.ceil(hours)} h" if hours < 48 else f"on {local_date(st, tz).strftime('%a %d %b')}"
                if not a.get("escortUid"):
                    gaps.append(_gap("appointment_no_escort", "high" if hours < 48 else "medium",
                                     "Appointment has no one to accompany",
                                     f"'{a['title']}' {when} has no accompanying person assigned.",
                                     "appointment", d.id, sid, name, "/app/appointments", "Assign or volunteer"))
                elif not active(a["escortUid"]):
                    gaps.append(_gap("escort_inactive", "high", "Accompanying person no longer has access",
                                     f"The person assigned to '{a['title']}' is no longer an active member.",
                                     "appointment", d.id, sid, name, "/app/appointments", "Reassign"))
                elif a.get("coverNeeded"):
                    gaps.append(_gap("escort_cover_needed", "high", "Accompanying person is unavailable",
                                     f"{a.get('escortName')} is away for '{a['title']}' {when}; cover is needed.",
                                     "appointment", d.id, sid, name, "/app/handover", "Arrange cover"))
                elif not a.get("escortAccepted"):
                    gaps.append(_gap("escort_unconfirmed", "high" if hours < 72 else "medium",
                                     "Accompanying person hasn't confirmed",
                                     f"{a.get('escortName')} hasn't confirmed they can accompany '{a['title']}' {when}.",
                                     "appointment", d.id, sid, name, "/app/tasks", "Follow up"))
        # ---- medications
        if acc.allowed(sid, "medications"):
            today = local_date(t, tz)
            meds_list = [(d.id, d.data) for d in store.query(f"households/{hid}/seniors/{sid}/medications")]
            for mid, m in meds_list:
                label = m.get("name") or "A medication"
                if m["status"] == "pending_verification":
                    age = (t - aware(m.get("updatedAt") or m["createdAt"])).total_seconds() / 3600
                    gaps.append(_gap("medication_unverified", "medium" if age > 24 else "low",
                                     "Medication awaiting verification",
                                     f"'{label}' can't be scheduled until an authorised person verifies it.",
                                     "medication", mid, sid, name, "/app/medication-safety", "Review and verify"))
                if m["status"] != "active":
                    continue
                r = m.get("responsibleUid")
                if not r:
                    gaps.append(_gap("medication_no_responsible", "medium", "No one confirms these doses",
                                     f"Nobody is responsible for recording doses of '{label}'.",
                                     "medication", mid, sid, name, "/app/medications", "Assign responsibility"))
                elif not active(r):
                    gaps.append(_gap("medication_responsible_inactive", "high", "Dose responsibility has lapsed",
                                     f"The person responsible for '{label}' no longer has access.",
                                     "medication", mid, sid, name, "/app/medications", "Reassign"))
                elif is_absent(store, hid, r, t, t + timedelta(hours=24)):
                    gaps.append(_gap("medication_responsible_absent", "high", "Dose responsibility needs cover",
                                     f"The person responsible for '{label}' is unavailable in the next 24 h.",
                                     "medication", mid, sid, name, "/app/medications", "Assign someone else"))
                rf = meds.refill_status(m, today)
                if rf.get("tracked") and rf["level"] in ("low", "critical", "out"):
                    gaps.append(_gap("low_stock", "high" if rf["level"] in ("critical", "out") else "medium",
                                     "Medicine stock running low",
                                     f"About {rf['daysRemaining']} day(s) of '{label}' left (by recorded stock).",
                                     "medication", mid, sid, name, "/app/medication-safety", "Plan a refill"))
            pending_doses = [e for e in meds._schedule(store, hid, sid, tz, today, today)
                             if e["status"] == "unconfirmed" and t - e["scheduledFor"] > timedelta(hours=2)]
            if pending_doses:
                gaps.append(_gap("doses_unrecorded", "low", "Doses not yet recorded today",
                                 f"{len(pending_doses)} dose(s) earlier today have no record. This does not mean they "
                                 "were missed — please record what happened.",
                                 "senior", sid, sid, name, "/app/medications", "Record doses"))

    # ---- tasks (household level, visibility-filtered)
    for d in store.query(f"households/{hid}/tasks"):
        x = d.data
        sid = x.get("seniorId")
        if senior_id and sid != senior_id:
            continue
        if x["status"] not in OPEN_STATES or (sid and not acc.can_see(sid)):
            continue
        sname = (acc.senior(sid) or {}).get("fullName") if sid else None
        due = aware(x.get("dueAt"))
        soon = due is not None and due - t < timedelta(hours=24)
        title = x["title"] if not (x.get("kind") == "medication_check" and sid and not acc.allowed(sid, "medications")) \
            else "Medication check"
        if x["status"] == "open":
            gaps.append(_gap("task_unassigned", "high" if soon else "low", "Responsibility not assigned",
                             f"'{title}' has no owner" + (" and is due soon." if soon else "."),
                             "task", d.id, sid, sname, "/app/tasks", "Assign or claim"))
        elif not active(x.get("assigneeUid")):
            gaps.append(_gap("task_assignee_inactive", "high", "Task owner no longer has access",
                             f"'{title}' is assigned to someone who is no longer an active member.",
                             "task", d.id, sid, sname, "/app/tasks", "Reassign"))
        elif x.get("coverNeeded"):
            gaps.append(_gap("task_cover_needed", "high" if soon else "medium", "Task owner is unavailable",
                             f"{x.get('assigneeName')} is away; '{title}' needs cover.",
                             "task", d.id, sid, sname, "/app/handover", "Arrange cover"))
        elif due and due < t:
            gaps.append(_gap("task_overdue", "medium", "Responsibility overdue",
                             f"'{title}' ({x.get('assigneeName')}) is past its due time.",
                             "task", d.id, sid, sname, "/app/tasks", "Follow up"))
        elif x["status"] == "assigned" and t - aware(x.get("assignedAt") or x["createdAt"]) > timedelta(hours=24):
            gaps.append(_gap("task_not_accepted", "low", "Assignment not yet accepted",
                             f"{x.get('assigneeName')} hasn't accepted '{title}'.",
                             "task", d.id, sid, sname, "/app/tasks", "Follow up"))

    # ---- handovers
    for d in store.query(f"households/{hid}/handovers"):
        h = d.data
        if h["status"] != "pending" or not all(acc.can_see(s) for s in h["seniorIds"]):
            continue
        if senior_id and senior_id not in h["seniorIds"]:
            continue
        age = (t - aware(h["createdAt"])).total_seconds() / 3600
        gaps.append(_gap("handover_unacknowledged", "high" if age > 12 else "medium", "Handover not acknowledged",
                         f"{h['toName']} hasn't acknowledged the handover from {h['fromName']} ({math.floor(age)} h ago).",
                         "handover", d.id, h["seniorIds"][0], None, "/app/handover", "Remind"))

    gaps.sort(key=lambda g: (SEV[g["severity"]], g["type"]))
    counts = {s: sum(g["severity"] == s for g in gaps) for s in SEV}
    return {"generatedAt": t, "counts": counts, "total": len(gaps), "gaps": gaps}


# ================================================================ What-If Simulator
def simulate(store: Store, actor: CurrentUser, hid: str, p: dict) -> dict:
    """Read-only planning simulation. Never writes, never predicts health outcomes."""
    acc = Access(store, actor.uid, hid, P.TASKS_MANAGE)
    sc = p["scenario"]
    disclaimer = "Planning simulation based on current schedules and assignments. It is not a medical prediction."
    if sc == "caregiver_unavailable":
        return {"scenario": sc, "disclaimer": disclaimer, **_sim_unavailable(store, acc, p)}
    if sc == "appointment_postponed":
        return {"scenario": sc, "disclaimer": disclaimer, **_sim_postpone(store, acc, p)}
    if sc == "stock_depletion":
        return {"scenario": sc, "disclaimer": disclaimer, **_sim_stock(store, acc, p)}
    return {"scenario": sc, "disclaimer": disclaimer, **_sim_offline(store, acc, p)}


def _need(p, *keys):
    missing = [k for k in keys if not p.get(k)]
    if missing:
        raise ValidationFailed(f"Missing for this scenario: {', '.join(missing)}.")


def _sim_unavailable(store: Store, acc: Access, p: dict) -> dict:
    _need(p, "uid", "startsAt", "endsAt")
    hid, uid = acc.hid, p["uid"]
    start, end = aware(p["startsAt"]), aware(p["endsAt"])
    if end <= start:
        raise ValidationFailed("The end must be after the start.")
    m = store.get(f"households/{hid}/members/{uid}")
    if not m:
        raise NotFound("Member not found.")
    from .handovers import affected_items

    items = [i for i in affected_items(store, hid, uid, start, end) if not i.get("seniorId") or acc.can_see(i["seniorId"])]
    for i in items:
        i["backups"] = backup_candidates(store, hid, i.get("seniorId"), uid, start, end)
    dose_duties = []
    for sid in acc.visible_senior_ids():
        if not acc.allowed(sid, "medications"):
            continue
        s = acc.senior(sid)
        tz = s.get("timezone") or "UTC"  # type: ignore[union-attr]
        for d in store.query(f"households/{hid}/seniors/{sid}/medications"):
            if d.data.get("responsibleUid") == uid and d.data["status"] == "active":
                n = sum(1 for w in meds.slots(d.data, tz, local_date(start, tz), local_date(end, tz)) if start <= w <= end)
                if n:
                    dose_duties.append({"medicationId": d.id, "seniorId": sid, "seniorName": s["fullName"],  # type: ignore[index]
                                        "name": d.data.get("name"), "dosesToConfirm": n,
                                        "backups": backup_candidates(store, hid, sid, uid, start, end)})
    pending_handovers = [d.id for d in store.query(f"households/{hid}/handovers")
                         if d.data["status"] == "pending" and uid in (d.data["toUid"], d.data["fromUid"])]
    uncovered = sum(1 for i in items if not i["backups"]) + sum(1 for x in dose_duties if not x["backups"])
    return {"member": m.data["displayName"], "affectedResponsibilities": items, "doseConfirmationDuties": dose_duties,
            "pendingHandovers": len(pending_handovers), "itemsWithoutBackup": uncovered,
            "summary": f"{len(items)} responsibilit{'y' if len(items) == 1 else 'ies'} and "
                       f"{sum(x['dosesToConfirm'] for x in dose_duties)} dose confirmation(s) would need cover; "
                       f"{uncovered} have no available authorised backup."}


def _find_appt(store: Store, acc: Access, aid: str):
    for sid in acc.visible_senior_ids():
        if acc.allowed(sid, "appointments"):
            d = store.get(f"households/{acc.hid}/seniors/{sid}/appointments/{aid}")
            if d:
                return sid, d
    raise NotFound("Appointment not found.")


def _sim_postpone(store: Store, acc: Access, p: dict) -> dict:
    _need(p, "appointmentId", "newStartsAt")
    sid, d = _find_appt(store, acc, p["appointmentId"])
    a, hid = d.data, acc.hid
    new_start = aware(p["newStartsAt"])
    new_end = new_start + timedelta(minutes=a.get("durationMinutes") or 30)
    effects = []
    esc = a.get("escortUid")
    if esc:
        if is_absent(store, hid, esc, new_start, new_end):
            effects.append({"type": "escort_unavailable", "detail": f"{a.get('escortName')} is unavailable at the new time."})
        for s2 in acc.visible_senior_ids():
            if not acc.allowed(s2, "appointments"):
                continue
            for o in store.query(f"households/{hid}/seniors/{s2}/appointments"):
                if o.id == d.id or o.data["status"] != "scheduled" or o.data.get("escortUid") != esc:
                    continue
                os_ = aware(o.data["startsAt"])
                oe = os_ + timedelta(minutes=o.data.get("durationMinutes") or 30)
                if os_ < new_end and oe > new_start:
                    effects.append({"type": "escort_double_booked",
                                    "detail": f"{a.get('escortName')} is also accompanying '{o.data['title']}' then."})
        effects.append({"type": "escort_reconfirm", "detail": "The accompanying person would need to re-confirm."})
    else:
        effects.append({"type": "no_escort", "detail": "No accompanying person is assigned yet."})
    if acc.allowed(sid, "medications"):
        tz = acc.senior(sid).get("timezone") or "UTC"  # type: ignore[union-attr]
        day = local_date(new_start, tz)
        for e in meds._schedule(store, hid, sid, tz, day, day):
            if new_start - timedelta(minutes=30) <= e["scheduledFor"] <= new_end + timedelta(minutes=30):
                effects.append({"type": "dose_during_visit",
                                "detail": f"A scheduled dose of '{e['medicationName']}' falls during the visit — plan who records it."})
    for t in store.query(f"households/{hid}/tasks"):
        x = t.data
        due = aware(x.get("dueAt"))
        if x.get("seniorId") == sid and x["status"] in OPEN_STATES and due and new_start <= due <= new_end and x.get("assigneeUid") == esc:
            effects.append({"type": "task_conflict", "detail": f"'{x['title']}' is due during the visit for the same person."})
    return {"appointment": {"id": d.id, "title": a["title"], "from": a["startsAt"], "to": new_start},
            "effects": effects, "summary": f"{len(effects)} knock-on effect(s) to plan for."}


def _sim_stock(store: Store, acc: Access, p: dict) -> dict:
    _need(p, "medicationId")
    for sid in acc.visible_senior_ids():
        if not acc.allowed(sid, "medications"):
            continue
        d = store.get(f"households/{acc.hid}/seniors/{sid}/medications/{p['medicationId']}")
        if d:
            break
    else:
        raise NotFound("Medication not found.")
    m = dict(d.data)
    if p.get("assumeStock") is not None:
        m["stockQuantity"] = p["assumeStock"]
    tz = acc.senior(sid).get("timezone") or "UTC"  # type: ignore[union-attr]
    today = local_date(now(), tz)
    if m.get("status") != "active":
        return {"medication": m.get("name"), "summary": "This medication is not active, so no doses are scheduled.",
                "tracked": False}
    rf = meds.refill_status(m, today)
    if not rf.get("tracked"):
        return {"medication": m.get("name"), "tracked": False,
                "summary": "Stock isn't recorded for this medication. Record current stock to plan refills."}
    depletion = date.fromisoformat(rf["depletionDate"])
    horizon = today + timedelta(days=30)
    after = [w for w in meds.slots(m, tz, depletion + timedelta(days=1), horizon)]
    order_by = depletion - timedelta(days=3)
    appts = []
    if acc.allowed(sid, "appointments"):
        appts = [{"title": a.data["title"], "startsAt": a.data["startsAt"]}
                 for a in store.query(f"households/{acc.hid}/seniors/{sid}/appointments")
                 if a.data["status"] == "scheduled" and today <= local_date(aware(a.data["startsAt"]), tz) <= depletion]
    return {"medication": m.get("name"), "tracked": True, "refill": rf, "dosesWithoutStockNext30Days": len(after),
            "orderBy": max(order_by, today).isoformat(), "appointmentsBeforeDepletion": appts,
            "summary": f"Recorded stock lasts until about {depletion.strftime('%d %b')}. Without a refill, "
                       f"{len(after)} scheduled dose(s) in the next 30 days would have no stock. Order by "
                       f"{max(order_by, today).strftime('%d %b')}."}


def _sim_offline(store: Store, acc: Access, p: dict) -> dict:
    _need(p, "hours")
    start = aware(p.get("startsAt")) or now()
    end = start + timedelta(hours=p["hours"])
    hid = acc.hid
    doses, appts = [], []
    for sid in acc.visible_senior_ids():
        s = acc.senior(sid)
        tz = s.get("timezone") or "UTC"  # type: ignore[union-attr]
        if acc.allowed(sid, "medications"):
            for e in meds._schedule(store, hid, sid, tz, local_date(start, tz), local_date(end, tz)):
                if start <= e["scheduledFor"] <= end:
                    doses.append({"seniorName": s["fullName"], "medicationName": e["medicationName"],  # type: ignore[index]
                                  "scheduledFor": e["scheduledFor"]})
        if acc.allowed(sid, "appointments"):
            for a in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                if a.data["status"] == "scheduled" and start <= aware(a.data["startsAt"]) <= end:
                    appts.append({"seniorName": s["fullName"], "title": a.data["title"], "startsAt": a.data["startsAt"]})  # type: ignore[index]
    tasks = [t.data["title"] for t in store.query(f"households/{hid}/tasks")
             if t.data["status"] in OPEN_STATES and aware(t.data.get("dueAt")) and start <= aware(t.data["dueAt"]) <= end
             and (not t.data.get("seniorId") or acc.can_see(t.data["seniorId"]))]
    return {"window": {"from": start, "to": end}, "dosesToRecordLater": doses, "appointments": appts, "tasksDue": tasks,
            "recommendations": [
                "Print or save today's schedule before travelling to areas with poor connectivity.",
                "Note dose times on paper and record them in Chiktsa when back online.",
                "In-app reminders can't be delivered while offline; agree a phone-call fallback with the family.",
            ],
            "limitations": "Offline caching and queued sync (Internet Independence Mode) are planned for Phase 5.",
            "summary": f"{len(doses)} dose(s), {len(appts)} appointment(s) and {len(tasks)} task(s) fall in this window."}
