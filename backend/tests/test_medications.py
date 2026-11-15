"""ENGINE 2 — Medication Safety Intelligence."""
from datetime import timedelta

import pytest

from tests.conftest import FROZEN

MED = {"name": "Metformin", "strength": "500 mg", "doseQuantity": 1, "doseUnit": "tablet", "frequencyText": "BD",
       "times": ["08:00", "20:00"], "startDate": "2026-11-01", "instructions": "After food"}


@pytest.fixture()
def fam(make_actor, clock):
    """Owner + primary caregiver (can verify) + secondary caregiver (cannot) + two seniors."""
    owner, primary, secondary = make_actor("Owner"), make_actor("Primary"), make_actor("Secondary")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Grandfather")
    m = owner.add_senior(hid, "Grandmother")
    owner.invite(hid, primary, "primary_caregiver")
    owner.invite(hid, secondary, "secondary_caregiver")
    return {"owner": owner, "primary": primary, "secondary": secondary, "hid": hid, "g": g, "m": m}


def med_url(f, sid=None, suffix=""):
    return f"/api/households/{f['hid']}/seniors/{sid or f['g']}/medications{suffix}"


def add_med(f, actor=None, sid=None, **over):
    body = {**MED, "responsibleUid": f["primary"].uid, **over}
    r = (actor or f["owner"]).post(med_url(f, sid), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def verify(f, mid, actor=None, sid=None, ack=True):
    return (actor or f["primary"]).post(med_url(f, sid, f"/{mid}/verify"), json={"acknowledgeWarnings": ack})


def test_new_medication_is_never_active_without_verification(fam):
    med = add_med(fam)
    assert med["status"] == "pending_verification" and med["verification"] is None
    # No doses are scheduled for an unverified medication
    doses = fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses").json()
    assert doses == []
    r = verify(fam, med["id"])
    assert r.status_code == 200 and r.json()["status"] == "active"
    assert r.json()["verification"]["verifiedByName"] == "Primary"
    assert len(fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses").json()) == 2


def test_scenario_e_unclear_field_blocks_activation(fam):
    """Scenario E: an uploaded prescription with an unclear field must not become active until verified."""
    med = add_med(fam, source="prescription", prescriptionText="Tab Metformin 500mg 1-0-1", uncertainFields=["doseQuantity"])
    assert med["blockingCount"] == 1 and med["issues"][0]["code"] == "unclear_field"
    r = verify(fam, med["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "verification_blocked"
    assert fam["owner"].get(med_url(fam, suffix=f"/{med['id']}")).json()["status"] == "pending_verification"
    # Human confirms the field against the original and clears the flag → can be verified
    fam["owner"].patch(med_url(fam, suffix=f"/{med['id']}"), json={"uncertainFields": []})
    assert verify(fam, med["id"]).json()["status"] == "active"


def test_blank_name_allowed_only_when_flagged_unclear(fam):
    r = fam["owner"].post(med_url(fam), json={**MED, "name": ""})
    assert r.status_code == 422
    med = add_med(fam, name="", uncertainFields=["name"])
    assert any(i["code"] == "unclear_field" and i["field"] == "name" for i in med["issues"])


@pytest.mark.parametrize("over,code", [
    ({"frequencyText": "TDS"}, "frequency_conflict"),             # 3/day written, 2 times scheduled
    ({"strength": "5.0 mg"}, "error_prone_notation"),             # trailing zero
    ({"strength": ".5 mg"}, "error_prone_notation"),              # missing leading zero
    ({"frequencyText": "QOD"}, "error_prone_notation"),           # ISMP do-not-use
    ({"times": []}, "missing_field"),
    ({"endDate": "2026-10-01"}, "date_conflict"),
])
def test_ambiguity_detector_blocking_issues(fam, over, code):
    med = add_med(fam, **over)
    assert code in [i["code"] for i in med["issues"] if i["severity"] == "blocking"]
    assert verify(fam, med["id"]).status_code == 422


def test_warnings_need_explicit_acknowledgement(fam):
    first = add_med(fam)
    verify(fam, first["id"])
    dup = add_med(fam)  # same name → possible duplicate (warning, not blocking)
    assert "possible_duplicate" in [i["code"] for i in dup["issues"] if i["severity"] == "warning"]
    r = verify(fam, dup["id"], ack=False)
    assert r.status_code == 422 and r.json()["error"]["code"] == "warnings_unacknowledged"
    r = verify(fam, dup["id"], ack=True)
    assert r.status_code == 200 and r.json()["verification"]["acknowledgedWarnings"] == ["possible_duplicate"]


def test_only_authorised_roles_verify_and_write(fam):
    med = add_med(fam)
    assert verify(fam, med["id"], actor=fam["secondary"]).status_code == 403
    assert fam["secondary"].post(med_url(fam), json=MED).status_code == 403
    assert verify(fam, med["id"], actor=fam["owner"]).status_code == 200


def test_editing_clinical_fields_requires_reverification(fam):
    med = add_med(fam)
    verify(fam, med["id"])
    r = fam["owner"].patch(med_url(fam, suffix=f"/{med['id']}"), json={"stockQuantity": 30, "pharmacy": "City Pharmacy"})
    assert r.json()["status"] == "active"  # non-clinical edit
    r = fam["owner"].patch(med_url(fam, suffix=f"/{med['id']}"), json={"doseQuantity": 2})
    assert r.json()["status"] == "pending_verification" and r.json()["verification"] is None
    journey = fam["owner"].get(med_url(fam, suffix=f"/{med['id']}/journey")).json()
    assert [j["action"] for j in journey] == ["medication.create", "medication.verify", "medication.update", "medication.update"]
    assert "re-verification required" in journey[-1]["summary"]


def test_dose_recording_stock_and_unconfirmed_is_not_missed(fam, clock):
    med = add_med(fam, stockQuantity=10)
    verify(fam, med["id"])
    base = f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses"
    doses = fam["owner"].get(base).json()
    assert [d["status"] for d in doses] == ["unconfirmed", "scheduled"]  # 08:00 passed (10:00 now), 20:00 upcoming
    morning = doses[0]["scheduledFor"]
    r = fam["secondary"].post(base, json={"medicationId": med["id"], "scheduledFor": morning, "status": "taken"})
    assert r.status_code == 200
    assert fam["owner"].get(med_url(fam, suffix=f"/{med['id']}")).json()["stockQuantity"] == 9
    # Correcting the record reverses the stock adjustment (idempotent per dose slot)
    fam["secondary"].post(base, json={"medicationId": med["id"], "scheduledFor": morning, "status": "skipped"})
    assert fam["owner"].get(med_url(fam, suffix=f"/{med['id']}")).json()["stockQuantity"] == 10
    statuses = {d["scheduledFor"]: d["status"] for d in fam["owner"].get(base).json()}
    assert statuses[morning] == "skipped"
    assert "missed" not in str(fam["owner"].get(base).json())


def test_dose_validation(fam):
    med = add_med(fam)
    base = f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses"
    slot = (FROZEN - timedelta(hours=2)).isoformat()  # 08:00 IST
    assert fam["owner"].post(base, json={"medicationId": med["id"], "scheduledFor": slot, "status": "taken"}).status_code == 409  # unverified
    verify(fam, med["id"])
    bad = (FROZEN - timedelta(hours=1)).isoformat()
    assert fam["owner"].post(base, json={"medicationId": med["id"], "scheduledFor": bad, "status": "taken"}).status_code == 422
    evening = (FROZEN + timedelta(hours=10)).isoformat()  # 20:00 — more than 2 h ahead
    assert fam["owner"].post(base, json={"medicationId": med["id"], "scheduledFor": evening, "status": "taken"}).status_code == 422


def test_scenario_a_two_seniors_have_completely_different_schedules(fam):
    g = add_med(fam)
    m = add_med(fam, sid=fam["m"], name="Amlodipine", strength="5 mg", frequencyText="OD", times=["09:00"])
    verify(fam, g["id"])
    verify(fam, m["id"], sid=fam["m"])
    gd = fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses").json()
    md = fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['m']}/doses").json()
    assert {d["medicationName"] for d in gd} == {"Metformin"} and len(gd) == 2
    assert {d["medicationName"] for d in md} == {"Amlodipine"} and len(md) == 1
    # A medication id from one profile can't be used under the other profile
    assert fam["owner"].get(med_url(fam, fam["m"], f"/{g['id']}")).status_code == 404


def test_adherence_counts(fam, clock):
    med = add_med(fam)
    verify(fam, med["id"])
    clock(FROZEN + timedelta(days=1))  # Tue 10:00 IST: Mon 08:00, Mon 20:00, Tue 08:00 have passed
    base = f"/api/households/{fam['hid']}/seniors/{fam['g']}"
    mon_8 = (FROZEN - timedelta(hours=2)).isoformat()
    fam["primary"].post(base + "/doses", json={"medicationId": med["id"], "scheduledFor": mon_8, "status": "taken"})
    a = fam["owner"].get(base + "/adherence?days=2").json()
    assert a["totals"] == {"taken": 1, "skipped": 0, "unconfirmed": 2}
    assert "does not mean it was missed" in a["note"]


def test_refill_intelligence(fam):
    med = add_med(fam, stockQuantity=5, pharmacy="City Pharmacy")
    med = verify(fam, med["id"]).json()
    rf = med["refill"]
    assert rf["tracked"] and rf["dailyUse"] == 2 and rf["daysRemaining"] == 2 and rf["level"] == "critical"
    assert rf["depletionDate"] == "2026-11-18" and "60" in rf["checklist"][1] and "City Pharmacy" in rf["checklist"][1]
    r = fam["secondary"].post(med_url(fam, suffix=f"/{med['id']}/refill"), json={"quantity": 60})
    assert r.json()["stockQuantity"] == 65 and r.json()["refill"]["level"] == "ok"


def test_status_transitions(fam):
    med = add_med(fam)
    url = med_url(fam, suffix=f"/{med['id']}/status")
    assert fam["owner"].post(url, json={"status": "active"}).status_code == 409  # never verified
    verify(fam, med["id"])
    assert fam["owner"].post(url, json={"status": "paused", "reason": "Doctor advised"}).json()["status"] == "paused"
    assert fam["owner"].post(url, json={"status": "active"}).json()["status"] == "active"
    assert fam["owner"].post(url, json={"status": "ended"}).json()["status"] == "ended"
    assert fam["owner"].patch(med_url(fam, suffix=f"/{med['id']}"), json={"doseQuantity": 2}).status_code == 409


def test_interaction_review_is_honest_and_finds_duplicates(fam):
    add_med(fam)
    add_med(fam)
    r = fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['g']}/medication-review").json()
    assert r["interactionCheck"] == "unavailable" and len(r["duplicates"]) == 1


def test_responsible_person_must_have_access(fam, make_actor):
    outsider = make_actor("Outsider")
    r = fam["owner"].post(med_url(fam), json={**MED, "responsibleUid": outsider.uid})
    assert r.status_code == 422


def test_today_uses_seniors_local_date(fam, clock):
    """At 23:30 UTC on Sunday it is already Monday 05:00 in India — 'today' must be the senior's Monday."""
    from datetime import datetime, timezone

    med = add_med(fam)
    verify(fam, med["id"])
    clock(datetime(2026, 11, 15, 23, 30, tzinfo=timezone.utc))
    doses = fam["owner"].get(f"/api/households/{fam['hid']}/seniors/{fam['g']}/doses").json()
    assert [d["scheduledFor"][:16] for d in doses] == ["2026-11-16T02:30", "2026-11-16T14:30"]
