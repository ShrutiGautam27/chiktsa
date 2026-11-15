"""Phase 5: Internet Independence Mode — server side of offline sync (Scenario G).

The app queues supported changes while offline and replays them here when connectivity returns.
Guarantees:
  * Exactly-once: each operation carries a client-generated ID; results are stored under that ID with
    an atomic create, so retries (or a replay after a crash) return the original result.
  * Safe conflicts: if someone else changed the same record after the offline change was made, the
    server keeps the newer value and reports a conflict — nothing is silently overwritten.
  * Same rules as online: every operation goes through the normal service layer (permissions,
    consent, validation, audit), so offline mode is never a bypass.
"""
from __future__ import annotations

from datetime import datetime

from ..core.auth import CurrentUser
from ..core.errors import AppError
from ..core.timeutil import aware, now
from ..db import Store
from . import medications as meds
from . import records, tasks, wellbeing

SUPPORTED = {"dose.record", "note.create", "task.complete", "wellness.checkin"}


def _apply(store: Store, actor: CurrentUser, op: dict) -> dict:
    t, hid, sid, p = op["type"], op["householdId"], op.get("seniorId"), op.get("payload") or {}
    client_ts = aware(datetime.fromisoformat(op["clientTimestamp"]))
    if t == "dose.record":
        did = meds._dose_id(p["medicationId"], aware(datetime.fromisoformat(p["scheduledFor"])))
        cur = store.get(f"households/{hid}/seniors/{sid}/doseEvents/{did}")
        if cur:
            c = cur.data
            if c["status"] == p["status"]:
                return {"status": "applied", "message": "Already recorded the same way."}
            if c["recordedBy"] != actor.uid and aware(c["recordedAt"]) > client_ts:
                return {"status": "conflict", "message": f"{c.get('recordedByName')} recorded this dose as {c['status']} after your offline change. Their record was kept.",
                        "serverState": {"status": c["status"], "recordedBy": c.get("recordedByName"), "recordedAt": c["recordedAt"]}}
        meds.record_dose(store, actor, hid, sid, {"medicationId": p["medicationId"], "scheduledFor": datetime.fromisoformat(p["scheduledFor"]),
                                                  "status": p["status"], "note": p.get("note", "")})
        store.update(f"households/{hid}/seniors/{sid}/doseEvents/{did}", {"recordedOfflineAt": client_ts})
        return {"status": "applied", "message": "Dose recorded."}
    if t == "note.create":
        n = records.add_note(store, actor, hid, sid, p.get("text", ""), p.get("tags", []))
        store.update(f"households/{hid}/seniors/{sid}/careNotes/{n['id']}", {"recordedOfflineAt": client_ts})
        return {"status": "applied", "message": "Observation saved."}
    if t == "task.complete":
        cur = store.get(f"households/{hid}/tasks/{p['taskId']}")
        if cur and cur.data["status"] == "done":
            return {"status": "conflict", "message": f"Already completed by {cur.data.get('completedByName')}.",
                    "serverState": {"status": "done", "completedBy": cur.data.get("completedByName")}}
        if cur and cur.data["status"] == "cancelled":
            return {"status": "conflict", "message": "This task was cancelled while you were offline.", "serverState": {"status": "cancelled"}}
        if cur and cur.data.get("assigneeUid") != actor.uid and aware(cur.data.get("assignedAt") or cur.data["createdAt"]) > client_ts:
            return {"status": "conflict", "message": f"This task was reassigned to {cur.data.get('assigneeName')} while you were offline.",
                    "serverState": {"status": cur.data["status"], "assignee": cur.data.get("assigneeName")}}
        tasks.complete(store, actor, hid, p["taskId"], p.get("note", ""))
        return {"status": "applied", "message": "Task completed."}
    if t == "wellness.checkin":
        senior = store.get(f"households/{hid}/seniors/{sid}")
        from ..core.timeutil import local_date

        day = local_date(client_ts, (senior.data.get("timezone") if senior else None) or "UTC").isoformat()
        cur = store.get(f"households/{hid}/seniors/{sid}/wellness/{day}")
        if cur and aware(cur.data["updatedAt"]) > client_ts and cur.data.get("recordedBy") != actor.uid:
            return {"status": "conflict", "message": f"{cur.data.get('recordedByName')} already recorded today's check-in after your change.",
                    "serverState": {k: cur.data.get(k) for k in ("mood", "sleep", "energy")}}
        if day != local_date(now(), (senior.data.get("timezone") if senior else None) or "UTC").isoformat():
            return {"status": "rejected", "message": "Check-ins can only be recorded for today."}
        wellbeing.checkin(store, actor, hid, sid, p)
        return {"status": "applied", "message": "Check-in saved."}
    return {"status": "rejected", "message": "Unsupported change type."}


def sync_batch(store: Store, actor: CurrentUser, ops: list[dict]) -> dict:
    results = []
    for op in ops[:100]:
        oid = op.get("clientOpId", "")
        path = f"users/{actor.uid}/syncOps/{oid}"
        if not (8 <= len(oid) <= 64) or not oid.replace("-", "").isalnum():
            results.append({"clientOpId": oid, "status": "rejected", "message": "Invalid operation id."})
            continue
        existing = store.get(path)
        if existing:
            results.append({**existing.data["result"], "clientOpId": oid, "duplicate": True})
            continue
        if op.get("type") not in SUPPORTED:
            res = {"status": "rejected", "message": "Unsupported change type."}
        else:
            try:
                res = _apply(store, actor, op)
            except AppError as e:
                res = {"status": "rejected", "message": e.message}
            except (KeyError, ValueError, TypeError):
                res = {"status": "rejected", "message": "Malformed offline change."}
        # Atomic create: if another device replayed the same op concurrently, keep the first result.
        if not store.create(path, {"result": res, "type": op.get("type"), "processedAt": now()}):
            res = store.get(path).data["result"]
        results.append({**res, "clientOpId": oid})
    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("applied", "conflict", "rejected")}
    return {"results": results, "summary": summary, "serverTime": now()}
