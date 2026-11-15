"""PHASE 3 — notification automation: reminders, escalation, quiet hours, delivery, idempotency."""
from datetime import timedelta

import pytest

from app.config import get_settings
from app.services import jobs
from tests.conftest import FROZEN
from tests.test_medications import MED


@pytest.fixture()
def fam(make_actor, clock):
    owner, anita, ravi, priya = make_actor("Owner"), make_actor("Anita"), make_actor("Ravi"), make_actor("Priya")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Grandfather")
    owner.invite(hid, anita, "primary_caregiver")
    owner.invite(hid, ravi, "secondary_caregiver")
    owner.invite(hid, priya, "family_admin")
    return {"owner": owner, "anita": anita, "ravi": ravi, "priya": priya, "hid": hid, "g": g, "clock": clock}


def H(f, p=""):
    return f"/api/households/{f['hid']}{p}"


def active_med(f, times=("09:45",), responsible="ravi", **over):
    body = {**MED, "frequencyText": "", "times": list(times), **over}
    if responsible:
        body["responsibleUid"] = f[responsible].uid
    m = f["owner"].post(H(f, f"/seniors/{f['g']}/medications"), json=body).json()
    r = f["anita"].post(H(f, f"/seniors/{f['g']}/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    assert r.status_code == 200, r.text
    return m


def tick(store, f, at=None):
    if at is not None:
        f["clock"](at)
    return jobs.run_tick(store)


def inbox(actor, kind=None):
    items = actor.get("/api/me/notifications").json()["items"]
    return [n for n in items if kind is None or n["kind"] == kind]


# ------------------------------------------------------------------ idempotency primitive
def test_store_create_is_atomic(store):
    assert store.create("x/1", {"a": 1}) is True
    assert store.create("x/1", {"a": 2}) is False
    assert store.get("x/1").data == {"a": 1}


# ------------------------------------------------------------------ medication workflow
def test_dose_reminder_sent_once_to_responsible_person(fam, store):
    active_med(fam)
    s1 = tick(store, fam)                 # 10:00 IST, dose was due 09:45
    s2 = tick(store, fam)
    assert s1["reminders"] == 1 and s2["reminders"] == 0 and s2["notifications"] == 0
    n = inbox(fam["ravi"], "dose_reminder")
    assert len(n) == 1 and n[0]["ackRequired"] and n[0]["meta"]["medicationId"]
    assert "Metformin" not in n[0]["body"]          # data-minimised
    assert inbox(fam["anita"], "dose_reminder") == []


def test_no_reminders_for_unverified_medication(fam, store):
    fam["owner"].post(H(fam, f"/seniors/{fam['g']}/medications"), json={**MED, "times": ["09:45"], "frequencyText": ""})
    assert tick(store, fam)["reminders"] == 0


def test_no_flood_after_downtime(fam, store):
    active_med(fam, times=("07:00",))     # 3 hours ago, no reminder was ever sent
    assert tick(store, fam)["reminders"] == 0


def test_escalation_steps_and_honest_wording(fam, store):
    active_med(fam)
    tick(store, fam)
    tick(store, fam, FROZEN + timedelta(minutes=16))   # 30 min after 09:45 → step 1 (primary caregivers)
    esc = inbox(fam["anita"], "dose_escalation")
    assert len(esc) == 1 and "doesn't mean it was missed" in esc[0]["body"]
    assert inbox(fam["priya"], "dose_escalation") == []
    tick(store, fam, FROZEN + timedelta(minutes=76))   # 90 min → step 2 (admins + owner)
    assert len(inbox(fam["priya"], "dose_escalation")) == 1 and len(inbox(fam["owner"], "dose_escalation")) == 1
    tick(store, fam, FROZEN + timedelta(minutes=200))
    assert len(inbox(fam["anita"], "dose_escalation")) == 1        # never repeated
    acts = fam["owner"].get(H(fam, "/reminders")).json()
    assert acts[0]["status"] == "escalated" and [e["step"] for e in acts[0]["escalations"]] == [1, 2]


def test_recording_the_dose_resolves_reminder_and_stops_escalation(fam, store):
    m = active_med(fam)
    tick(store, fam)
    slot = (FROZEN - timedelta(minutes=15)).isoformat()
    fam["ravi"].post(H(fam, f"/seniors/{fam['g']}/doses"), json={"medicationId": m["id"], "scheduledFor": slot, "status": "taken"})
    tick(store, fam, FROZEN + timedelta(minutes=100))
    assert inbox(fam["anita"], "dose_escalation") == []
    r = fam["owner"].get(H(fam, "/reminders")).json()[0]
    assert r["status"] == "resolved"


def test_acknowledgement_stops_escalation_but_does_not_record_dose(fam, store):
    active_med(fam)
    tick(store, fam)
    n = inbox(fam["ravi"], "dose_reminder")[0]
    assert fam["ravi"].post(f"/api/me/notifications/{n['id']}/acknowledge").status_code == 200
    tick(store, fam, FROZEN + timedelta(minutes=100))
    assert inbox(fam["anita"], "dose_escalation") == []
    r = fam["owner"].get(H(fam, "/reminders")).json()[0]
    assert r["status"] == "acknowledged" and r["acknowledgedByName"] == "Ravi"
    doses = fam["owner"].get(H(fam, f"/seniors/{fam['g']}/doses")).json()
    assert doses[0]["status"] == "unconfirmed"


def test_quiet_hours_hold_escalations_until_morning(fam, store):
    active_med(fam, times=("21:45",))
    tick(store, fam, FROZEN + timedelta(hours=11, minutes=50))     # 21:50 IST → reminder (reminders aren't held)
    assert len(inbox(fam["ravi"], "dose_reminder")) == 1
    tick(store, fam, FROZEN + timedelta(hours=12, minutes=20))     # 22:20 → step 1 due but quiet hours
    assert inbox(fam["anita"], "dose_escalation") == []
    assert fam["owner"].get(H(fam, "/reminders")).json()[0]["heldUntil"] is not None
    tick(store, fam, FROZEN + timedelta(hours=21, minutes=5))      # 07:05 next day → released
    assert len(inbox(fam["anita"], "dose_escalation")) == 1


def test_without_responsible_person_first_tier_is_reminded(fam, store):
    active_med(fam, responsible=None)
    tick(store, fam)
    assert len(inbox(fam["anita"], "dose_reminder")) == 1


def test_escalation_respects_scope_and_consent(fam, store, make_actor):
    grandpa = make_actor("Grandpa")
    fam["owner"].invite(fam["hid"], grandpa, "senior", linked=fam["g"])
    active_med(fam)
    grandpa.post(H(fam, f"/seniors/{fam['g']}/consents/{fam['anita'].uid}/revoke"))
    tick(store, fam)
    tick(store, fam, FROZEN + timedelta(minutes=16))
    assert inbox(fam["anita"], "dose_escalation") == []   # access revoked by the senior → not contacted


# ------------------------------------------------------------------ appointment workflow
def appt(f, hours, escort=None):
    body = {"title": "Cardiology", "startsAt": (FROZEN + timedelta(hours=hours)).isoformat()}
    if escort:
        body["escortUid"] = f[escort].uid
    return f["owner"].post(H(f, f"/seniors/{f['g']}/appointments"), json=body).json()


def test_appointment_reminders_and_postponement(fam, store):
    a = appt(fam, 23, escort="ravi")
    fam["ravi"].post(H(fam, f"/seniors/{fam['g']}/appointments/{a['id']}/escort"), json={"action": "accept"})
    tick(store, fam)
    tick(store, fam)
    assert len(inbox(fam["ravi"], "appointment_reminder")) == 1
    tick(store, fam, FROZEN + timedelta(hours=21, minutes=40))      # ~1.3 h before → 2-hour reminder
    assert len(inbox(fam["ravi"], "appointment_reminder")) == 2
    fam["owner"].post(H(fam, f"/seniors/{fam['g']}/appointments/{a['id']}/postpone"),
                      json={"newStartsAt": (FROZEN + timedelta(hours=40)).isoformat()})
    tick(store, fam, FROZEN + timedelta(hours=22))                  # new time → fresh 24-hour reminder
    assert len(inbox(fam["ravi"], "appointment_reminder")) == 3


def test_escort_confirmation_and_no_escort_alerts(fam, store):
    appt(fam, 20, escort="ravi")          # unconfirmed, < 24 h
    appt(fam, 30)                          # nobody accompanying, < 48 h
    tick(store, fam)
    assert len(inbox(fam["ravi"], "escort_confirm")) == 1
    assert len(inbox(fam["priya"], "escort_unconfirmed")) == 1
    assert len(inbox(fam["anita"], "no_escort")) == 1


# ------------------------------------------------------------------ caregiver workflow
def test_task_due_overdue_and_acceptance_reminders(fam, store):
    due = (FROZEN + timedelta(hours=1)).isoformat()
    t = fam["owner"].post(H(fam, "/tasks"), json={"title": "Collect report", "seniorId": fam["g"], "dueAt": due,
                                                  "assigneeUid": fam["ravi"].uid}).json()
    tick(store, fam)
    assert len(inbox(fam["ravi"], "task_due")) == 1
    tick(store, fam, FROZEN + timedelta(hours=2))
    assert len(inbox(fam["ravi"], "task_overdue")) == 1 and len(inbox(fam["owner"], "task_overdue")) == 1
    tick(store, fam, FROZEN + timedelta(hours=25))
    assert len(inbox(fam["ravi"], "task_accept")) == 1
    assert t["status"] == "assigned"


def test_handover_reminder_then_escalation(fam, store):
    fam["anita"].post(H(fam, "/handovers"), json={"toUid": fam["ravi"].uid, "seniorIds": [fam["g"]]})
    tick(store, fam, FROZEN + timedelta(hours=13))                 # 23:00 IST — quiet hours: held
    assert inbox(fam["ravi"], "handover_reminder") == []
    tick(store, fam, FROZEN + timedelta(hours=22))                 # 08:00 next day
    assert len(inbox(fam["ravi"], "handover_reminder")) == 1 and inbox(fam["priya"], "handover_unacknowledged") == []
    tick(store, fam, FROZEN + timedelta(hours=26))
    assert len(inbox(fam["priya"], "handover_unacknowledged")) == 1


def test_low_stock_alert_only_when_level_worsens(fam, store):
    m = active_med(fam, times=("08:00", "20:00"), stockQuantity=12)   # 6 days → low
    tick(store, fam)
    tick(store, fam)
    assert len(inbox(fam["owner"], "low_stock")) == 1
    fam["owner"].patch(H(fam, f"/seniors/{fam['g']}/medications/{m['id']}"), json={"stockQuantity": 4})  # critical
    tick(store, fam)
    assert len(inbox(fam["owner"], "low_stock")) == 2


def test_consent_expiry_notice(fam, store, make_actor):
    fam["owner"].put(H(fam, f"/seniors/{fam['g']}/consents/{fam['ravi'].uid}"),
                     json={"categories": ["appointments"], "expiresAt": (FROZEN + timedelta(days=2)).isoformat()})
    tick(store, fam)
    assert len(inbox(fam["ravi"], "consent_expiring")) == 1


# ------------------------------------------------------------------ delivery channels
def test_email_delivery_recorded_honestly(fam, store, monkeypatch):
    fam["ravi"].put("/api/me/notification-preferences", json={"email": True})
    active_med(fam)
    tick(store, fam)
    n = inbox(fam["ravi"], "dose_reminder")[0]
    assert {"channel": "email", "status": "skipped_not_configured"}.items() <= next(d for d in n["deliveries"] if d["channel"] == "email").items()

    sent = []

    class R:
        status_code = 200

    s = get_settings()
    monkeypatch.setattr(s, "email_provider", "resend")
    monkeypatch.setattr(s, "email_api_key", "re_test_key_for_unit_tests")
    monkeypatch.setattr("app.services.delivery.httpx.post", lambda url, **kw: sent.append((url, kw)) or R())
    fam["owner"].post(H(fam, "/tasks"), json={"title": "x", "assigneeUid": fam["ravi"].uid})
    task_note = inbox(fam["ravi"], "task_assigned")[0]
    assert next(d for d in task_note["deliveries"] if d["channel"] == "email")["status"] == "delivered"
    assert sent and sent[0][0] == "https://api.resend.com/emails" and "x" not in sent[0][1]["json"]["subject"].split()


def test_notification_preferences_report_channel_status(fam):
    p = fam["ravi"].get("/api/me/notification-preferences").json()
    assert p["prefs"] == {"email": False, "push": False} and p["channels"]["email"] == "not_configured"


# ------------------------------------------------------------------ rules & endpoints
def test_rules_validation_permissions_and_audit(fam):
    r = fam["ravi"].put(H(fam, "/notification-rules"), json={"lowStockAlerts": False})
    assert r.status_code == 403
    bad = fam["owner"].put(H(fam, "/notification-rules"), json={"escalationSteps": [{"afterMinutes": 60, "roles": ["family_admin"]},
                                                                                     {"afterMinutes": 30, "roles": ["household_owner"]}]})
    assert bad.status_code == 422
    ok = fam["owner"].put(H(fam, "/notification-rules"), json={"escalationSteps": [{"afterMinutes": 15, "roles": ["family_admin"]}],
                                                              "quietHours": {"enabled": False, "start": "22:00", "end": "07:00"}})
    assert ok.json()["escalationSteps"][0]["afterMinutes"] == 15
    assert fam["ravi"].get(H(fam, "/notification-rules")).json()["quietHours"]["enabled"] is False
    assert fam["owner"].get(H(fam, "/audit?targetType=settings")).json()[0]["action"] == "settings.notifications"


def test_custom_escalation_rules_are_applied(fam, store):
    fam["owner"].put(H(fam, "/notification-rules"), json={"escalationSteps": [{"afterMinutes": 10, "roles": ["family_admin"]}]})
    active_med(fam)
    tick(store, fam)                                  # 15 min after the dose: reminder + immediate step
    tick(store, fam)
    assert len(inbox(fam["priya"], "dose_escalation")) == 1 and inbox(fam["anita"], "dose_escalation") == []


def test_admin_run_now_is_scoped_and_idempotent(fam, make_actor):
    active_med(fam)
    assert fam["ravi"].post(H(fam, "/reminders/run")).status_code == 403
    first = fam["owner"].post(H(fam, "/reminders/run")).json()
    second = fam["owner"].post(H(fam, "/reminders/run")).json()
    assert first["reminders"] == 1 and second["reminders"] == 0
    outsider = make_actor("Outsider")
    assert outsider.post(H(fam, "/reminders/run")).status_code == 404


def test_internal_tick_requires_token(client, monkeypatch):
    assert client.post("/api/internal/jobs/tick").status_code == 404           # disabled without a token
    monkeypatch.setattr(get_settings(), "job_token", "t" * 40)
    assert client.post("/api/internal/jobs/tick", headers={"X-Job-Token": "wrong"}).status_code == 401
    r = client.post("/api/internal/jobs/tick", headers={"X-Job-Token": "t" * 40})
    assert r.status_code == 200 and "households" in r.json()


def test_tick_isolates_households(fam, store, make_actor):
    other = make_actor("Other")
    h2 = other.create_household("Second")
    s2 = other.add_senior(h2, "Nana")
    m = other.post(f"/api/households/{h2}/seniors/{s2}/medications", json={**MED, "times": ["09:45"], "frequencyText": ""}).json()
    other.post(f"/api/households/{h2}/seniors/{s2}/medications/{m['id']}/verify", json={"acknowledgeWarnings": True})
    tick(store, fam)
    tick(store, fam, FROZEN + timedelta(minutes=100))
    assert len(inbox(other, "dose_reminder")) == 1                         # no responsible → owner tier... and only them
    for a in ("owner", "anita", "ravi", "priya"):
        assert inbox(fam[a], "dose_reminder") == [] or all(n["householdId"] == fam["hid"] for n in inbox(fam[a]))


def test_production_requires_job_token():
    from app.config import Settings

    with pytest.raises(RuntimeError):
        Settings(environment="production", jwt_secret="x" * 40, data_store="firestore").validate_for_production()
    Settings(environment="production", jwt_secret="x" * 40, data_store="firestore", job_token="j" * 40).validate_for_production()
