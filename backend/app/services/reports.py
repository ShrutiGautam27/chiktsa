"""Phase 5: Care Reports & Analytics, CSV export and calendar (.ics) export.

Analytics describe coordination (were responsibilities covered, how fast reminders were resolved),
not health outcomes. Every figure is computed from records the caller is authorised to see.
"""
from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from datetime import timedelta
from statistics import median

from ..core.auth import CurrentUser
from ..core.errors import NotFound
from ..core.rbac import P
from ..core.timeutil import aware, local_date, now
from ..db import Store
from . import medications as meds
from .access import Access


def household_report(store: Store, actor: CurrentUser, hid: str, days: int = 30) -> dict:
    acc = Access(store, actor.uid, hid, P.AUDIT_READ)
    t = now()
    since = t - timedelta(days=days)
    seniors = []
    for sid in acc.visible_senior_ids():
        s = acc.senior(sid)
        tz = s.get("timezone") or "UTC"  # type: ignore[union-attr]
        row = {"seniorId": sid, "name": s["fullName"], "adherence": None, "wellness": None}  # type: ignore[index]
        if acc.allowed(sid, "medications"):
            today = local_date(t, tz)
            ev = [e for e in meds._schedule(store, hid, sid, tz, today - timedelta(days=days - 1), today) if e["scheduledFor"] <= t]
            c = Counter(e["status"] for e in ev)
            weekly = defaultdict(Counter)
            for e in ev:
                wk = local_date(e["scheduledFor"], tz) - timedelta(days=local_date(e["scheduledFor"], tz).weekday())
                weekly[wk.isoformat()][e["status"]] += 1
            n = sum(c.values())
            row["adherence"] = {"taken": c["taken"], "skipped": c["skipped"], "unconfirmed": c["unconfirmed"],
                                "recordedRate": round((c["taken"] + c["skipped"]) / n, 3) if n else None,
                                "weekly": [{"week": k, **{s_: v[s_] for s_ in ("taken", "skipped", "unconfirmed")}} for k, v in sorted(weekly.items())]}
        if acc.allowed(sid, "care_notes"):
            ents = [d.data for d in store.query(f"households/{hid}/seniors/{sid}/wellness") if d.data["date"] >= since.date().isoformat()]
            moods = [e["mood"] for e in ents if isinstance(e.get("mood"), int)]
            row["wellness"] = {"checkins": len(ents), "averageMood": round(sum(moods) / len(moods), 1) if moods else None}
        seniors.append(row)

    task_rows = [d.data for d in store.query(f"households/{hid}/tasks") if not d.data.get("seniorId") or acc.can_see(d.data["seniorId"])]
    created = [x for x in task_rows if aware(x["createdAt"]) >= since]
    done = [x for x in task_rows if x["status"] == "done" and aware(x.get("completedAt")) and aware(x["completedAt"]) >= since]
    hours_to_done = [(aware(x["completedAt"]) - aware(x["createdAt"])).total_seconds() / 3600 for x in done]
    on_time = [x for x in done if not x.get("dueAt") or aware(x["completedAt"]) <= aware(x["dueAt"])]
    weekly_tasks = defaultdict(lambda: {"created": 0, "completed": 0})
    for x in created:
        weekly_tasks[(aware(x["createdAt"]).date() - timedelta(days=aware(x["createdAt"]).weekday())).isoformat()]["created"] += 1
    for x in done:
        weekly_tasks[(aware(x["completedAt"]).date() - timedelta(days=aware(x["completedAt"]).weekday())).isoformat()]["completed"] += 1

    rem = [d.data for d in store.query(f"households/{hid}/reminders") if d.data.get("kind") == "dose" and aware(d.data["createdAt"]) >= since
           and acc.allowed(d.data["seniorId"], "medications")]
    rc = Counter(r["status"] for r in rem)
    resolve_mins = [(aware(r["resolvedAt"]) - aware(r["scheduledFor"])).total_seconds() / 60 for r in rem if r.get("resolvedAt")]

    appts = Counter()
    for sid in acc.visible_senior_ids():
        if acc.allowed(sid, "appointments"):
            for a in store.query(f"households/{hid}/seniors/{sid}/appointments"):
                if aware(a.data["startsAt"]) >= since:
                    appts[a.data["status"]] += 1
                    appts["postponed"] += len(a.data.get("history") or [])
    return {"windowDays": days, "generatedAt": t, "seniors": seniors,
            "tasks": {"created": len(created), "completed": len(done), "onTimeRate": round(len(on_time) / len(done), 3) if done else None,
                      "medianHoursToComplete": round(median(hours_to_done), 1) if hours_to_done else None,
                      "weekly": [{"week": k, **v} for k, v in sorted(weekly_tasks.items())]},
            "reminders": {"sent": len(rem), "escalated": sum(1 for r in rem if r.get("escalations")), "acknowledged": rc["acknowledged"],
                          "resolved": rc["resolved"], "medianMinutesToRecord": round(median(resolve_mins)) if resolve_mins else None},
            "appointments": dict(appts),
            "note": "Coordination analytics only — these figures describe whether care was recorded and covered, not anyone's health."}


def report_csv(store: Store, actor: CurrentUser, hid: str, days: int = 30) -> str:
    r = household_report(store, actor, hid, days)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Chiktsa coordination report", f"last {days} days", r["generatedAt"].isoformat()])
    w.writerow([])
    w.writerow(["Profile", "Doses recorded taken", "Skipped", "Not recorded", "Recorded rate", "Check-ins", "Average mood (1-5, self-reported)"])
    for s in r["seniors"]:
        a, wl = s["adherence"] or {}, s["wellness"] or {}
        w.writerow([s["name"], a.get("taken", "n/a"), a.get("skipped", "n/a"), a.get("unconfirmed", "n/a"), a.get("recordedRate", "n/a"),
                    wl.get("checkins", "n/a"), wl.get("averageMood", "n/a")])
    w.writerow([])
    w.writerow(["Tasks created", "Tasks completed", "On-time rate", "Median hours to complete"])
    t_ = r["tasks"]
    w.writerow([t_["created"], t_["completed"], t_["onTimeRate"], t_["medianHoursToComplete"]])
    w.writerow([])
    w.writerow(["Dose reminders sent", "Escalated", "Acknowledged", "Resolved", "Median minutes to record"])
    rm = r["reminders"]
    w.writerow([rm["sent"], rm["escalated"], rm["acknowledged"], rm["resolved"], rm["medianMinutesToRecord"]])
    return out.getvalue()


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def appointment_ics(store: Store, actor: CurrentUser, hid: str, sid: str, aid: str) -> tuple[str, str]:
    acc = Access(store, actor.uid, hid)
    s = acc.require(sid, P.SENIOR_MEDICAL_READ, "appointments")
    a = store.get(f"households/{hid}/seniors/{sid}/appointments/{aid}")
    if not a:
        raise NotFound("Appointment not found.")
    x = a.data
    start = aware(x["startsAt"])
    end = start + timedelta(minutes=x.get("durationMinutes") or 30)
    f = "%Y%m%dT%H%M%SZ"
    body = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chiktsa//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
        f"UID:{aid}@carehub", f"DTSTAMP:{now().strftime(f)}", f"DTSTART:{start.strftime(f)}", f"DTEND:{end.strftime(f)}",
        f"SUMMARY:{_ics_escape(x['title'] + ' — ' + (s.get('preferredName') or s['fullName']))}",
        f"LOCATION:{_ics_escape(x.get('location') or '')}",
        f"DESCRIPTION:{_ics_escape('With ' + (x.get('providerName') or 'provider') + (('. Accompanied by ' + x['escortName']) if x.get('escortName') else ''))}",
        "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Appointment reminder", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", ""])
    return body, f"appointment-{start.strftime('%Y%m%d')}.ics"
