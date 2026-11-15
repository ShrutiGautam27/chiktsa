"""ENGINE 1 (Care Continuity) and ENGINE 3 (Family Coordination), plus appointments & tasks."""
from datetime import timedelta

import pytest

from tests.conftest import FROZEN
from tests.test_medications import MED


@pytest.fixture()
def fam(make_actor, clock):
    owner, anita, ravi, priya = make_actor("Owner"), make_actor("Anita"), make_actor("Ravi"), make_actor("Priya")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Grandfather")
    m = owner.add_senior(hid, "Grandmother")
    owner.invite(hid, anita, "primary_caregiver")
    owner.invite(hid, ravi, "secondary_caregiver")
    owner.invite(hid, priya, "family_member", scope=[m])
    return {"owner": owner, "anita": anita, "ravi": ravi, "priya": priya, "hid": hid, "g": g, "m": m}


def H(f, path=""):
    return f"/api/households/{f['hid']}{path}"


def appt(f, sid=None, hours=24, escort=None, actor=None):
    body = {"title": "Cardiology review", "startsAt": (FROZEN + timedelta(hours=hours)).isoformat(), "durationMinutes": 45}
    if escort:
        body["escortUid"] = escort
    r = (actor or f["owner"]).post(H(f, f"/seniors/{sid or f['g']}/appointments"), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def task(f, actor=None, **over):
    body = {"title": "Collect test results", "seniorId": f["g"], **over}
    r = (actor or f["owner"]).post(H(f, "/tasks"), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def gap_types(f, actor=None, sid=None):
    url = H(f, "/gaps") + (f"?seniorId={sid}" if sid else "")
    return [g["type"] for g in (actor or f["owner"]).get(url).json()["gaps"]]


# ------------------------------------------------------------------ appointments
def test_escort_request_accept_and_postpone_requires_reconfirmation(fam):
    a = appt(fam, escort=fam["anita"].uid)
    assert a["escortAccepted"] is False
    notes = fam["anita"].get("/api/me/notifications").json()
    assert notes["unread"] == 1 and notes["items"][0]["kind"] == "escort_request"
    assert "Cardiology" not in notes["items"][0]["body"]  # data-minimised notification
    url = H(fam, f"/seniors/{fam['g']}/appointments/{a['id']}")
    assert fam["ravi"].post(url + "/escort", json={"action": "accept"}).status_code == 403  # not the escort
    assert fam["anita"].post(url + "/escort", json={"action": "accept"}).json()["escortAccepted"] is True
    new = (FROZEN + timedelta(days=3)).isoformat()
    r = fam["owner"].post(url + "/postpone", json={"newStartsAt": new, "reason": "Doctor on leave"}).json()
    assert r["escortAccepted"] is False and len(r["history"]) == 1 and r["history"][0]["reason"] == "Doctor on leave"


def test_volunteer_and_escort_eligibility(fam):
    a = appt(fam, sid=fam["m"])
    url = H(fam, f"/seniors/{fam['m']}/appointments/{a['id']}/escort")
    assert fam["priya"].post(url, json={"action": "volunteer"}).json()["escortUid"] == fam["priya"].uid
    assert fam["ravi"].post(url, json={"action": "volunteer"}).status_code == 409
    # Priya can't be escort for Grandfather (out of her scope)
    r = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/appointments"),
                          json={"title": "X", "startsAt": (FROZEN + timedelta(days=1)).isoformat(), "escortUid": fam["priya"].uid})
    assert r.status_code == 422


def test_naive_timestamps_rejected(fam):
    r = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/appointments"), json={"title": "X", "startsAt": "2026-12-01T10:00:00"})
    assert r.status_code == 422


# ------------------------------------------------------------------ tasks
def test_task_lifecycle_and_permissions(fam):
    t = task(fam, assigneeUid=fam["ravi"].uid)
    assert t["status"] == "assigned"
    base = H(fam, f"/tasks/{t['id']}")
    assert fam["anita"].post(base + "/accept").status_code == 403
    assert fam["ravi"].post(base + "/accept").json()["status"] == "accepted"
    assert fam["ravi"].post(base + "/decline").json()["status"] == "open"
    assert fam["anita"].post(base + "/claim").json()["assigneeUid"] == fam["anita"].uid
    assert fam["anita"].post(base + "/complete", json={"note": "Done"}).json()["status"] == "done"
    assert fam["ravi"].post(H(fam, "/tasks"), json={"title": "x"}).status_code == 403  # secondary can't create


def test_task_visibility_and_redaction(fam):
    task(fam, title="Check Grandfather's tablets", kind="medication_check")
    task(fam, title="Buy groceries", seniorId=None, kind="household")
    priya_titles = [t["title"] for t in fam["priya"].get(H(fam, "/tasks")).json()]
    assert priya_titles == ["Buy groceries"]  # Grandfather out of Priya's scope
    # Assignee must be able to see the profile
    r = fam["owner"].post(H(fam, "/tasks"), json={"title": "x", "seniorId": fam["g"], "assigneeUid": fam["priya"].uid})
    assert r.status_code == 422


# ------------------------------------------------------------------ ENGINE 1: gaps
def test_gap_detector_finds_responsibility_gaps(fam):
    appt(fam, hours=20)                                      # no escort, <48h → high
    task(fam, dueAt=(FROZEN + timedelta(hours=5)).isoformat())   # unassigned, due soon
    m = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/medications"), json={**MED}).json()  # unverified, no responsible
    fam["anita"].post(H(fam, f"/seniors/{fam['g']}/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    data = fam["owner"].get(H(fam, "/gaps")).json()
    types = {g["type"]: g for g in data["gaps"]}
    assert types["appointment_no_escort"]["severity"] == "high"
    assert types["task_unassigned"]["severity"] == "high"
    assert "medication_no_responsible" in types
    assert data["gaps"][0]["severity"] == "high"  # sorted by severity
    assert "diagnos" not in str(data).lower()


def test_gaps_for_revoked_member_and_unacknowledged_handover(fam, clock):
    t = task(fam, assigneeUid=fam["ravi"].uid)
    fam["owner"].delete(H(fam, f"/members/{fam['ravi'].uid}"))
    assert "task_assignee_inactive" in gap_types(fam)
    fam["anita"].post(H(fam, "/handovers"), json={"toUid": fam["owner"].uid, "seniorIds": [fam["g"]]})
    clock(FROZEN + timedelta(hours=13))
    gaps = {g["type"]: g for g in fam["owner"].get(H(fam, "/gaps")).json()["gaps"]}
    assert gaps["handover_unacknowledged"]["severity"] == "high"
    assert t["id"] in gaps["task_assignee_inactive"]["targetId"]


def test_gaps_respect_scope(fam):
    appt(fam, sid=fam["g"])
    assert "appointment_no_escort" not in gap_types(fam, fam["priya"])  # Grandfather not in Priya's scope


# ------------------------------------------------------------------ ENGINE 1: handover passport
def test_handover_passport_snapshot_and_acknowledgement(fam):
    done = task(fam, assigneeUid=fam["anita"].uid)
    fam["anita"].post(H(fam, f"/tasks/{done['id']}/accept"))
    fam["anita"].post(H(fam, f"/tasks/{done['id']}/complete"))
    task(fam, title="Refill pill box")
    appt(fam, hours=30)
    r = fam["anita"].post(H(fam, "/handovers"), json={
        "toUid": fam["ravi"].uid, "seniorIds": [fam["g"]], "observations": "Slept well; ate breakfast.",
        "instructions": ["Call clinic about report"]})
    assert r.status_code == 201
    snap = r.json()["snapshot"]
    assert [t["title"] for t in snap["completedTasks"]] == ["Collect test results"]
    assert [t["title"] for t in snap["pendingTasks"]] == ["Refill pill box"]
    assert len(snap["upcomingAppointments"]) == 1
    hoid = r.json()["id"]
    assert fam["owner"].post(H(fam, f"/handovers/{hoid}/acknowledge"), json={}).status_code == 403
    assert fam["ravi"].post(H(fam, f"/handovers/{hoid}/acknowledge"), json={"note": "Got it"}).json()["status"] == "acknowledged"
    assert fam["ravi"].post(H(fam, f"/handovers/{hoid}/acknowledge"), json={}).status_code == 409


def test_handover_target_must_cover_all_profiles(fam):
    r = fam["anita"].post(H(fam, "/handovers"), json={"toUid": fam["priya"].uid, "seniorIds": [fam["g"]]})
    assert r.status_code == 422


# ------------------------------------------------------------------ ENGINE 1: absence protocol (Scenario D)
def test_scenario_d_caregiver_unavailable_backup_accepts(fam):
    """Scenario D: a caregiver becomes unavailable and another authorised caregiver accepts the handover."""
    t = task(fam, assigneeUid=fam["anita"].uid, dueAt=(FROZEN + timedelta(days=1)).isoformat())
    fam["anita"].post(H(fam, f"/tasks/{t['id']}/accept"))
    a = appt(fam, hours=26, escort=fam["anita"].uid)
    r = fam["anita"].post(H(fam, "/absences"), json={"startsAt": FROZEN.isoformat(),
                                                    "endsAt": (FROZEN + timedelta(days=2)).isoformat(), "reason": "Family emergency"})
    assert r.status_code == 201
    ab = r.json()
    assert {i["type"] for i in ab["items"]} == {"task", "appointment"} and ab["uncovered"] == 2
    cands = {c["uid"] for c in ab["items"][0]["candidates"]}
    assert fam["ravi"].uid in cands and fam["anita"].uid not in cands and fam["priya"].uid not in cands
    assert "task_cover_needed" in gap_types(fam) and "escort_cover_needed" in gap_types(fam)
    assert any(n["kind"] == "cover_request" for n in fam["ravi"].get("/api/me/notifications").json()["items"])
    assert any(n["kind"] == "absence" for n in fam["owner"].get("/api/me/notifications").json()["items"])
    # Ravi accepts both
    assert fam["priya"].post(H(fam, f"/absences/{ab['id']}/cover"), json={"itemType": "task", "itemId": t["id"]}).status_code == 403
    fam["ravi"].post(H(fam, f"/absences/{ab['id']}/cover"), json={"itemType": "task", "itemId": t["id"]})
    r = fam["ravi"].post(H(fam, f"/absences/{ab['id']}/cover"), json={"itemType": "appointment", "itemId": a["id"]})
    assert r.json()["uncovered"] == 0
    assert fam["owner"].get(H(fam, "/tasks?mine=false")).json()[0]["assigneeUid"] == fam["ravi"].uid
    assert not {"task_cover_needed", "escort_cover_needed"} & set(gap_types(fam))
    assert fam["owner"].post(H(fam, f"/absences/{ab['id']}/cover"), json={"itemType": "task", "itemId": t["id"]}).status_code == 409
    log = fam["owner"].get(H(fam, "/audit?targetType=task")).json()
    assert any("while Anita is away" in entry["summary"] for entry in log)


# ------------------------------------------------------------------ ENGINE 1: What-If simulator
def test_simulator_caregiver_unavailable_is_read_only(fam, store):
    t = task(fam, assigneeUid=fam["anita"].uid)
    m = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/medications"), json={**MED, "responsibleUid": fam["anita"].uid}).json()
    fam["anita"].post(H(fam, f"/seniors/{fam['g']}/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    before = len(store.query(f"households/{fam['hid']}/auditLogs"))
    r = fam["owner"].post(H(fam, "/simulate"), json={"scenario": "caregiver_unavailable", "uid": fam["anita"].uid,
                                                    "startsAt": FROZEN.isoformat(), "endsAt": (FROZEN + timedelta(days=1)).isoformat()}).json()
    assert r["affectedResponsibilities"][0]["id"] == t["id"]
    assert r["doseConfirmationDuties"][0]["dosesToConfirm"] == 2  # 20:00 today + 08:00 tomorrow
    assert "not a medical prediction" in r["disclaimer"]
    assert len(store.query(f"households/{fam['hid']}/auditLogs")) == before  # nothing written
    assert fam["ravi"].post(H(fam, "/simulate"), json={"scenario": "connectivity_failure", "hours": 4}).status_code == 403


def test_simulator_other_scenarios(fam):
    a = appt(fam, hours=24, escort=fam["anita"].uid)
    appt(fam, sid=fam["m"], hours=72, escort=fam["anita"].uid)
    r = fam["owner"].post(H(fam, "/simulate"), json={"scenario": "appointment_postponed", "appointmentId": a["id"],
                                                    "newStartsAt": (FROZEN + timedelta(hours=72)).isoformat()}).json()
    assert "escort_double_booked" in [e["type"] for e in r["effects"]]
    m = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/medications"), json={**MED, "stockQuantity": 6}).json()
    fam["anita"].post(H(fam, f"/seniors/{fam['g']}/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    s = fam["owner"].post(H(fam, "/simulate"), json={"scenario": "stock_depletion", "medicationId": m["id"]}).json()
    assert s["refill"]["daysRemaining"] == 3 and s["dosesWithoutStockNext30Days"] > 0
    o = fam["owner"].post(H(fam, "/simulate"), json={"scenario": "connectivity_failure", "hours": 12}).json()
    assert len(o["dosesToRecordLater"]) == 1 and "synced when the connection returns" in o["limitations"]
    bad = fam["owner"].post(H(fam, "/simulate"), json={"scenario": "caregiver_unavailable"})
    assert bad.status_code == 422


# ------------------------------------------------------------------ ENGINE 3: contribution & balancer
def test_workload_imbalance_and_balancer_suggestions(fam):
    for i in range(4):
        task(fam, title=f"Task {i}", assigneeUid=fam["anita"].uid)
    task(fam, title="Unowned")
    c = fam["owner"].get(H(fam, "/contribution")).json()
    rows = {r["displayName"]: r for r in c["members"]}
    assert rows["Anita"]["currentLoad"] == 4 and rows["Anita"]["imbalanced"] is True
    assert c["unassignedTasks"] == 1
    assert [r["displayName"] for r in c["members"]] == sorted(r["displayName"] for r in c["members"])  # not ranked
    sug = c["suggestions"]
    assert sug and all(s["fromUid"] == fam["anita"].uid for s in sug)
    assert all(s["toUid"] != fam["priya"].uid for s in sug)  # Priya can't see Grandfather
    # Applying a suggestion is an explicit reassignment
    r = fam["owner"].post(H(fam, f"/tasks/{sug[0]['taskId']}/reassign"), json={"assigneeUid": sug[0]["toUid"]})
    assert r.json()["assigneeUid"] == sug[0]["toUid"]
    # Non-coordinators only see their own row and no suggestions
    own = fam["ravi"].get(H(fam, "/contribution")).json()
    assert [r["uid"] for r in own["members"]] == [fam["ravi"].uid] and own["suggestions"] == []


# ------------------------------------------------------------------ ENGINE 3: cross-household views
def test_overview_and_responsibility_centre_across_households(fam, make_actor):
    other = make_actor("OtherOwner")
    h2 = other.create_household("Second Home")
    s2 = other.add_senior(h2, "Nana")
    other.invite(h2, fam["anita"], "primary_caregiver")
    other.post(f"/api/households/{h2}/tasks", json={"title": "Pharmacy run", "seniorId": s2, "assigneeUid": fam["anita"].uid})
    task(fam, title="Collect report", assigneeUid=fam["anita"].uid)
    ov = {o["householdName"]: o for o in fam["anita"].get("/api/me/overview").json()}
    assert ov["Second Home"]["myOpenTasks"] == 1 and ov["Sharma Family"]["myOpenTasks"] == 1
    rc = fam["anita"].get("/api/me/responsibilities").json()
    assert {t["householdName"] for t in rc["myTasks"]} == {"Second Home", "Sharma Family"}
    # Owner of household 1 sees nothing from household 2
    assert "Second Home" not in [o["householdName"] for o in fam["owner"].get("/api/me/overview").json()]


# ------------------------------------------------------------------ ENGINE 3: consent expiry manager
def test_consent_limits_revokes_and_expires(fam, make_actor, clock):
    grandpa = make_actor("Grandpa")
    fam["owner"].invite(fam["hid"], grandpa, "senior", linked=fam["g"])
    base = H(fam, f"/seniors/{fam['g']}")
    fam["owner"].post(base + "/medications", json=MED)
    # The senior manages their own consent; the owner can no longer act on their behalf
    assert fam["owner"].put(base + f"/consents/{fam['ravi'].uid}", json={"categories": []}).status_code == 403
    r = grandpa.put(base + f"/consents/{fam['ravi'].uid}", json={"categories": ["appointments"],
                                                                 "expiresAt": (FROZEN + timedelta(days=2)).isoformat()})
    assert r.status_code == 200
    row = next(m for m in r.json()["members"] if m["uid"] == fam["ravi"].uid)
    assert row["state"] == "limited" and row["expiringSoon"] is True
    assert fam["ravi"].get(base + "/medications").status_code == 403         # medications not shared
    assert fam["ravi"].get(base + "/appointments").status_code == 200
    clock(FROZEN + timedelta(days=3))                                        # temporary access expired
    assert fam["ravi"].get(base).status_code == 404
    assert fam["g"] not in [s["id"] for s in fam["ravi"].get(H(fam, "/seniors")).json()]
    grandpa.delete(base + f"/consents/{fam['ravi'].uid}")                     # restore standard access
    assert fam["ravi"].get(base + "/medications").status_code == 200
    grandpa.post(base + f"/consents/{fam['anita'].uid}/revoke")
    assert fam["anita"].get(base).status_code == 404
    assert grandpa.put(base + f"/consents/{fam['owner'].uid}", json={"categories": []}).status_code == 422  # owner exempt
    hist = grandpa.get(base + "/consents").json()["history"]
    assert len(hist) == 3


def test_admin_manages_consent_for_senior_without_login(fam):
    base = H(fam, f"/seniors/{fam['m']}")
    assert fam["owner"].put(base + f"/consents/{fam['priya'].uid}", json={"categories": ["appointments"]}).status_code == 200
    assert fam["anita"].put(base + f"/consents/{fam['priya'].uid}", json={"categories": []}).status_code == 403


# ------------------------------------------------------------------ notifications & change detective
def test_notifications_are_idempotent_and_markable(fam, store):
    from app.services import notifications

    assert notifications.notify(store, fam["ravi"].uid, "x", "t", "b", "/", "same-key") is True
    assert notifications.notify(store, fam["ravi"].uid, "x", "t", "b", "/", "same-key") is False
    data = fam["ravi"].get("/api/me/notifications").json()
    assert data["unread"] == 1
    fam["ravi"].post(f"/api/me/notifications/{data['items'][0]['id']}/read")
    assert fam["ravi"].get("/api/me/notifications").json()["unread"] == 0


def test_change_detective_shows_who_changed_and_who_approved(fam):
    m = fam["owner"].post(H(fam, f"/seniors/{fam['g']}/medications"), json=MED).json()
    fam["anita"].post(H(fam, f"/seniors/{fam['g']}/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    logs = fam["owner"].get(H(fam, f"/audit?targetType=medication&seniorId={fam['g']}")).json()
    verify_log = next(entry for entry in logs if entry["action"] == "medication.verify")
    assert verify_log["actorName"] == "Anita" and verify_log["changes"]["approvedBy"]["to"] == "Anita"
    assert verify_log["changes"]["status"] == {"from": "pending_verification", "to": "active"}
    by_anita = fam["owner"].get(H(fam, f"/audit?actorUid={fam['anita'].uid}")).json()
    assert all(entry["actorUid"] == fam["anita"].uid for entry in by_anita)
