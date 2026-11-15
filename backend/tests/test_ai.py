"""PHASE 4 — AI workflows, guardrails, document vault, prescription extraction, task conversion."""
from datetime import timedelta

import pytest

from app.ai import services as ai
from app.ai.llm import AIUnavailable, GeminiClient, set_llm
from app.config import get_settings
from app.core.ratelimit import limiter
from app.services.records import LocalStorage, set_storage
from tests.conftest import FROZEN
from tests.test_medications import MED

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.4\n%fake\n"


class FakeLLM:
    """Stands in for Gemini. `responses` maps schema class name → instance or callable(prompt)."""

    name = "fake"

    def __init__(self, **responses):
        self.responses = responses
        self.calls = []

    def generate(self, system, prompt, schema, files=None, temperature=0.1):
        self.calls.append({"system": system, "prompt": prompt, "schema": schema.__name__, "files": files})
        r = self.responses.get(schema.__name__)
        if r is None or r == "fail":
            raise AIUnavailable("fake failure")
        return r(prompt) if callable(r) else r


@pytest.fixture(autouse=True)
def _isolate(tmp_path):
    set_storage(LocalStorage(str(tmp_path / "files")))
    limiter.reset()
    yield
    set_llm(None)
    set_storage(None)


@pytest.fixture()
def fam(make_actor, clock):
    owner, anita, ravi, priya = make_actor("Owner"), make_actor("Anita"), make_actor("Ravi"), make_actor("Priya")
    hid = owner.create_household()
    g = owner.add_senior(hid, "Mohan Sharma")
    k = owner.post(f"/api/households/{hid}/seniors", json={"fullName": "Kamla Sharma", "preferredName": "Dadi"}).json()["id"]
    owner.invite(hid, anita, "primary_caregiver")
    owner.invite(hid, ravi, "secondary_caregiver", scope=[g])
    owner.invite(hid, priya, "family_admin")
    return {"owner": owner, "anita": anita, "ravi": ravi, "priya": priya, "hid": hid, "g": g, "k": k}


def S(f, sid=None, p=""):
    return f"/api/households/{f['hid']}/seniors/{sid or f['g']}{p}"


def gemini_on(f):
    assert f["owner"].put(f"/api/households/{f['hid']}/ai", json={"mode": "gemini"}).status_code == 200


# ------------------------------------------------------------------ settings & opt-in
def test_cloud_ai_is_opt_in_and_audited(fam):
    st = fam["owner"].get(f"/api/households/{fam['hid']}/ai").json()
    assert st == {"mode": "offline", "geminiConfigured": False, "effectiveEngine": "offline", "model": None}
    assert fam["ravi"].put(f"/api/households/{fam['hid']}/ai", json={"mode": "gemini"}).status_code == 403
    gemini_on(fam)
    assert fam["owner"].get(f"/api/households/{fam['hid']}/audit?targetType=settings").json()[0]["action"] == "settings.ai"


def test_gemini_never_called_without_household_opt_in(fam):
    fake = FakeLLM(MemoryAnswer=ai.MemoryAnswer(answer="x", citations=[]))
    set_llm(fake)
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Walked in the garden after breakfast."})
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "garden walk"}).json()
    assert r["engine"] == "offline" and fake.calls == []


# ------------------------------------------------------------------ Care Memory Bridge
def test_memory_offline_cites_records_and_admits_gaps(fam):
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Complained of knee stiffness during the evening walk.", "tags": ["mobility"]})
    fam["owner"].post(S(fam, p="/appointments"), json={"title": "Orthopaedic review", "providerName": "Dr Rao",
                                                      "startsAt": (FROZEN + timedelta(days=2)).isoformat()})
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "When did the knee stiffness come up?"}).json()
    assert r["engine"] == "offline" and not r["insufficient"]
    assert r["citations"][0]["type"] == "note" and "knee" in r["citations"][0]["snippet"]
    none = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "passport renewal"}).json()
    assert none["insufficient"] and none["citations"] == []


def test_memory_escalates_clinical_questions(fam):
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Felt dizzy in the morning."})
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "Should he stop taking his tablets because of the dizzy spells?"}).json()
    assert r["clinicalEscalation"] and "doctor" in r["answer"]


def test_memory_respects_scope_and_consent(fam, make_actor):
    fam["anita"].post(S(fam, fam["k"], "/notes"), json={"text": "Dadi enjoyed the bhajan programme."})
    assert fam["ravi"].post(S(fam, fam["k"], "/memory/query"), json={"question": "bhajan"}).status_code == 404  # out of scope
    fam["owner"].put(S(fam, fam["k"], f"/consents/{fam['anita'].uid}"), json={"categories": ["appointments"]})
    r = fam["anita"].post(S(fam, fam["k"], "/memory/query"), json={"question": "bhajan programme"}).json()
    assert r["insufficient"]  # care notes not shared with Anita any more


def test_memory_gemini_minimal_context_citation_validation_and_guardrails(fam):
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Ate a full lunch and watched cricket."})
    fam["anita"].post(S(fam, fam["k"], "/notes"), json={"text": "SECRET-OTHER-PROFILE note about cricket."})
    gemini_on(fam)

    def answer(prompt):
        rid = prompt.split("[")[1].split("]")[0]
        return ai.MemoryAnswer(answer="He ate a full lunch.", citations=[rid, "note:invented"])

    fake = FakeLLM(MemoryAnswer=answer)
    set_llm(fake)
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "lunch cricket"}).json()
    assert r["engine"] == "gemini" and [c["type"] for c in r["citations"]] == ["note"]   # invented citation dropped
    assert "SECRET-OTHER-PROFILE" not in fake.calls[0]["prompt"]                         # one senior only
    assert "Never diagnose" in fake.calls[0]["system"]

    set_llm(FakeLLM(MemoryAnswer=ai.MemoryAnswer(answer="Made-up history", citations=["note:invented"])))
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "lunch cricket"}).json()
    assert r["insufficient"]                                                           # unsupported → admitted, not shown

    def unsafe(prompt):
        rid = prompt.split("[")[1].split("]")[0]
        return ai.MemoryAnswer(answer="He should take an extra dose tonight.", citations=[rid])

    set_llm(FakeLLM(MemoryAnswer=unsafe))
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "lunch cricket"}).json()
    assert r["clinicalEscalation"] and "extra dose" not in r["answer"]


def test_model_failure_falls_back_to_offline(fam):
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Visited by grandson Arjun."})
    gemini_on(fam)
    set_llm(FakeLLM(MemoryAnswer="fail"))
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "Arjun visit"}).json()
    assert r["engine"] == "offline" and r["citations"]


# ------------------------------------------------------------------ Daily briefing
def test_briefing_offline_grounded_and_cached(fam):
    fam["owner"].post(S(fam, p="/appointments"), json={"title": "Eye check", "startsAt": (FROZEN + timedelta(hours=20)).isoformat()})
    b = fam["owner"].get(f"/api/households/{fam['hid']}/briefing").json()
    assert b["engine"] == "offline" and b["factsUsed"] >= 2
    assert any("Eye check" in p["text"] for p in b["priorities"]) and "need attention" in b["headline"]
    again = fam["owner"].get(f"/api/households/{fam['hid']}/briefing").json()
    assert again["generatedAt"] == b["generatedAt"]                  # cached
    fresh = fam["owner"].get(f"/api/households/{fam['hid']}/briefing?refresh=true").json()
    assert fresh["factsUsed"] == b["factsUsed"]


def test_briefing_gemini_fact_ids_are_validated(fam):
    fam["owner"].post(S(fam, p="/appointments"), json={"title": "Eye check", "startsAt": (FROZEN + timedelta(hours=20)).isoformat()})
    gemini_on(fam)
    set_llm(FakeLLM(BriefingOut=lambda p: ai.BriefingOut(headline="Busy day", summary="One visit tomorrow.", priorities=[
        ai.BriefingPriority(text="Eye check needs an escort", factId=p.split("[")[1].split("]")[0]),
        ai.BriefingPriority(text="Invented thing", factId="made-up")])))
    b = fam["owner"].get(f"/api/households/{fam['hid']}/briefing?refresh=true").json()
    assert b["engine"] == "gemini" and [p["text"] for p in b["priorities"]] == ["Eye check needs an escort"]


# ------------------------------------------------------------------ Appointment preparation
def test_appointment_prep_uses_only_verified_medications(fam):
    m = fam["owner"].post(S(fam, p="/medications"), json={**MED, "responsibleUid": fam["anita"].uid}).json()
    fam["anita"].post(S(fam, p=f"/medications/{m['id']}/verify"), json={"acknowledgeWarnings": True})
    fam["owner"].post(S(fam, p="/medications"), json={**MED, "name": "Atorvastatin", "uncertainFields": ["doseQuantity"],
                                                      "source": "prescription", "strength": "10 mg"})
    fam["anita"].post(S(fam, p="/notes"), json={"text": "Sleeping better this week."})
    a = fam["owner"].post(S(fam, p="/appointments"), json={"title": "Diabetes review", "providerName": "Dr Iyer",
                                                          "startsAt": (FROZEN + timedelta(days=1)).isoformat(),
                                                          "questions": ["Is the diet plan working?"]}).json()
    p = fam["owner"].get(S(fam, p=f"/appointments/{a['id']}/prep")).json()
    assert [x["name"] for x in p["sections"]["medications"]] == ["Metformin"]
    assert p["sections"]["unverified"][0]["name"] == "Atorvastatin"
    assert any("Atorvastatin" in q for q in p["suggestedQuestions"])
    assert p["familyQuestions"] == ["Is the diet plan working?"] and p["sections"]["observations"]
    assert "not a diagnosis" in p["summary"].lower() or "nothing here is a diagnosis" in p["summary"].lower()


# ------------------------------------------------------------------ Document vault
def test_document_upload_validation_and_access(fam, make_actor):
    up = lambda actor, data, name="rx.png", kind="prescription": actor.client.post(  # noqa: E731
        S(fam, p="/documents"), headers=actor.headers, files={"file": (name, data, "image/png")}, data={"kind": kind, "title": "Rx"})
    r = up(fam["anita"], PNG)
    assert r.status_code == 201 and r.json()["contentType"] == "image/png"
    assert up(fam["anita"], b"MZ\x90\x00 not an image", "evil.png").status_code == 422      # content sniffed, not trusted
    assert up(fam["anita"], b"plain text").status_code == 422
    big = b"%PDF-" + b"0" * (get_settings().max_upload_mb * 1024 * 1024)
    assert up(fam["anita"], big, "big.pdf").status_code == 422
    did = r.json()["id"]
    f = fam["owner"].get(S(fam, p=f"/documents/{did}/file"))
    assert f.status_code == 200 and f.content == PNG and f.headers["cache-control"].startswith("no-store")
    assert make_actor("Outsider").get(S(fam, p=f"/documents/{did}/file")).status_code == 404
    fam["owner"].put(S(fam, p=f"/consents/{fam['anita'].uid}"), json={"categories": ["medications"]})
    assert fam["anita"].get(S(fam, p="/documents")).status_code == 403
    logs = fam["owner"].get(f"/api/households/{fam['hid']}/audit?targetType=document").json()
    assert {"document.upload", "document.access"} <= {entry["action"] for entry in logs}
    assert fam["owner"].delete(S(fam, p=f"/documents/{did}")).status_code == 204
    assert fam["owner"].get(S(fam, p="/documents")).json() == []


# ------------------------------------------------------------------ Prescription extraction → firewall
def _upload_rx(f):
    r = f["owner"].client.post(S(f, p="/documents"), headers=f["owner"].headers,
                               files={"file": ("rx.jpg", b"\xff\xd8\xff" + b"0" * 32, "image/jpeg")}, data={"kind": "prescription"})
    return r.json()["id"]


def test_offline_extraction_needs_transcription_then_parses_and_flags(fam):
    did = _upload_rx(fam)
    r = fam["owner"].post(S(fam, p=f"/documents/{did}/extract"), json={}).json()
    assert r["status"] == "needs_transcription" and r["medications"] == []
    text = "Dr. A. Rao\nTab Metformin 500 mg 1-0-1 after food x 30 days\nTab Amlo? 5 mg OD\nCap Omeprazole ? mg BD before breakfast"
    r = fam["owner"].post(S(fam, p=f"/documents/{did}/extract"), json={"transcription": text}).json()
    meds_ = r["medications"]
    assert r["status"] == "extracted" and r["prescriber"] == "Dr. A. Rao" and len(meds_) == 3
    assert meds_[0]["name"] == "Metformin" and meds_[0]["strength"] == "500 mg" and meds_[0]["frequencyText"] == "1-0-1"
    assert meds_[0]["instructions"] == "after food" and meds_[0]["durationText"] == "x 30 days"
    assert "name" in meds_[1]["uncertainFields"] and "strength" in meds_[2]["uncertainFields"]


def test_drafts_are_pending_and_blocked_until_humans_finish(fam):
    did = _upload_rx(fam)
    fam["owner"].post(S(fam, p=f"/documents/{did}/extract"), json={"transcription": "Tab Metformin 500 mg 1-0-1 after food\nTab Amlo? 5 mg OD"})
    created = fam["owner"].post(S(fam, p=f"/documents/{did}/drafts"), json={"indexes": [0, 1], "responsibleUid": fam["anita"].uid}).json()
    assert [m["status"] for m in created] == ["pending_verification"] * 2
    assert all(m["times"] == [] for m in created)                          # never guessed
    assert "missing_field" in [i["code"] for i in created[0]["issues"]]
    r = fam["anita"].post(S(fam, p=f"/medications/{created[0]['id']}/verify"), json={"acknowledgeWarnings": True})
    assert r.status_code == 422                                             # firewall holds
    upd = fam["owner"].patch(S(fam, p=f"/medications/{created[0]['id']}"), json={"times": ["08:00", "20:00"], "startDate": "2026-11-16"})
    assert upd.json()["blockingCount"] == 0
    upd = fam["owner"].patch(S(fam, p=f"/medications/{created[0]['id']}"), json={"times": ["08:00"]})
    assert "frequency_conflict" in [i["code"] for i in upd.json()["issues"]]  # "1-0-1" means 2 doses


def test_gemini_extraction_filters_fields(fam):
    did = _upload_rx(fam)
    gemini_on(fam)
    fake = FakeLLM(RxOut=ai.RxOut(prescriber="Dr X", medications=[ai.RxItem(name="Metformin", strength="500 mg", doseQuantity=1,
                                                                           frequencyText="BD", uncertainFields=["strength", "bogus"])]))
    set_llm(fake)
    r = fam["owner"].post(S(fam, p=f"/documents/{did}/extract"), json={}).json()
    assert r["engine"] == "gemini" and r["medications"][0]["uncertainFields"] == ["strength"]
    assert fake.calls[0]["files"][0][0] == "image/jpeg"


# ------------------------------------------------------------------ Dialect-to-task converter
def test_offline_task_conversion_hinglish(fam):
    text = "Ask Priya to take Dadi to the eye doctor tomorrow at 5 pm. Buy groceries today; kal Mohan ki dawai refill karni hai"
    r = fam["owner"].post(f"/api/households/{fam['hid']}/tasks/convert", json={"text": text}).json()
    p = r["proposals"]
    assert r["engine"] == "offline" and len(p) == 3
    assert p[0]["seniorId"] == fam["k"] and p[0]["assigneeUid"] == fam["priya"].uid and p[0]["kind"] == "appointment_escort"
    assert p[0]["dueAt"].startswith("2026-11-17T11:30")                    # 17:00 IST
    assert p[1]["kind"] == "errand" and p[1]["needsClarification"]          # no time given
    assert p[2]["seniorId"] == fam["g"] and "Kal" in p[2]["clarification"]
    assert fam["owner"].get(f"/api/households/{fam['hid']}/tasks").json() == []   # nothing saved


def test_task_conversion_validates_model_output(fam):
    gemini_on(fam)
    set_llm(FakeLLM(TaskProposals=ai.TaskProposals(tasks=[
        ai.TaskProposalOut(title="Accompany to clinic", seniorId=fam["k"], assigneeUid=fam["ravi"].uid, dueAt="2026-11-18T10:00:00+05:30"),
        ai.TaskProposalOut(title="Visit", seniorId="invented", assigneeUid="ghost", dueAt="2020-01-01T00:00:00Z"),
        ai.TaskProposalOut(title="Double the dose of insulin", kind="medication_check")])))
    p = fam["owner"].post(f"/api/households/{fam['hid']}/tasks/convert", json={"text": "do things"}).json()["proposals"]
    assert len(p) == 2                                                      # unsafe medication change dropped
    assert p[0]["assigneeUid"] is None and "can't access" in p[0]["clarification"]   # Ravi isn't scoped to Kamla
    assert p[1]["seniorId"] is None and p[1]["assigneeUid"] is None and p[1]["dueAt"] is None
    assert fam["ravi"].post(f"/api/households/{fam['hid']}/tasks/convert", json={"text": "hello there"}).status_code == 403


# ------------------------------------------------------------------ rate limit & client
def test_ai_rate_limit(fam, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_rate_limit_per_hour", 2)
    codes = [fam["owner"].post(S(fam, p="/memory/query"), json={"question": "anything new"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_gemini_client_request_and_parsing(monkeypatch):
    captured = {}

    class R:
        status_code = 200

        @staticmethod
        def json():
            return {"candidates": [{"content": {"parts": [{"text": '{"answer": "ok", "citations": ["note:1"]}'}]}}]}

    def post(url, json, headers, timeout):
        captured.update(url=url, body=json, headers=headers)
        return R()

    monkeypatch.setattr("app.ai.llm.httpx.post", post)
    out = GeminiClient("k-test", "gemini-2.5-flash").generate("sys", "prompt", ai.MemoryAnswer, files=[("image/png", PNG)])
    assert out.answer == "ok" and captured["headers"] == {"x-goog-api-key": "k-test"}
    cfg = captured["body"]["generationConfig"]
    assert cfg["responseMimeType"] == "application/json" and "$ref" not in str(cfg["responseSchema"])
    assert captured["body"]["contents"][0]["parts"][1]["inline_data"]["mime_type"] == "image/png"
    assert "key=" not in captured["url"]                                    # key in header, never in URL

    class Bad(R):
        @staticmethod
        def json():
            return {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}

    monkeypatch.setattr("app.ai.llm.httpx.post", lambda *a, **k: Bad())
    with pytest.raises(AIUnavailable):
        GeminiClient("k", "m").generate("s", "p", ai.MemoryAnswer)


def test_hindi_future_tense_assigns_subject(fam):
    r = fam["owner"].post(f"/api/households/{fam['hid']}/tasks/convert",
                          json={"text": "Kal Priya Dadi ko eye doctor le jayegi 5 baje"}).json()
    p = r["proposals"][0]
    assert p["assigneeUid"] == fam["priya"].uid and p["seniorId"] == fam["k"] and p["kind"] == "appointment_escort"


def test_memory_records_include_dose_responsibility(fam):
    m = fam["owner"].post(S(fam, p="/medications"), json={**MED, "responsibleUid": fam["anita"].uid}).json()
    r = fam["owner"].post(S(fam, p="/memory/query"), json={"question": "Who confirms the Metformin doses?"}).json()
    assert any("doses confirmed by Anita" in c["snippet"] for c in r["citations"]) and m["id"]
