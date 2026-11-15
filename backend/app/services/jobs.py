"""Notification automation: the reminder & escalation engine.

`run_tick()` is called every minute (Cloud Scheduler → POST /api/internal/jobs/tick, or the
in-process scheduler during development). It is:
  * idempotent  — every reminder/notification has a deterministic key written with an atomic
                  create, so re-runs and concurrent instances never send duplicates;
  * catch-up safe — after downtime it does not flood people with stale reminders;
  * honest      — an unconfirmed dose or unacknowledged reminder is NEVER described as "missed";
                  escalation messages say a reminder "hasn't been confirmed".

Workflows:
  medication   reminder at dose time → configurable escalation steps (quiet-hour aware) → resolved
               when the dose is recorded, or stopped when a recipient acknowledges.
  appointment  reminders before the visit; escort confirmation nudges; "nobody accompanying" alerts.
  caregiver    task due / overdue / unaccepted / unassigned; handover acknowledgement reminders.
  safety       low-stock alerts when the level worsens; consent-expiry notices.
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..core.auth import CurrentUser
from ..core.errors import ValidationFailed
from ..core.passwords import sha256
from ..core.rbac import ROLE_PERMISSIONS, P, Role, authorize
from ..core.timeutil import aware, local_date, now
from ..db import Store
from . import audit
from . import medications as meds
from .access import CATEGORIES, active_members, consent_path, consent_state, member_can_see
from .ids import new_id
from .notifications import notify_many

log = logging.getLogger("carehub.jobs")

ADMIN_ROLES = ["household_owner", "family_admin"]
DEFAULT_RULES = {
    "doseReminders": True,
    "escalationSteps": [
        {"afterMinutes": 30, "roles": ["primary_caregiver"]},
        {"afterMinutes": 90, "roles": ["family_admin", "household_owner"]},
    ],
    "quietHours": {"enabled": True, "start": "22:00", "end": "07:00"},
    "appointmentReminderHours": [24, 2],
    "escortConfirmHours": 48,
    "taskDueReminderHours": 2,
    "handoverReminderHours": 12,
    "lowStockAlerts": True,
    "consentExpiryNoticeDays": 3,
}
FRESH_WINDOW = timedelta(minutes=60)    # don't send a dose reminder more than 60 min late (after downtime)
LOOKBACK = timedelta(hours=12)          # escalations evaluated for reminders up to 12 h old (covers a quiet night)


def _rid(key: str) -> str:
    return sha256(key)[:32]


# ---------------------------------------------------------------- rules
def get_rules(store: Store, hid: str) -> dict:
    d = store.get(f"households/{hid}/settings/notifications")
    return {**DEFAULT_RULES, **(d.data if d else {})}


def update_rules(store: Store, actor: CurrentUser, hid: str, changes: dict) -> dict:
    authorize(store, actor.uid, hid, P.HOUSEHOLD_MANAGE)
    before = get_rules(store, hid)
    steps = changes.get("escalationSteps")
    if steps is not None:
        mins = [s["afterMinutes"] for s in steps]
        if mins != sorted(mins) or len(set(mins)) != len(mins):
            raise ValidationFailed("Escalation steps must have increasing delays.")
    after = {**before, **{k: v for k, v in changes.items() if v is not None}}
    store.set(f"households/{hid}/settings/notifications", after)
    audit.record(store, hid, actor, "settings.notifications", "settings", "notifications",
                 "Updated reminder and escalation rules",
                 {k: before.get(k) for k in changes if changes[k] is not None},
                 {k: after.get(k) for k in changes if changes[k] is not None})
    return after


def in_quiet_hours(rules: dict, tz: str, at: datetime) -> datetime | None:
    """If `at` falls in quiet hours, return when they end (UTC); else None."""
    q = rules.get("quietHours") or {}
    if not q.get("enabled"):
        return None
    z = ZoneInfo(tz)
    local = at.astimezone(z)
    s, e = (time(*map(int, q[k].split(":"))) for k in ("start", "end"))
    t = local.time()
    inside = (s <= t or t < e) if s > e else (s <= t < e)
    if not inside:
        return None
    end_day = local.date() + (timedelta(days=1) if s > e and t >= s else timedelta())
    return datetime.combine(end_day, e, tzinfo=z).astimezone(at.tzinfo)


# ---------------------------------------------------------------- recipients
def _members(store: Store, hid: str) -> list[dict]:
    return active_members(store, hid)


def _can_see_category(store: Store, hid: str, m: dict, sid: str, cat: str) -> bool:
    if not member_can_see(store, hid, m, sid):
        return False
    if m["role"] in ("household_owner", "senior"):
        return True
    c = store.get(consent_path(hid, sid, m["uid"]))
    return c is None or consent_state(c.data) != "limited" or cat in c.data.get("categories", [])


def recipients_by_roles(store: Store, hid: str, roles: list[str], sid: str | None = None, cat: str | None = None,
                        fallback: bool = False) -> list[str]:
    """Members with one of `roles` who may see the profile/category. With fallback=True, an empty
    result falls back to the household owner and administrators, so a reminder never goes to nobody."""
    def ok(m):
        return not sid or (_can_see_category(store, hid, m, sid, cat) if cat else member_can_see(store, hid, m, sid))
    out = [m["uid"] for m in _members(store, hid) if m["role"] in roles and ok(m)]
    if not out and fallback:
        out = [m["uid"] for m in _members(store, hid) if m["role"] in ADMIN_ROLES and ok(m)]
    return out


def _senior_login(store: Store, hid: str, sid: str) -> str | None:
    return next((m["uid"] for m in _members(store, hid) if m["role"] == "senior" and m.get("linkedSeniorId") == sid), None)


# ---------------------------------------------------------------- workflows
def _medication_workflow(store: Store, hid: str, rules: dict, tz_house: str, t: datetime, stats: dict) -> None:
    for s in store.query(f"households/{hid}/seniors"):
        if s.data.get("status") != "active":
            continue
        sid, name, tz = s.id, s.data["fullName"], s.data.get("timezone") or tz_house
        today = local_date(t, tz)
        recorded = {d.id for d in store.query(f"households/{hid}/seniors/{sid}/doseEvents")}
        for m in store.query(f"households/{hid}/seniors/{sid}/medications"):
            med = m.data
            # ---- low stock (notify only when the level worsens; reset when back to ok)
            if rules.get("lowStockAlerts") and med.get("status") == "active":
                rf = meds.refill_status(med, today)
                if rf.get("tracked"):
                    _stock_alert(store, hid, sid, name, m.id, med, rf, rules, tz, t, stats)
            if not rules.get("doseReminders") or med.get("status") != "active":
                continue
            for slot in meds.slots(med, tz, today - timedelta(days=1), today):
                if slot > t or t - slot > LOOKBACK:
                    continue
                dose_id = meds._dose_id(m.id, slot)
                key = f"dose:{hid}:{dose_id}"
                rpath = f"households/{hid}/reminders/{_rid(key)}"
                existing = store.get(rpath)
                if existing is None:
                    if t - slot > FRESH_WINDOW or dose_id in recorded:
                        continue  # stale after downtime, or already recorded early
                    resp = med.get("responsibleUid")
                    m_doc = store.get(f"households/{hid}/members/{resp}") if resp else None
                    if m_doc and _can_see_category(store, hid, m_doc.data, sid, "medications") and m_doc.data.get("status") == "active":
                        to = [resp]
                    else:  # nobody responsible (or lapsed): first escalation tier gets the reminder
                        first = (rules.get("escalationSteps") or [{"roles": ADMIN_ROLES}])[0]["roles"]
                        to = recipients_by_roles(store, hid, first, sid, "medications", fallback=True)
                    rdoc = {"kind": "dose", "key": key, "seniorId": sid, "targetType": "medication", "targetId": m.id,
                            "doseId": dose_id, "scheduledFor": slot, "recipients": to, "status": "sent",
                            "escalations": [], "heldUntil": None, "createdAt": t}
                    if store.create(rpath, rdoc):
                        stats["reminders"] += 1
                        n = notify_many(store, to, "dose_reminder", f"Dose due for {name}",
                                        f"A scheduled dose for {name} is due. Please record whether it was taken.",
                                        "/app/medications", key, hid, ack_required=True, reminder_id=_rid(key),
                                        meta={"seniorId": sid, "medicationId": m.id, "scheduledFor": slot.isoformat()})
                        stats["notifications"] += n
                    continue
                _escalate_dose(store, hid, rules, tz, t, existing, recorded, name, stats)


def _escalate_dose(store: Store, hid: str, rules: dict, tz: str, t: datetime, r, recorded: set, name: str, stats: dict) -> None:
    d = r.data
    if d["status"] in ("resolved", "acknowledged"):
        return
    if d["doseId"] in recorded:
        store.update(r.path, {"status": "resolved", "resolvedAt": t})
        stats["resolved"] += 1
        return
    slot = aware(d["scheduledFor"])
    done = {e["step"] for e in d.get("escalations") or []}
    for i, step in enumerate(rules.get("escalationSteps") or []):
        if i in done or t < slot + timedelta(minutes=step["afterMinutes"]):
            continue
        quiet_end = in_quiet_hours(rules, tz, t)
        if quiet_end:
            if d.get("heldUntil") is None:
                store.update(r.path, {"heldUntil": quiet_end})
                stats["held"] += 1
            return  # escalations wait for quiet hours to end
        to = recipients_by_roles(store, hid, step["roles"], d["seniorId"], "medications", fallback=True)
        key = f"{d['key']}:esc:{i}"
        n = notify_many(store, to, "dose_escalation", f"Dose not yet confirmed for {name}",
                        f"A dose reminder for {name} hasn't been confirmed by anyone. This doesn't mean it was "
                        "missed — please check in and record what happened.",
                        "/app/medications", key, hid, ack_required=True, reminder_id=r.id,
                        meta={"seniorId": d["seniorId"], "medicationId": d["targetId"], "scheduledFor": slot.isoformat()})
        esc = (d.get("escalations") or []) + [{"step": i, "at": t, "recipients": to}]
        store.update(r.path, {"status": "escalated", "escalations": esc, "heldUntil": None})
        d["escalations"] = esc
        stats["escalations"] += 1
        stats["notifications"] += n
        break  # one step per tick, so steps released after quiet hours don't arrive as a burst


def _stock_alert(store, hid, sid, name, mid, med, rf, rules, tz, t, stats) -> None:
    order = {"ok": 0, "low": 1, "critical": 2, "out": 3}
    key = f"stock:{hid}:{mid}"
    path = f"households/{hid}/reminders/{_rid(key)}"
    cur = store.get(path)
    last = cur.data.get("lastLevel", "ok") if cur else "ok"
    level = rf["level"]
    if order[level] <= order[last]:
        if level == "ok" and last != "ok" and cur:
            store.update(path, {"lastLevel": "ok", "status": "resolved", "resolvedAt": t})
        return
    if in_quiet_hours(rules, tz, t):
        return
    to = list({*recipients_by_roles(store, hid, ADMIN_ROLES, sid, "medications"),
               *([med["responsibleUid"]] if med.get("responsibleUid") else [])})
    doc = {"kind": "stock", "key": key, "seniorId": sid, "targetType": "medication", "targetId": mid,
           "scheduledFor": t, "recipients": to, "status": "sent", "lastLevel": level, "escalations": [], "createdAt": t}
    store.set(path, doc)
    stats["notifications"] += notify_many(store, to, "low_stock", f"Medicine running low for {name}",
                                          f"Recorded stock for one of {name}'s medicines lasts about {rf['daysRemaining']} more day(s).",
                                          "/app/medication-safety", f"{key}:{level}:{t.date().isoformat()}", hid)
    stats["reminders"] += 1


def _appointment_workflow(store: Store, hid: str, rules: dict, tz: str, t: datetime, stats: dict) -> None:
    hours = sorted(rules.get("appointmentReminderHours") or [])
    for s in store.query(f"households/{hid}/seniors"):
        if s.data.get("status") != "active":
            continue
        sid, name = s.id, s.data["fullName"]
        for a in store.query(f"households/{hid}/seniors/{sid}/appointments"):
            x = a.data
            start = aware(x["startsAt"])
            if x.get("status") != "scheduled" or start <= t or start - t > timedelta(hours=max(hours + [48])):
                continue
            remaining = (start - t).total_seconds() / 3600
            stamp = start.isoformat()
            applicable = [h for h in hours if remaining <= h]
            if applicable:
                h = min(applicable)
                to = [u for u in (x.get("escortUid"), _senior_login(store, hid, sid)) if u]
                n = notify_many(store, to, "appointment_reminder", f"Upcoming appointment for {name}",
                                f"{name} has an appointment in about {round(remaining) or 1} hour(s).", "/app/appointments",
                                f"appt:{hid}:{a.id}:{h}:{stamp}", hid, meta={"seniorId": sid, "appointmentId": a.id})
                stats["notifications"] += n
            quiet = in_quiet_hours(rules, tz, t)
            if x.get("escortUid") and not x.get("escortAccepted") and remaining <= rules.get("escortConfirmHours", 48) and not quiet:
                stats["notifications"] += notify_many(store, [x["escortUid"]], "escort_confirm", "Please confirm you can accompany",
                                                      f"Can you still accompany {name} to an upcoming appointment?", "/app/tasks",
                                                      f"escort-confirm:{hid}:{a.id}:{stamp}", hid, ack_required=True)
                if remaining <= 24:
                    stats["notifications"] += notify_many(store, recipients_by_roles(store, hid, ADMIN_ROLES, sid, "appointments"),
                                                          "escort_unconfirmed", "Accompanying person hasn't confirmed",
                                                          f"No one has confirmed they'll accompany {name} to an appointment within 24 hours.",
                                                          "/app/appointments", f"escort-unconfirmed:{hid}:{a.id}:{stamp}", hid)
            if not x.get("escortUid") and remaining <= rules.get("escortConfirmHours", 48) and not quiet:
                to = recipients_by_roles(store, hid, ADMIN_ROLES + ["primary_caregiver", "secondary_caregiver"], sid, "appointments")
                stats["notifications"] += notify_many(store, to, "no_escort", f"Someone is needed to accompany {name}",
                                                      f"An appointment for {name} has nobody assigned to accompany them.",
                                                      "/app/appointments", f"no-escort:{hid}:{a.id}:{stamp}", hid)


def _caregiver_workflow(store: Store, hid: str, rules: dict, tz: str, t: datetime, stats: dict) -> None:
    quiet = in_quiet_hours(rules, tz, t)
    due_h = rules.get("taskDueReminderHours", 2)
    for d in store.query(f"households/{hid}/tasks"):
        x = d.data
        if x["status"] not in ("open", "assigned", "accepted"):
            continue
        due = aware(x.get("dueAt"))
        stamp = due.isoformat() if due else "none"
        if x.get("assigneeUid") and due:
            if t < due <= t + timedelta(hours=due_h):
                stats["notifications"] += notify_many(store, [x["assigneeUid"]], "task_due", "A task is due soon",
                                                      "One of your care tasks is due soon.", "/app/tasks",
                                                      f"task-due:{hid}:{d.id}:{stamp}", hid)
            elif due < t and not quiet:
                stats["notifications"] += notify_many(store, [x["assigneeUid"], x.get("createdBy")], "task_overdue", "A care task is overdue",
                                                      "A care task has passed its due time.", "/app/tasks",
                                                      f"task-overdue:{hid}:{d.id}:{stamp}", hid)
        if x["status"] == "assigned" and not quiet:
            since = aware(x.get("assignedAt") or x["createdAt"])
            if t - since > timedelta(hours=24):
                stats["notifications"] += notify_many(store, [x["assigneeUid"]], "task_accept", "A task is waiting for you",
                                                      "Please accept or decline a task assigned to you.", "/app/tasks",
                                                      f"task-accept:{hid}:{d.id}:{since.isoformat()}", hid, ack_required=True)
        if x["status"] == "open" and due and due - t <= timedelta(hours=24) and not quiet:
            managers = [m["uid"] for m in _members(store, hid) if P.TASKS_MANAGE in ROLE_PERMISSIONS[Role(m["role"])]
                        and (not x.get("seniorId") or member_can_see(store, hid, m, x["seniorId"]))]
            stats["notifications"] += notify_many(store, managers, "task_unassigned", "A task due soon has no owner",
                                                  "A care task due within 24 hours hasn't been assigned.", "/app/tasks",
                                                  f"task-unassigned:{hid}:{d.id}:{stamp}", hid)
    hh = rules.get("handoverReminderHours", 12)
    for d in store.query(f"households/{hid}/handovers"):
        x = d.data
        if x["status"] != "pending" or quiet:
            continue
        age = t - aware(x["createdAt"])
        if age > timedelta(hours=hh):
            stats["notifications"] += notify_many(store, [x["toUid"]], "handover_reminder", "Please review your handover",
                                                  f"{x['fromName']} handed over care to you and is waiting for your acknowledgement.",
                                                  "/app/handover", f"ho-remind:{hid}:{d.id}", hid, ack_required=True)
        if age > timedelta(hours=2 * hh):
            stats["notifications"] += notify_many(store, recipients_by_roles(store, hid, ADMIN_ROLES), "handover_unacknowledged",
                                                  "A handover hasn't been acknowledged",
                                                  f"{x['toName']} hasn't acknowledged a handover from {x['fromName']}.",
                                                  "/app/handover", f"ho-escalate:{hid}:{d.id}", hid)


def _consent_workflow(store: Store, hid: str, rules: dict, tz: str, t: datetime, stats: dict) -> None:
    days = rules.get("consentExpiryNoticeDays", 3)
    if in_quiet_hours(rules, tz, t):
        return
    for s in store.query(f"households/{hid}/seniors"):
        if s.data.get("status") != "active":
            continue
        for c in store.query(f"households/{hid}/seniors/{s.id}/consents"):
            exp = aware(c.data.get("expiresAt"))
            if consent_state(c.data) != "limited" or not exp or exp - t > timedelta(days=days):
                continue
            owner = _senior_login(store, hid, s.id)
            to = [c.id] + ([owner] if owner else recipients_by_roles(store, hid, ADMIN_ROLES))
            stats["notifications"] += notify_many(store, to, "consent_expiring", "Temporary access ending soon",
                                                  f"Temporary access to {s.data['fullName']}'s care information ends soon.",
                                                  "/app/consent", f"consent-exp:{hid}:{s.id}:{c.id}:{exp.isoformat()}", hid)


# ---------------------------------------------------------------- orchestration
def run_household(store: Store, hid: str, t: datetime | None = None) -> dict:
    t = t or now()
    h = store.get(f"households/{hid}")
    stats = {"reminders": 0, "notifications": 0, "escalations": 0, "resolved": 0, "held": 0}
    if not h:
        return stats
    rules, tz = get_rules(store, hid), h.data.get("timezone") or "UTC"
    for wf in (_medication_workflow, _appointment_workflow, _caregiver_workflow, _consent_workflow):
        try:
            wf(store, hid, rules, tz, t, stats)
        except Exception:  # one failing workflow must not stop the others or other households
            log.exception('"workflow %s failed for a household"', wf.__name__)
            stats.setdefault("errors", 0)
            stats["errors"] += 1
    return stats


def run_tick(store: Store, t: datetime | None = None) -> dict:
    t = t or now()
    started = now()
    total = {"households": 0, "reminders": 0, "notifications": 0, "escalations": 0, "resolved": 0, "held": 0, "errors": 0}
    for h in store.query("households"):
        st = run_household(store, h.id, t)
        total["households"] += 1
        for k, v in st.items():
            total[k] = total.get(k, 0) + v
    store.set(f"jobRuns/{new_id()}", {"startedAt": started, "finishedAt": now(), "evaluatedAt": t, **total})
    return total


def run_now(store: Store, actor: CurrentUser, hid: str) -> dict:
    """Household administrators can trigger an immediate (idempotent) check of their own household."""
    authorize(store, actor.uid, hid, P.HOUSEHOLD_MANAGE)
    return run_household(store, hid)


def list_reminders(store: Store, actor: CurrentUser, hid: str, days: int = 3) -> list[dict]:
    """Reminder activity with delivery & acknowledgement status (scope- and consent-filtered)."""
    from .access import Access

    acc = Access(store, actor.uid, hid, P.TASKS_READ)
    since = now() - timedelta(days=days)
    names = {m["uid"]: m["displayName"] for m in _members(store, hid)}
    out = []
    for d in store.query(f"households/{hid}/reminders"):
        x = d.data
        if aware(x.get("createdAt")) and aware(x["createdAt"]) < since:
            continue
        sid = x.get("seniorId")
        if sid and not acc.allowed(sid, "medications"):
            continue
        med = store.get(f"households/{hid}/seniors/{sid}/medications/{x['targetId']}") if x.get("targetType") == "medication" else None
        out.append({"id": d.id, "kind": x["kind"], "seniorId": sid, "seniorName": (acc.senior(sid) or {}).get("fullName"),
                    "medicationName": med.data.get("name") if med else None, "scheduledFor": x.get("scheduledFor"),
                    "status": x["status"], "recipients": [names.get(u, "Former member") for u in x.get("recipients", [])],
                    "escalations": [{"step": e["step"] + 1, "at": e["at"], "recipients": [names.get(u, "Former member") for u in e["recipients"]]}
                                    for e in x.get("escalations") or []],
                    "heldUntil": x.get("heldUntil"), "acknowledgedByName": x.get("acknowledgedByName"),
                    "acknowledgedAt": x.get("acknowledgedAt"), "resolvedAt": x.get("resolvedAt"), "createdAt": x.get("createdAt")})
    return sorted(out, key=lambda r: r["createdAt"] or now(), reverse=True)


_ = CATEGORIES  # noqa
