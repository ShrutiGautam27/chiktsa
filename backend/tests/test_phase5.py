"""PHASE 5 — wishes, wellness, emergency snapshot, offline sync (Scenario G), voice, reports, calendar, organisations."""
import uuid
from datetime import timedelta

import pytest

from app.core.timeutil import now
from tests.conftest import FROZEN
from tests.test_medications import MED


@pytest.fixture()
def fam(make_actor, clock):
    owner, anita, ravi, priya, grandpa = (make_actor(n) for n in ("Owner", "Anita", "Ravi", "Priya", "Grandpa"))
    hid = owner.create_household()
    g = owner.post(f"/api/households/{hid}/seniors", json={"fullName": "Mohan Sharma", "preferredName": "Dadaji",
                   "emergencyContacts": [{"name": "Priya Sharma", "relationship": "granddaughter", "phone": "+91 98100 00001"}]}).json()["id"]
    k = owner.add_senior(hid, "Kamla Sharma")
    owner.invite(hid, anita, "primary_caregiver")
    owner.invite(hid, ravi, "secondary_caregiver")
    owner.invite(hid, priya, "family_member")
    owner.invite(hid, grandpa, "senior", linked=g)
    return {"owner": owner, "anita": anita, "ravi": ravi, "priya": priya, "grandpa": grandpa, "hid": hid, "g": g, "k": k}


def S(f, sid=None, p=""):
    return f"/api/households/{f['hid']}/seniors/{sid or f['g']}{p}"


def active_med(f, sid=None, **over):
    m = f["owner"].post(S(f, sid, "/medications"), json={**MED, "responsibleUid": f["anita"].uid, **over}).json()
    f["anita"].post(S(f, sid, f"/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    return m


# ------------------------------------------------------------------ wishes & preferences
def test_preferences_edited_by_senior_or_admin_only(fam):
    r = fam["grandpa"].put(S(fam, p="/preferences"), json={"preferredLanguage": "Hindi", "likes": "Old film songs, morning walks"})
    assert r.status_code == 200 and r.json()["likes"].startswith("Old film")
    assert fam["owner"].put(S(fam, p="/preferences"), json={"dislikes": "Loud TV"}).status_code == 200
    assert fam["anita"].put(S(fam, p="/preferences"), json={"likes": "x"}).status_code == 403
    assert fam["anita"].get(S(fam, p="/preferences")).json()["preferredLanguage"] == "Hindi"
    fam["grandpa"].put(S(fam, p=f"/consents/{fam['ravi'].uid}"), json={"categories": ["medications"]})
    assert fam["ravi"].get(S(fam, p="/preferences")).status_code == 403


# ------------------------------------------------------------------ wellness check-ins
def test_wellness_checkin_and_call_request(fam):
    r = fam["grandpa"].post(S(fam, p="/wellness"), json={"mood": 4, "sleep": 3, "energy": 4, "wantsCall": True, "note": "Missing the grandkids"})
    assert r.status_code == 200 and r.json()["reportedBy"] == "self"
    fam["grandpa"].post(S(fam, p="/wellness"), json={"mood": 5, "wantsCall": True})        # same day: updated, no duplicate notice
    notes = [n for n in fam["priya"].get("/api/me/notifications").json()["items"] if n["kind"] == "wants_call"]
    assert len(notes) == 1
    h = fam["owner"].get(S(fam, p="/wellness")).json()
    assert len(h["entries"]) == 1 and h["averages"]["mood"] == 5 and "Not used to diagnose" in h["note"]
    assert fam["grandpa"].post(S(fam, p="/wellness"), json={"mood": 9}).status_code == 422
    assert fam["anita"].post(S(fam, fam["k"], "/wellness"), json={"mood": 3}).json()["reportedBy"] == "caregiver"


# ------------------------------------------------------------------ emergency snapshot
def test_emergency_card_approval_rules(fam):
    fam["owner"].put(S(fam, p="/emergency"), json={"fields": {"bloodGroup": "B+", "allergies": "Penicillin", "conditions": "Type 2 diabetes"}})
    assert fam["owner"].post(S(fam, p="/emergency/approve")).status_code == 403       # senior has their own login
    r = fam["grandpa"].post(S(fam, p="/emergency/approve")).json()
    assert r["status"] == "approved" and r["approvedAs"] == "senior"
    r = fam["owner"].put(S(fam, p="/emergency"), json={"fields": {"bloodGroup": "B+", "allergies": "Penicillin, sulfa"}}).json()
    assert r["status"] == "draft"                                                       # edits need re-approval
    k = fam["owner"].put(S(fam, fam["k"], "/emergency"), json={"fields": {"allergies": "None known"}})
    assert fam["owner"].post(S(fam, fam["k"], "/emergency/approve")).json()["approvedAs"] == "admin_on_behalf"
    assert k.status_code == 200


def test_emergency_share_link_is_limited_logged_and_revocable(fam, client):
    active_med(fam)
    fam["owner"].post(S(fam, p="/medications"), json={**MED, "name": "Unverified Pill"})
    fam["owner"].put(S(fam, p="/emergency"), json={"fields": {"bloodGroup": "B+", "conditions": "Private detail"},
                                                   "include": {"conditions": False, "medications": True, "contacts": True}})
    assert fam["owner"].post(S(fam, p="/emergency/shares"), json={"hours": 24}).status_code == 409   # not approved yet
    fam["grandpa"].post(S(fam, p="/emergency/approve"))
    assert fam["owner"].post(S(fam, p="/emergency/shares"), json={"hours": 100}).status_code == 422
    tok = fam["owner"].post(S(fam, p="/emergency/shares"), json={"hours": 24}).json()["token"]
    r = client.get(f"/api/public/emergency/{tok}")
    card = r.json()["card"]
    assert r.status_code == 200 and r.headers["x-robots-tag"].startswith("noindex")
    assert card["bloodGroup"] == "B+" and card["conditions"] == "" and [m["name"] for m in card["medications"]] == ["Metformin"]
    assert card["contacts"][0]["name"] == "Priya Sharma" and "notes" not in card
    em = fam["owner"].get(S(fam, p="/emergency")).json()
    assert em["shares"][0]["views"] == 1
    assert any(l["action"] == "emergency.view" for l in fam["owner"].get(f"/api/households/{fam['hid']}/audit?targetType=emergency").json())
    fam["owner"].delete(S(fam, p=f"/emergency/shares/{em['shares'][0]['id']}"))
    assert client.get(f"/api/public/emergency/{tok}").status_code == 404
    assert client.get("/api/public/emergency/not-a-real-token").status_code == 404


def test_emergency_link_expires(fam, client, clock):
    fam["owner"].put(S(fam, p="/emergency"), json={"fields": {"bloodGroup": "O+"}})
    fam["grandpa"].post(S(fam, p="/emergency/approve"))
    tok = fam["owner"].post(S(fam, p="/emergency/shares"), json={"hours": 2}).json()["token"]
    clock(FROZEN + timedelta(hours=3))
    assert client.get(f"/api/public/emergency/{tok}").status_code == 404


# ------------------------------------------------------------------ offline sync (Scenario G)
def op(f, type_, payload, sid=None, ts=None, oid=None):
    return {"clientOpId": oid or uuid.uuid4().hex, "type": type_, "householdId": f["hid"], "seniorId": sid or f["g"],
            "clientTimestamp": (ts or FROZEN).isoformat(), "payload": payload}


def test_scenario_g_queued_changes_sync_safely_and_exactly_once(fam):
    """Scenario G: the internet disconnects; queued changes are synchronised safely when it returns."""
    m = active_med(fam)
    slot = (FROZEN - timedelta(hours=2)).isoformat()
    t = fam["owner"].post(f"/api/households/{fam['hid']}/tasks", json={"title": "Collect report", "seniorId": fam["g"],
                                                                      "assigneeUid": fam["anita"].uid}).json()
    fam["anita"].post(f"/api/households/{fam['hid']}/tasks/{t['id']}/accept")
    offline_at = FROZEN - timedelta(minutes=30)
    ops = [op(fam, "dose.record", {"medicationId": m["id"], "scheduledFor": slot, "status": "taken"}, ts=offline_at),
           op(fam, "note.create", {"text": "Ate breakfast while we were offline", "tags": ["meals"]}, ts=offline_at),
           op(fam, "task.complete", {"taskId": t["id"], "note": "Done offline"}, sid=None, ts=offline_at),
           op(fam, "wellness.checkin", {"mood": 4}, ts=offline_at)]
    r = fam["anita"].post("/api/sync/batch", json={"ops": ops}).json()
    assert r["summary"] == {"applied": 4, "conflict": 0, "rejected": 0}
    again = fam["anita"].post("/api/sync/batch", json={"ops": ops}).json()                    # replay after a dropped response
    assert all(x.get("duplicate") for x in again["results"]) and again["summary"]["applied"] == 4
    assert len(fam["owner"].get(S(fam, p="/notes")).json()) == 1                                 # not duplicated
    doses = fam["owner"].get(S(fam, p="/doses")).json()
    assert doses[0]["status"] == "taken"
    assert fam["owner"].get(f"/api/households/{fam['hid']}/tasks").json()[0]["status"] == "done"


def test_offline_conflicts_keep_newer_server_state(fam, clock):
    m = active_med(fam)
    slot = (FROZEN - timedelta(hours=2)).isoformat()
    offline_at = FROZEN - timedelta(hours=1)
    fam["ravi"].post(S(fam, p="/doses"), json={"medicationId": m["id"], "scheduledFor": slot, "status": "skipped"})  # online, later
    r = fam["anita"].post("/api/sync/batch", json={"ops": [op(fam, "dose.record", {"medicationId": m["id"], "scheduledFor": slot,
                                                                                  "status": "taken"}, ts=offline_at)]}).json()
    res = r["results"][0]
    assert res["status"] == "conflict" and res["serverState"]["status"] == "skipped" and "Ravi" in res["message"]
    assert fam["owner"].get(S(fam, p="/doses")).json()[0]["status"] == "skipped"          # server value kept
    t = fam["owner"].post(f"/api/households/{fam['hid']}/tasks", json={"title": "x", "assigneeUid": fam["anita"].uid}).json()
    fam["owner"].post(f"/api/households/{fam['hid']}/tasks/{t['id']}/complete", json={})
    r = fam["anita"].post("/api/sync/batch", json={"ops": [op(fam, "task.complete", {"taskId": t["id"]}, sid=None, ts=offline_at)]}).json()
    assert r["results"][0]["status"] == "conflict" and "Already completed" in r["results"][0]["message"]


def test_offline_sync_never_bypasses_permissions(fam, make_actor):
    outsider = make_actor("Outsider")
    r = outsider.post("/api/sync/batch", json={"ops": [op(fam, "note.create", {"text": "sneaky"})]}).json()
    assert r["results"][0]["status"] == "rejected"
    bad = fam["anita"].post("/api/sync/batch", json={"ops": [op(fam, "medication.delete", {}), op(fam, "note.create", {}, oid="bad id!")]}).json()
    assert [x["status"] for x in bad["results"]] == ["rejected", "rejected"]
    assert fam["owner"].get(S(fam, p="/notes")).json() == []


# ------------------------------------------------------------------ voice companion
def voice(f, actor, text, lang="en", sid=None):
    return f[actor].post(S(f, sid, "/voice"), json={"text": text, "lang": lang}).json()


def test_voice_intents_english_and_hindi(fam):
    m = active_med(fam, times=["11:00", "20:00"], frequencyText="BD")
    fam["owner"].post(S(fam, p="/appointments"), json={"title": "Eye check", "startsAt": (FROZEN + timedelta(days=1)).isoformat(),
                                                      "escortUid": fam["anita"].uid})
    r = voice(fam, "grandpa", "What medicines do I have today?")
    assert r["intent"] == "meds_today" and "Metformin 11:00" in r["reply"]
    r = voice(fam, "grandpa", "aaj kaun si dawai hai", "hi")
    assert r["lang"] == "hi" and "दवाइयाँ" in r["reply"]
    took = voice(fam, "grandpa", "I took my medicine")
    assert took["action"]["type"] == "record_dose" and took["action"]["medicationId"] == m["id"]
    assert fam["owner"].get(S(fam, p="/doses")).json()[0]["status"] != "taken"           # proposal only, not recorded
    r = voice(fam, "grandpa", "When is my next doctor appointment?")
    assert "Eye check" in r["reply"] and "Anita" in r["reply"]
    r = voice(fam, "grandpa", "Call my granddaughter")
    assert r["action"] == {"type": "call", "phone": "+919810000001", "label": "Priya Sharma"}
    r = voice(fam, "grandpa", "madad chahiye", "hi")
    assert r["intent"] == "emergency" and "112" in r["reply"] and r["action"]["type"] == "emergency"
    r = voice(fam, "grandpa", "Should I stop taking my tablets?")
    assert r["intent"] == "clinical" and r["action"] is None


def test_voice_respects_consent(fam):
    active_med(fam)
    fam["grandpa"].put(S(fam, p=f"/consents/{fam['ravi'].uid}"), json={"categories": ["appointments"]})
    r = voice(fam, "ravi", "what medicines today")
    assert "Metformin" not in r["reply"]


# ------------------------------------------------------------------ reports & calendar
def test_reports_and_csv(fam):
    m = active_med(fam)
    slot = (FROZEN - timedelta(hours=2)).isoformat()
    fam["anita"].post(S(fam, p="/doses"), json={"medicationId": m["id"], "scheduledFor": slot, "status": "taken"})
    t = fam["owner"].post(f"/api/households/{fam['hid']}/tasks", json={"title": "x", "assigneeUid": fam["anita"].uid}).json()
    fam["anita"].post(f"/api/households/{fam['hid']}/tasks/{t['id']}/accept")
    fam["anita"].post(f"/api/households/{fam['hid']}/tasks/{t['id']}/complete", json={})
    r = fam["owner"].get(f"/api/households/{fam['hid']}/reports?days=7").json()
    g = next(s for s in r["seniors"] if s["seniorId"] == fam["g"])
    assert g["adherence"]["taken"] == 1 and r["tasks"]["completed"] == 1 and "not anyone's health" in r["note"]
    assert fam["priya"].get(f"/api/households/{fam['hid']}/reports").status_code == 403
    csv_ = fam["owner"].get(f"/api/households/{fam['hid']}/reports.csv")
    assert csv_.headers["content-type"].startswith("text/csv") and "Mohan Sharma" in csv_.text


def test_appointment_ics(fam):
    a = fam["owner"].post(S(fam, p="/appointments"), json={"title": "Eye check, follow-up", "location": "Clinic; 2nd floor",
                                                          "startsAt": "2026-11-20T05:00:00+00:00"}).json()
    r = fam["owner"].get(S(fam, p=f"/appointments/{a['id']}/ics"))
    assert r.headers["content-type"].startswith("text/calendar")
    assert "DTSTART:20261120T050000Z" in r.text and "SUMMARY:Eye check\\, follow-up — Dadaji" in r.text and "Clinic\\; 2nd floor" in r.text


# ------------------------------------------------------------------ organisations
def test_organisation_connects_assigns_and_disconnects(fam, make_actor):
    boss, nurse, nurse2 = make_actor("Boss"), make_actor("Nurse"), make_actor("Nurse2")
    org = boss.post("/api/organisations", json={"name": "Seva Home Care"}).json()
    code, oid = org["connectCode"], org["id"]
    boss.post(f"/api/organisations/{oid}/staff", json={"email": nurse.email, "role": "org_caregiver"})
    assert nurse.post(f"/api/organisations/{oid}/staff", json={"email": nurse2.email}).status_code == 403
    assert fam["anita"].post(f"/api/households/{fam['hid']}/organisations", json={"code": code}).status_code == 403
    assert fam["owner"].post(f"/api/households/{fam['hid']}/organisations", json={"code": "WRONG123"}).status_code == 404
    assert fam["owner"].post(f"/api/households/{fam['hid']}/organisations", json={"code": code}).status_code == 200
    roles = {m["householdId"]: m["role"] for m in boss.get("/api/me").json()["memberships"]}
    assert roles[fam["hid"]] == "org_admin"
    assert nurse.get(f"/api/households/{fam['hid']}").status_code == 404                 # not placed yet
    r = boss.post(f"/api/organisations/{oid}/assignments", json={"householdId": fam["hid"], "uid": nurse.uid,
                                                                "role": "secondary_caregiver", "seniorScope": [fam["k"]]})
    assert r.status_code == 200
    assert [s["id"] for s in nurse.get(f"/api/households/{fam['hid']}/seniors").json()] == [fam["k"]]
    dash = boss.get(f"/api/organisations/{oid}/dashboard").json()
    assert dash["totals"]["households"] == 1 and dash["households"][0]["profiles"] == 2
    assert nurse.get(f"/api/organisations/{oid}/dashboard").status_code == 403
    fam["owner"].delete(f"/api/households/{fam['hid']}/organisations/{oid}")
    assert nurse.get(f"/api/households/{fam['hid']}").status_code == 404
    assert boss.get(f"/api/households/{fam['hid']}").status_code == 404
    assert fam["owner"].get(f"/api/households/{fam['hid']}").json()["memberCount"] == 5


def test_org_never_overrides_direct_family_membership(fam, make_actor):
    org = fam["anita"].post("/api/organisations", json={"name": "Anita's Agency"}).json()   # Anita is already a direct member
    fam["owner"].post(f"/api/households/{fam['hid']}/organisations", json={"code": org["connectCode"]})
    roles = {m["householdId"]: m["role"] for m in fam["anita"].get("/api/me").json()["memberships"]}
    assert roles[fam["hid"]] == "primary_caregiver"
    fam["owner"].delete(f"/api/households/{fam['hid']}/organisations/{org['id']}")
    assert fam["anita"].get(f"/api/households/{fam['hid']}").status_code == 200          # direct access survives disconnect
