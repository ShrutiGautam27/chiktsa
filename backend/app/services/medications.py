"""ENGINE 2 — Medication Safety Intelligence.

Safety invariants (enforced here, tested in tests/test_medications.py):
  * A medication NEVER becomes active without explicit verification by a member holding
    `meds.verify` (Prescription Confusion Firewall).
  * Verification is refused while any BLOCKING issue exists (unclear/missing fields, conflicting
    frequency, error-prone notation). Warnings must be explicitly acknowledged.
  * Editing any clinical field of an active medication returns it to `pending_verification`.
  * CareHub never invents, infers or changes doses. An unrecorded dose is "unconfirmed", never
    "missed". There is no "take an extra dose" path.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta

from ..core.auth import CurrentUser
from ..core.errors import Conflict, NotFound, ValidationFailed
from ..core.rbac import P, Role
from ..core.timeutil import aware, daterange, local_date, local_to_utc, now
from ..db import Store
from . import audit, notifications
from .access import Access, active_members, member_can_see
from .ids import new_id

CAT = "medications"
SAFETY_FIELDS = {"name", "strength", "form", "doseQuantity", "doseUnit", "route", "frequencyText", "times",
                 "daysOfWeek", "startDate", "endDate", "instructions", "prescriptionText", "uncertainFields"}
FIELD_LABELS = {"name": "medicine name", "strength": "strength", "doseQuantity": "dose amount", "doseUnit": "dose unit",
                "form": "form", "route": "route", "frequencyText": "frequency", "times": "dose times",
                "daysOfWeek": "days", "startDate": "start date", "endDate": "end date",
                "instructions": "instructions", "prescriber": "prescriber"}

# Frequency phrases → doses per day. Deliberately conservative: unknown text is NOT interpreted.
_FREQ = [
    (r"\b(qid|qds|four times( a| per)? day|4 ?times( a| per)? day)\b", 4),
    (r"\b(tds|tid|thrice( daily| a day)?|three times( a| per)? day|3 ?times( a| per)? day)\b", 3),
    (r"\b(bd|bid|twice( daily| a day)?|two times( a| per)? day|2 ?times( a| per)? day)\b", 2),
    (r"\b(od|once( daily| a day)?|one time( a| per)? day|daily|hs|at bedtime|nocte|mane)\b", 1),
]
# ISMP "do not use" abbreviations and notation that causes 10x / wrong-frequency errors.
_ERROR_PRONE = [
    (r"\bqod\b", "'QOD' is easily misread as 'QID' (four times a day). Write 'every other day'."),
    (r"\bq\.?d\.?\b", "'QD' is easily misread as 'QID'. Write 'once daily'."),
    (r"\d+\.0\b", "Trailing zero (e.g. '5.0') can be misread as ten times the dose. Write '5'."),
    (r"(?<![\d])\.\d", "Missing leading zero (e.g. '.5') can be misread. Write '0.5'."),
]
_UNIT_WARN = (r"(?<![a-z])(u|iu)\b", "'U'/'IU' can be misread as 0 or 4. Write 'units'.")
_PRN = r"\b(prn|sos|as needed|when required|if needed)\b"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _path(hid: str, sid: str, mid: str | None = None) -> str:
    base = f"households/{hid}/seniors/{sid}/medications"
    return f"{base}/{mid}" if mid else base


# ---------------------------------------------------------------- analysis
def analyse(med: dict, siblings: list[dict]) -> list[dict]:
    """Prescription Ambiguity Detector. Returns issues with severity 'blocking' | 'warning'."""
    issues: list[dict] = []

    def add(code, field, severity, message):
        issues.append({"code": code, "field": field, "severity": severity, "message": message})

    for f in med.get("uncertainFields") or []:
        add("unclear_field", f, "blocking",
            f"The {FIELD_LABELS.get(f, f)} was marked unclear on the prescription. Confirm it against the original "
            "or with the prescriber, then clear the flag.")
    required = ["name", "doseQuantity", "times", "startDate"]
    if med.get("source") == "prescription":
        required.append("strength")
    for f in required:
        if f not in (med.get("uncertainFields") or []) and not med.get(f):
            add("missing_field", f, "blocking", f"The {FIELD_LABELS[f]} is missing.")

    times = med.get("times") or []
    freq_text = (med.get("frequencyText") or "").lower()
    if freq_text and times:
        mdash = re.search(r"\b([0-9½])-([0-9½])-([0-9½])\b", freq_text)  # Indian "1-0-1" notation
        expected = (sum(1 for x in mdash.groups() if x != "0") if mdash
                    else next((n for pat, n in _FREQ if re.search(pat, freq_text)), None))
        if expected is not None and expected != len(times):
            add("frequency_conflict", "times", "blocking",
                f"The prescription frequency ('{med['frequencyText']}') means {expected} dose(s) a day, but the "
                f"schedule has {len(times)}. Resolve the conflict before activating.")
        if re.search(_PRN, freq_text):
            add("as_needed_scheduled", "frequencyText", "warning",
                "The prescription says 'as needed', but fixed dose times are scheduled. Confirm the intended use.")

    blob = " ".join(str(med.get(k) or "") for k in ("strength", "frequencyText", "instructions", "prescriptionText"))
    for pat, msg in _ERROR_PRONE:
        if re.search(pat, blob, flags=re.I):
            add("error_prone_notation", "prescriptionText", "blocking", msg)
    if re.search(_UNIT_WARN[0], blob, flags=re.I):
        add("unit_abbreviation", "strength", "warning", _UNIT_WARN[1])

    sd, ed = med.get("startDate"), med.get("endDate")
    if sd and ed and ed < sd:
        add("date_conflict", "endDate", "blocking", "The end date is before the start date.")

    name = _norm(med.get("name", ""))
    if name:
        for other in siblings:
            if other.get("status") in ("active", "pending_verification", "paused") and _norm(other.get("name", "")) == name:
                add("possible_duplicate", "name", "warning",
                    f"Another {other['status'].replace('_', ' ')} medication with the same name exists for this person. "
                    "Confirm with the prescriber that both are intended.")
                break
    if not med.get("responsibleUid"):
        add("no_responsible", "responsibleUid", "warning",
            "Nobody is responsible for confirming doses. Assign someone so doses don't go unrecorded.")
    return issues


# ---------------------------------------------------------------- read models
def doses_per_day(med: dict) -> float:
    return len(med.get("times") or []) * len(med.get("daysOfWeek") or []) / 7


def refill_status(med: dict, today: date) -> dict:
    stock, qty = med.get("stockQuantity"), med.get("doseQuantity") or 0
    per_day = doses_per_day(med) * qty
    if stock is None or per_day <= 0 or med.get("status") not in ("active", "paused"):
        return {"tracked": False}
    days = stock / per_day
    low = med.get("lowStockDays", 7)
    level = "out" if stock < qty else "critical" if days <= 3 else "low" if days <= low else "ok"
    need30 = math.ceil(per_day * 30)
    who = med.get("prescriber") or "the prescriber"
    where = med.get("pharmacy") or "your pharmacy"
    unit = med.get("doseUnit") or "unit"
    return {
        "tracked": True, "stock": stock, "dailyUse": round(per_day, 2), "daysRemaining": math.floor(days),
        "depletionDate": (today + timedelta(days=math.floor(days))).isoformat(), "level": level,
        "checklist": [
            f"Check the prescription is still valid with {who}.",
            f"Order about {need30} {unit}(s) — 30 days at the current schedule — from {where}.",
            "Record the new stock in CareHub when it is collected.",
        ],
    }


def med_out(acc: Access, sid: str, mid: str, d: dict, siblings: list[dict] | None = None) -> dict:
    tz = acc.senior(sid).get("timezone") or "UTC"  # type: ignore[union-attr]
    sibs = [s for s in (siblings or []) if s.get("_id") != mid]
    issues = analyse(d, sibs)
    return {
        "id": mid, "seniorId": sid, "householdId": acc.hid,
        **{k: d.get(k) for k in ("name", "strength", "form", "doseQuantity", "doseUnit", "route", "frequencyText",
                                 "times", "daysOfWeek", "startDate", "endDate", "instructions", "prescriber",
                                 "source", "prescriptionText", "uncertainFields", "stockQuantity", "lowStockDays",
                                 "responsibleUid", "pharmacy", "status", "verification", "createdAt", "updatedAt")},
        "issues": issues,
        "blockingCount": sum(i["severity"] == "blocking" for i in issues),
        "refill": refill_status(d, local_date(now(), tz)),
    }


def _siblings(store: Store, hid: str, sid: str) -> list[dict]:
    return [{"_id": d.id, **d.data} for d in store.query(_path(hid, sid))]


def _validate_responsible(store: Store, hid: str, sid: str, uid: str | None) -> None:
    if not uid:
        return
    m = store.get(f"households/{hid}/members/{uid}")
    if not m or not member_can_see(store, hid, m.data, sid) or Role(m.data["role"]) == Role.SENIOR and m.data.get("linkedSeniorId") != sid:
        raise ValidationFailed("The responsible person must be an active member with access to this profile.")


def _serial(payload: dict) -> dict:
    out = dict(payload)
    for k in ("startDate", "endDate"):
        if isinstance(out.get(k), date):
            out[k] = out[k].isoformat()
    return out


# ---------------------------------------------------------------- commands
def list_meds(store: Store, actor: CurrentUser, hid: str, sid: str, include_ended: bool = False) -> list[dict]:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    sibs = _siblings(store, hid, sid)
    out = [med_out(acc, sid, s["_id"], s, sibs) for s in sibs if include_ended or s.get("status") != "ended"]
    order = {"pending_verification": 0, "active": 1, "paused": 2, "ended": 3}
    return sorted(out, key=lambda m: (order.get(m["status"], 9), (m["name"] or "").lower()))


def get_med(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    d = store.get(_path(hid, sid, mid))
    if not d:
        raise NotFound("Medication not found.")
    return med_out(acc, sid, mid, d.data, _siblings(store, hid, sid))


def create(store: Store, actor: CurrentUser, hid: str, sid: str, payload: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    if not payload.get("name") and "name" not in (payload.get("uncertainFields") or []):
        raise ValidationFailed("Enter the medicine name, or mark it as unclear on the prescription.")
    _validate_responsible(store, hid, sid, payload.get("responsibleUid"))
    mid, t = new_id(), now()
    data = {**_serial(payload), "status": "pending_verification", "verification": None,
            "createdBy": actor.uid, "createdAt": t, "updatedAt": t}
    store.set(_path(hid, sid, mid), data)
    audit.record(store, hid, actor, "medication.create", "medication", mid,
                 f"Added medication '{data.get('name') or 'unclear name'}' — awaiting verification",
                 None, {k: data.get(k) for k in ("name", "strength", "doseQuantity", "times", "status")}, senior_id=sid)
    _notify_verifiers(store, acc, hid, sid, mid, actor)
    return get_med(store, actor, hid, sid, mid)


def _notify_verifiers(store: Store, acc: Access, hid: str, sid: str, mid: str, actor: CurrentUser) -> None:
    verifiers = [m["uid"] for m in active_members(store, hid)
                 if m["role"] in ("household_owner", "family_admin", "primary_caregiver") and member_can_see(store, hid, m, sid)]
    notifications.notify_many(store, verifiers, "medication_verification", "Medication awaiting verification",
                              f"A medication for {acc.senior(sid)['fullName']} needs checking before it can be scheduled.",
                              "/app/medication-safety", f"verify:{mid}:{now().isoformat()[:13]}", hid, exclude=actor.uid)


def update(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str, changes: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    d = store.get(_path(hid, sid, mid))
    if not d:
        raise NotFound("Medication not found.")
    before = d.data
    if before["status"] == "ended":
        raise Conflict("Ended medications can't be edited. Add a new one instead.")
    ch = _serial({k: v for k, v in changes.items() if v is not None and k not in ("clearEndDate", "clearResponsible")})
    if changes.get("clearEndDate"):
        ch["endDate"] = None
    if changes.get("clearResponsible"):
        ch["responsibleUid"] = None
    if "responsibleUid" in ch:
        _validate_responsible(store, hid, sid, ch["responsibleUid"])
    if "times" in ch:
        ch["times"] = sorted(set(ch["times"]))
    clinical = {k for k in ch if k in SAFETY_FIELDS and ch[k] != before.get(k)}
    reverify = bool(clinical) and before["status"] in ("active", "paused")
    if reverify:
        ch.update({"status": "pending_verification", "verification": None, "previousStatus": before["status"]})
    after = store.update(d.path, {**ch, "updatedAt": now()}).data
    summary = f"Updated medication '{after.get('name') or 'unclear name'}'"
    if reverify:
        summary += " — clinical details changed, re-verification required"
    audit.record(store, hid, actor, "medication.update", "medication", mid, summary,
                 {k: before.get(k) for k in ch}, {k: after.get(k) for k in ch}, senior_id=sid)
    if reverify:
        _notify_verifiers(store, acc, hid, sid, mid, actor)
    return get_med(store, actor, hid, sid, mid)


def verify(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str, acknowledge_warnings: bool, note: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.MEDS_VERIFY, CAT)
    d = store.get(_path(hid, sid, mid))
    if not d:
        raise NotFound("Medication not found.")
    if d.data["status"] != "pending_verification":
        raise Conflict("Only medications awaiting verification can be verified.")
    issues = analyse(d.data, [s for s in _siblings(store, hid, sid) if s["_id"] != mid])
    blocking = [i for i in issues if i["severity"] == "blocking"]
    if blocking:
        raise ValidationFailed("This medication can't be activated until these are resolved: "
                               + " ".join(i["message"] for i in blocking), code="verification_blocked")
    warnings = [i for i in issues if i["severity"] == "warning"]
    if warnings and not acknowledge_warnings:
        raise ValidationFailed("Review and acknowledge the warnings before verifying: "
                               + " ".join(i["message"] for i in warnings), code="warnings_unacknowledged")
    t = now()
    verification = {"verifiedBy": actor.uid, "verifiedByName": actor.display_name, "verifiedAt": t,
                    "acknowledgedWarnings": [w["code"] for w in warnings], "note": note}
    store.update(d.path, {"status": "active", "verification": verification, "updatedAt": t})
    audit.record(store, hid, actor, "medication.verify", "medication", mid,
                 f"Verified medication '{d.data['name']}' — schedule activated (approved by {actor.display_name})",
                 {"status": "pending_verification"}, {"status": "active", "approvedBy": actor.display_name}, senior_id=sid)
    return get_med(store, actor, hid, sid, mid)


def set_status(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str, status: str, reason: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_WRITE, CAT)
    d = store.get(_path(hid, sid, mid))
    if not d:
        raise NotFound("Medication not found.")
    cur = d.data["status"]
    allowed = {"active": {"paused", "ended"}, "paused": {"active", "ended"}, "pending_verification": {"ended"}}
    if status not in allowed.get(cur, set()):
        raise Conflict(f"A {cur.replace('_', ' ')} medication can't be changed to {status}.")
    if status == "active" and not d.data.get("verification"):
        raise Conflict("This medication has never been verified.")
    store.update(d.path, {"status": status, "updatedAt": now(), "statusReason": reason})
    audit.record(store, hid, actor, f"medication.{status}", "medication", mid,
                 f"Medication '{d.data['name']}' {('resumed' if status == 'active' else status)}" + (f": {reason}" if reason else ""),
                 {"status": cur}, {"status": status}, senior_id=sid)
    return get_med(store, actor, hid, sid, mid)


def refill(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str, quantity: float, note: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.CARE_LOG_WRITE, CAT)
    d = store.get(_path(hid, sid, mid))
    if not d or d.data["status"] == "ended":
        raise NotFound("Medication not found.")
    before = d.data.get("stockQuantity") or 0
    store.update(d.path, {"stockQuantity": before + quantity, "updatedAt": now()})
    audit.record(store, hid, actor, "medication.refill", "medication", mid,
                 f"Recorded refill of {quantity:g} for '{d.data['name']}'" + (f" — {note}" if note else ""),
                 {"stockQuantity": before}, {"stockQuantity": before + quantity}, senior_id=sid)
    return get_med(store, actor, hid, sid, mid)


# ---------------------------------------------------------------- doses
def slots(med: dict, tz: str, start: date, end: date) -> list[datetime]:
    if med.get("status") != "active" or not med.get("times"):
        return []
    sd = date.fromisoformat(med["startDate"]) if med.get("startDate") else start
    ed = date.fromisoformat(med["endDate"]) if med.get("endDate") else end
    out = []
    for day in daterange(max(start, sd), min(end, ed)):
        if day.weekday() in med.get("daysOfWeek", range(7)):
            out += [local_to_utc(day, t, tz) for t in med["times"]]
    return out


def _dose_id(mid: str, when: datetime) -> str:
    return f"{mid}_{aware(when).strftime('%Y%m%dT%H%M')}"


def schedule(store: Store, actor: CurrentUser, hid: str, sid: str, start: date | None, end: date | None) -> list[dict]:
    """Dose events for a date range in the SENIOR'S local dates (default: their today).
    Unrecorded past doses are 'unconfirmed'."""
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    tz = senior.get("timezone") or "UTC"
    start = start or local_date(now(), tz)
    end = end or start
    if (end - start).days > 62:
        raise ValidationFailed("Choose a range of at most 62 days.")
    return _schedule(store, hid, sid, tz, start, end)


def _schedule(store: Store, hid: str, sid: str, tz: str, start: date, end: date) -> list[dict]:
    recorded = {d.id: d.data for d in store.query(f"households/{hid}/seniors/{sid}/doseEvents")}
    t = now()
    out = []
    for m in store.query(_path(hid, sid)):
        for when in slots(m.data, tz, start, end):
            rec = recorded.get(_dose_id(m.id, when))
            status = rec["status"] if rec else ("unconfirmed" if when < t else "scheduled")
            out.append({"id": _dose_id(m.id, when), "medicationId": m.id, "medicationName": m.data.get("name"),
                        "doseQuantity": m.data.get("doseQuantity"), "doseUnit": m.data.get("doseUnit"),
                        "instructions": m.data.get("instructions"), "scheduledFor": when, "status": status,
                        "recordedBy": rec.get("recordedByName") if rec else None,
                        "recordedAt": rec.get("recordedAt") if rec else None,
                        "responsibleUid": m.data.get("responsibleUid")})
    return sorted(out, key=lambda e: (e["scheduledFor"], e["medicationName"] or ""))


def record_dose(store: Store, actor: CurrentUser, hid: str, sid: str, payload: dict) -> dict:
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid, P.CARE_LOG_WRITE, CAT)
    tz = senior.get("timezone") or "UTC"
    mid, when, status = payload["medicationId"], aware(payload["scheduledFor"]), payload["status"]
    m = store.get(_path(hid, sid, mid))
    if not m:
        raise NotFound("Medication not found.")
    if m.data["status"] != "active":
        raise Conflict("Doses can only be recorded for active, verified medications.")
    day = local_date(when, tz)
    if when not in slots(m.data, tz, day, day):
        raise ValidationFailed("That time is not a scheduled dose for this medication.")
    if when - now() > timedelta(hours=2):
        raise ValidationFailed("A dose can be recorded at most 2 hours before it is due.")
    did = _dose_id(mid, when)
    path = f"households/{hid}/seniors/{sid}/doseEvents/{did}"
    prev = store.get(path)
    prev_status = prev.data["status"] if prev else None
    store.set(path, {"medicationId": mid, "scheduledFor": when, "status": status, "note": payload.get("note", ""),
                     "recordedBy": actor.uid, "recordedByName": actor.display_name, "recordedAt": now()})
    # Stock follows confirmed intake only; changing a record reverses the earlier adjustment.
    stock = m.data.get("stockQuantity")
    if stock is not None and prev_status != status:
        q = m.data.get("doseQuantity") or 0
        delta = (-q if status == "taken" else 0) + (q if prev_status == "taken" else 0)
        if delta:
            store.update(m.path, {"stockQuantity": max(0.0, stock + delta)})
    from .jobs import _rid
    rpath = f"households/{hid}/reminders/{_rid(f'dose:{hid}:{did}')}"
    r = store.get(rpath)
    if r and r.data.get("status") in ("sent", "escalated", "acknowledged"):
        store.update(rpath, {"status": "resolved", "resolvedAt": now(), "resolvedByName": actor.display_name})
    audit.record(store, hid, actor, "dose.record", "medication", mid,
                 f"Recorded dose of '{m.data['name']}' as {status}", {"status": prev_status or "unconfirmed"},
                 {"status": status, "scheduledFor": when.isoformat()}, senior_id=sid)
    return {"id": did, "status": status}


def adherence(store: Store, actor: CurrentUser, hid: str, sid: str, days: int = 7) -> dict:
    acc = Access(store, actor.uid, hid)
    senior = acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    tz = senior.get("timezone") or "UTC"
    today = local_date(now(), tz)
    events = [e for e in _schedule(store, hid, sid, tz, today - timedelta(days=days - 1), today)
              if e["scheduledFor"] <= now()]
    per: dict[str, dict] = {}
    for e in events:
        r = per.setdefault(e["medicationId"], {"medicationId": e["medicationId"], "name": e["medicationName"],
                                               "taken": 0, "skipped": 0, "unconfirmed": 0})
        r[e["status"]] += 1
    daily: dict[str, dict] = {}
    for e in events:
        k = local_date(e["scheduledFor"], tz).isoformat()
        dd = daily.setdefault(k, {"date": k, "taken": 0, "skipped": 0, "unconfirmed": 0})
        dd[e["status"]] += 1
    tot = {s: sum(r[s] for r in per.values()) for s in ("taken", "skipped", "unconfirmed")}
    n = sum(tot.values())
    return {"days": days, "totals": tot, "recordedTakenRate": round(tot["taken"] / n, 3) if n else None,
            "byMedication": sorted(per.values(), key=lambda r: (r["name"] or "")),
            "daily": [daily[k] for k in sorted(daily)],
            "note": "'Unconfirmed' means no one recorded the dose — it does not mean it was missed."}


def journey(store: Store, actor: CurrentUser, hid: str, sid: str, mid: str) -> list[dict]:
    """Medication Journey Timeline: creation, verification, edits, status changes, refills, doses."""
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    if not store.get(_path(hid, sid, mid)):
        raise NotFound("Medication not found.")
    logs = [d for d in audit.list_logs(store, hid, sid, limit=500) if d["targetId"] == mid]
    return [{"id": l["id"], "at": l["at"], "action": l["action"], "summary": l["summary"], "actorName": l["actorName"],
             "changes": l.get("changes")} for l in reversed(logs)]  # list_logs is newest-first, tie-safe


def interaction_review(store: Store, actor: CurrentUser, hid: str, sid: str) -> dict:
    acc = Access(store, actor.uid, hid)
    acc.require(sid, P.SENIOR_MEDICAL_READ, CAT)
    meds = [m for m in _siblings(store, hid, sid) if m.get("status") in ("active", "pending_verification", "paused")]
    seen: dict[str, list[str]] = {}
    for m in meds:
        seen.setdefault(_norm(m.get("name", "")), []).append(m["_id"])
    dups = [{"name": next(x.get("name") for x in meds if x["_id"] == ids[0]), "medicationIds": ids}
            for k, ids in seen.items() if k and len(ids) > 1]
    return {"interactionCheck": "unavailable",
            "reason": "Drug-interaction screening requires a licensed, maintained clinical database, which is not yet "
                      "connected. CareHub will not generate interaction claims itself. Ask a pharmacist or doctor to "
                      "review the full medication list.",
            "duplicates": dups}
